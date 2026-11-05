/**
 * The handful of document operations the sync and sharing logic needs, behind an interface so
 * that logic can be unit-tested against an in-memory store (see __tests__/memoryStore.ts).
 *
 * Partition key is /userId. A user's own records live in their partition; records in a SHARED
 * pond (catches logged by members, the member list, invites) live in the pond OWNER's partition.
 */
import type { Container } from '@azure/cosmos';
import { getDocsContainer } from './cosmos';
import type { PondInviteDoc, PondMemberDoc, SyncDoc } from './types';
import type { WeatherStamp } from './weather';

export interface DocStore {
  read(id: string, partition: string): Promise<SyncDoc | undefined>;
  upsert(doc: SyncDoc): Promise<void>;
  remove(id: string, partition: string): Promise<void>;
  /** Everything in one partition changed after `since` (all when null), except invites. */
  partitionChanges(partition: string, since: string | null): Promise<SyncDoc[]>;
  /** Every pondMember doc (including tombstones) where memberId = the given user. Cross-partition. */
  membershipsOf(memberId: string): Promise<PondMemberDoc[]>;
  /** The pond doc plus its catches, feeding logs and photos (those stamped with pondId) in the owner's partition. */
  pondChanges(ownerId: string, pondId: string, since: string | null): Promise<SyncDoc[]>;
  /** Photo docs for the given catches (older photo docs carry no pondId). */
  photosForCatches(ownerId: string, catchIds: string[]): Promise<SyncDoc[]>;
  /** An invite by code. Cross-partition. */
  findInvite(code: string): Promise<PondInviteDoc | undefined>;
  /** What the weather backfill needs from one partition: live catches, ponds, and existing weather stamps. */
  weatherScan(partition: string): Promise<{ catches: SyncDoc[]; ponds: SyncDoc[]; weather: WeatherStamp[] }>;
}

export function createCosmosStore(container: Container): DocStore {
  async function query<T>(q: { query: string; parameters: { name: string; value: unknown }[] }, partition?: string): Promise<T[]> {
    const { resources } = await container.items
      .query<T>(q as never, partition ? { partitionKey: partition } : {})
      .fetchAll();
    return resources;
  }

  return {
    async read(id, partition) {
      try {
        const { resource } = await container.item(id, partition).read<SyncDoc>();
        return resource ?? undefined;
      } catch (e) {
        if ((e as { code?: number }).code === 404) return undefined;
        throw e;
      }
    },

    async upsert(doc) {
      await container.items.upsert(doc);
    },

    async remove(id, partition) {
      try {
        await container.item(id, partition).delete();
      } catch (e) {
        if ((e as { code?: number }).code !== 404) throw e;
      }
    },

    partitionChanges(partition, since) {
      return query<SyncDoc>(
        since === null
          ? {
              query: "SELECT * FROM c WHERE c.userId = @p AND c.type != 'pondInvite' ORDER BY c.serverUpdatedAt ASC",
              parameters: [{ name: '@p', value: partition }],
            }
          : {
              query:
                "SELECT * FROM c WHERE c.userId = @p AND c.type != 'pondInvite' AND c.serverUpdatedAt > @since ORDER BY c.serverUpdatedAt ASC",
              parameters: [
                { name: '@p', value: partition },
                { name: '@since', value: since },
              ],
            },
        partition,
      );
    },

    membershipsOf(memberId) {
      return query<PondMemberDoc>({
        query: "SELECT * FROM c WHERE c.type = 'pondMember' AND c.memberId = @m",
        parameters: [{ name: '@m', value: memberId }],
      });
    },

    pondChanges(ownerId, pondId, since) {
      const base =
        "SELECT * FROM c WHERE c.userId = @o AND ((c.type = 'pond' AND c.id = @pond) OR (c.pondId = @pond AND c.type IN ('catch', 'feedingLog', 'photo', 'catchWeather')))";
      const parameters = [
        { name: '@o', value: ownerId },
        { name: '@pond', value: pondId },
      ];
      return query<SyncDoc>(
        since === null
          ? { query: base, parameters }
          : { query: `${base} AND c.serverUpdatedAt > @since`, parameters: [...parameters, { name: '@since', value: since }] },
        ownerId,
      );
    },

    photosForCatches(ownerId, catchIds) {
      if (!catchIds.length) return Promise.resolve([]);
      return query<SyncDoc>(
        {
          query: "SELECT * FROM c WHERE c.userId = @o AND c.type = 'photo' AND ARRAY_CONTAINS(@ids, c.catchId)",
          parameters: [
            { name: '@o', value: ownerId },
            { name: '@ids', value: catchIds },
          ],
        },
        ownerId,
      );
    },

    async weatherScan(partition) {
      const params = [{ name: '@p', value: partition }];
      const [catches, ponds, weather] = await Promise.all([
        query<SyncDoc>(
          {
            query:
              "SELECT c.id, c.type, c.userId, c.pondId, c.caughtAt, c.lat, c.lon, c.updatedAt FROM c WHERE c.userId = @p AND c.type = 'catch' AND NOT IS_DEFINED(c.deletedAt) ORDER BY c.caughtAt DESC",
            parameters: params,
          },
          partition,
        ),
        query<SyncDoc>(
          { query: "SELECT c.id, c.type, c.userId, c.lat, c.lon, c.updatedAt FROM c WHERE c.userId = @p AND c.type = 'pond'", parameters: params },
          partition,
        ),
        query<WeatherStamp>(
          {
            query: "SELECT c.catchId, c.caughtAt, c.lat, c.lon, c.status, c.updatedAt FROM c WHERE c.userId = @p AND c.type = 'catchWeather'",
            parameters: params,
          },
          partition,
        ),
      ]);
      return { catches, ponds, weather };
    },

    async findInvite(code) {
      const rows = await query<PondInviteDoc>({
        query: "SELECT * FROM c WHERE c.type = 'pondInvite' AND c.code = @code",
        parameters: [{ name: '@code', value: code }],
      });
      return rows[0];
    },
  };
}

let store: DocStore | undefined;

export function getStore(): DocStore {
  if (!store) store = createCosmosStore(getDocsContainer());
  return store;
}
