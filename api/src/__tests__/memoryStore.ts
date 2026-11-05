import type { DocStore } from '../store';
import type { PondInviteDoc, PondMemberDoc, SyncDoc } from '../types';
import type { WeatherStamp } from '../weather';

/** In-memory DocStore with the same semantics as the Cosmos queries in store.ts. */
export function createMemoryStore() {
  const docs = new Map<string, SyncDoc>();
  const key = (id: string, partition: string) => `${partition}|${id}`;
  const all = () => [...docs.values()].map((d) => structuredClone(d));
  const after = (since: string | null) => (d: SyncDoc) => since === null || String(d.serverUpdatedAt ?? '') > since;
  const byServerTime = (a: SyncDoc, b: SyncDoc) => String(a.serverUpdatedAt ?? '').localeCompare(String(b.serverUpdatedAt ?? ''));

  const store: DocStore = {
    async read(id, partition) {
      const d = docs.get(key(id, partition));
      return d ? structuredClone(d) : undefined;
    },
    async upsert(doc) {
      docs.set(key(doc.id, doc.userId), structuredClone(doc));
    },
    async remove(id, partition) {
      docs.delete(key(id, partition));
    },
    async partitionChanges(partition, since) {
      return all()
        .filter((d) => d.userId === partition && d.type !== 'pondInvite')
        .filter(after(since))
        .sort(byServerTime);
    },
    async membershipsOf(memberId) {
      return all().filter((d) => d.type === 'pondMember' && d['memberId'] === memberId) as PondMemberDoc[];
    },
    async pondChanges(ownerId, pondId, since) {
      return all()
        .filter((d) => d.userId === ownerId)
        .filter(
          (d) =>
            (d.type === 'pond' && d.id === pondId) ||
            (d['pondId'] === pondId && ['catch', 'feedingLog', 'photo', 'catchWeather'].includes(d.type)),
        )
        .filter(after(since));
    },
    async photosForCatches(ownerId, catchIds) {
      return all().filter((d) => d.userId === ownerId && d.type === 'photo' && catchIds.includes(String(d['catchId'])));
    },
    async weatherScan(partition) {
      const mine = all().filter((d) => d.userId === partition);
      return {
        catches: mine.filter((d) => d.type === 'catch' && !d.deletedAt).sort((a, b) => String(b['caughtAt']).localeCompare(String(a['caughtAt']))),
        ponds: mine.filter((d) => d.type === 'pond'),
        weather: mine.filter((d) => d.type === 'catchWeather') as unknown as WeatherStamp[],
      };
    },
    async findInvite(code) {
      return all().find((d) => d.type === 'pondInvite' && d['code'] === code) as PondInviteDoc | undefined;
    },
  };

  return { store, docs, get: (id: string, partition: string) => docs.get(key(id, partition)) };
}

/** A clock that ticks 1 s per call so serverUpdatedAt values are distinct and ordered. */
export function tickingClock(start = '2026-06-01T12:00:00.000Z') {
  let t = Date.parse(start);
  const now = () => new Date((t += 1000));
  return { now, peek: () => new Date(t).toISOString() };
}
