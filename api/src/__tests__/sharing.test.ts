import { describe, expect, it } from 'vitest';
import { HttpError } from '../http';
import {
  applyChanges,
  createInvite,
  fetchChanges,
  joinWithCode,
  leavePond,
  loadAccess,
  memberDocId,
  normalizeInviteCode,
  removeMember,
  resolvePhotoBlob,
  type Viewer,
} from '../sharing';
import type { SyncDoc } from '../types';
import { createMemoryStore, tickingClock } from './memoryStore';

const OWNER: Viewer = { userId: 'owner-1', name: 'sean@example.com' };
const BUDDY: Viewer = { userId: 'buddy-2', name: 'buddy@example.com' };
const STRANGER: Viewer = { userId: 'stranger-3', name: 'nobody@example.com' };

const pond = (id: string, updatedAt = '2026-05-01T00:00:00.000Z', extra: Record<string, unknown> = {}): SyncDoc => ({
  id,
  type: 'pond',
  userId: 'ignored',
  name: `Pond ${id}`,
  updatedAt,
  ...extra,
});
const fish = (id: string, pondId: string, updatedAt = '2026-05-01T00:00:00.000Z', extra: Record<string, unknown> = {}): SyncDoc => ({
  id,
  type: 'catch',
  userId: 'ignored',
  pondId,
  lengthIn: 15,
  weightLb: 1.5,
  updatedAt,
  ...extra,
});

async function setup() {
  const mem = createMemoryStore();
  const clock = tickingClock();
  const push = async (v: Viewer, changes: SyncDoc[]) => applyChanges(mem.store, v, await loadAccess(mem.store, v.userId), changes, clock.now);
  const pull = async (v: Viewer, since: string | null) => fetchChanges(mem.store, v, await loadAccess(mem.store, v.userId), since);
  /** Owner has a pond P1 with one catch; buddy joins it. Returns the time just before the join. */
  const share = async () => {
    await push(OWNER, [pond('P1'), fish('C-owner', 'P1')]);
    const { code } = await createInvite(mem.store, OWNER, 'P1', clock.now, () => 'ABCD2345');
    const beforeJoin = clock.peek();
    await joinWithCode(mem.store, BUDDY, 'abcd-2345', clock.now);
    return { code, beforeJoin };
  };
  return { mem, clock, push, pull, share };
}

describe('single-user sync (unchanged behaviour)', () => {
  it('stores records in the caller’s partition, ignoring a forged userId', async () => {
    const { mem, push, pull } = await setup();
    await push(OWNER, [pond('P1', undefined, { userId: BUDDY.userId })]);
    expect(mem.get('P1', OWNER.userId)).toBeDefined();
    expect(mem.get('P1', BUDDY.userId)).toBeUndefined();
    expect((await pull(BUDDY, null)).length).toBe(0);
  });

  it('keeps last-writer-wins on updatedAt', async () => {
    const { mem, push } = await setup();
    await push(OWNER, [fish('C1', 'P1', '2026-05-02T00:00:00.000Z', { weightLb: 2 })]);
    const res = await push(OWNER, [fish('C1', 'P1', '2026-05-01T00:00:00.000Z', { weightLb: 9 })]);
    expect(res.applied).toBe(0);
    expect(mem.get('C1', OWNER.userId)?.['weightLb']).toBe(2);
  });

  it('stamps loggedBy on new catches and never trusts the client’s', async () => {
    const { mem, push, pull } = await setup();
    await push(OWNER, [fish('C1', 'P1', undefined, { loggedBy: BUDDY.userId })]);
    expect(mem.get('C1', OWNER.userId)?.['loggedBy']).toBe(OWNER.userId);
    const out = await pull(OWNER, null);
    expect(out.find((d) => d.id === 'C1')?.['loggedBy']).toBe(OWNER.userId);
  });

  it('fills loggedBy for catches written before sharing existed', async () => {
    const { mem, pull } = await setup();
    await mem.store.upsert({ ...fish('OLD', 'P1'), userId: OWNER.userId, serverUpdatedAt: '2026-01-01T00:00:00.000Z' });
    const out = await pull(OWNER, null);
    expect(out.find((d) => d.id === 'OLD')?.['loggedBy']).toBe(OWNER.userId);
  });
});

describe('invites', () => {
  it('normalizes codes typed loosely', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('abcd 2345')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABCD234')).toBeUndefined();
    expect(normalizeInviteCode('ABCD234O')).toBeUndefined(); // O isn't in the alphabet
    expect(normalizeInviteCode(42)).toBeUndefined();
  });

  it('only the owner can invite to a pond', async () => {
    const { mem, clock, push } = await setup();
    await push(OWNER, [pond('P1')]);
    await expect(createInvite(mem.store, BUDDY, 'P1', clock.now)).rejects.toMatchObject({ status: 404 });
  });

  it('can’t invite to a deleted pond', async () => {
    const { mem, clock, push } = await setup();
    await push(OWNER, [pond('P1', undefined, { deletedAt: '2026-05-01T00:00:00.000Z' })]);
    await expect(createInvite(mem.store, OWNER, 'P1', clock.now)).rejects.toMatchObject({ status: 404 });
  });

  it('a code works once', async () => {
    const { mem, clock, share } = await setup();
    const { code } = await share();
    await expect(joinWithCode(mem.store, STRANGER, code, clock.now)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects expired codes and cleans them up', async () => {
    const { mem, push } = await setup();
    await push(OWNER, [pond('P1')]);
    const t0 = new Date('2026-06-01T00:00:00.000Z');
    await createInvite(mem.store, OWNER, 'P1', () => t0, () => 'ZZZZ9999');
    const later = () => new Date('2026-06-09T00:00:00.000Z');
    await expect(joinWithCode(mem.store, BUDDY, 'ZZZZ9999', later)).rejects.toMatchObject({ status: 410 });
    expect(await mem.store.findInvite('ZZZZ9999')).toBeUndefined();
  });

  it('you can’t join your own pond', async () => {
    const { mem, clock, push } = await setup();
    await push(OWNER, [pond('P1')]);
    await createInvite(mem.store, OWNER, 'P1', clock.now, () => 'ABCD2345');
    await expect(joinWithCode(mem.store, OWNER, 'ABCD2345', clock.now)).rejects.toBeInstanceOf(HttpError);
  });

  it('invites never show up in the owner’s pull', async () => {
    const { mem, clock, push, pull } = await setup();
    await push(OWNER, [pond('P1')]);
    await createInvite(mem.store, OWNER, 'P1', clock.now);
    expect((await pull(OWNER, null)).some((d) => d.type === 'pondInvite')).toBe(false);
  });
});

describe('a member of a shared pond', () => {
  it('pulls the whole pond, the membership and the owner’s catches on first sync after joining', async () => {
    const { pull, share } = await setup();
    const { beforeJoin } = await share();
    const out = await pull(BUDDY, beforeJoin);
    expect(out.map((d) => d.id).sort()).toEqual(['C-owner', 'P1', memberDocId('P1', BUDDY.userId)].sort());
    const c = out.find((d) => d.id === 'C-owner')!;
    expect(c['loggedBy']).toBe(OWNER.userId);
    const m = out.find((d) => d.type === 'pondMember')!;
    expect(m).toMatchObject({ pondId: 'P1', ownerId: OWNER.userId, ownerName: OWNER.name, memberId: BUDDY.userId, pondName: 'Pond P1' });
  });

  it('then pulls only new changes', async () => {
    const { clock, push, pull, share } = await setup();
    await share();
    const since = clock.peek();
    await push(OWNER, [fish('C-owner-2', 'P1')]);
    const out = await pull(BUDDY, since);
    expect(out.map((d) => d.id)).toEqual(['C-owner-2']);
  });

  it('logs catches into the owner’s partition, stamped with who caught them', async () => {
    const { mem, clock, push, pull, share } = await setup();
    await share();
    const since = clock.peek();
    const res = await push(BUDDY, [fish('C-buddy', 'P1', undefined, { loggedBy: OWNER.userId })]);
    expect(res).toMatchObject({ applied: 1, rejected: [] });
    expect(mem.get('C-buddy', BUDDY.userId)).toBeUndefined();
    expect(mem.get('C-buddy', OWNER.userId)).toMatchObject({ loggedBy: BUDDY.userId, loggedByName: BUDDY.name });
    // The owner sees it on their next pull, and so does the buddy's other phone.
    expect((await pull(OWNER, since)).map((d) => d.id)).toContain('C-buddy');
    expect((await pull(BUDDY, since)).map((d) => d.id)).toContain('C-buddy');
  });

  it('can edit and delete their own catch', async () => {
    const { mem, push, share } = await setup();
    await share();
    await push(BUDDY, [fish('C-buddy', 'P1', '2026-05-01T00:00:00.000Z')]);
    const res = await push(BUDDY, [fish('C-buddy', 'P1', '2026-05-03T00:00:00.000Z', { weightLb: 3, deletedAt: '2026-05-03T00:00:00.000Z' })]);
    expect(res.rejected).toEqual([]);
    expect(mem.get('C-buddy', OWNER.userId)).toMatchObject({ weightLb: 3, loggedBy: BUDDY.userId, deletedAt: '2026-05-03T00:00:00.000Z' });
  });

  it('can’t edit the owner’s catch, and gets the server copy back', async () => {
    const { mem, push, share } = await setup();
    await share();
    const res = await push(BUDDY, [fish('C-owner', 'P1', '2026-05-09T00:00:00.000Z', { weightLb: 99 })]);
    expect(res.applied).toBe(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]).toMatchObject({ id: 'C-owner', type: 'catch', doc: { weightLb: 1.5, loggedBy: OWNER.userId } });
    expect(mem.get('C-owner', OWNER.userId)?.['weightLb']).toBe(1.5);
  });

  it('can’t move a catch out of a shared pond', async () => {
    const { mem, push, share } = await setup();
    await share();
    await push(BUDDY, [fish('C-buddy', 'P1', '2026-05-01T00:00:00.000Z')]);
    // A catch pushed with another pond id is treated as the buddy's own record, never as a write to the owner's copy.
    await push(BUDDY, [fish('C-buddy', 'BUDDY-POND', '2026-05-02T00:00:00.000Z')]);
    expect(mem.get('C-buddy', OWNER.userId)?.['pondId']).toBe('P1');
  });

  it('can’t change the pond or its feeder', async () => {
    const { mem, push, share } = await setup();
    await share();
    const res = await push(BUDDY, [
      pond('P1', '2026-05-09T00:00:00.000Z', { name: 'Hijacked' }),
      { id: 'F1', type: 'feedingLog', userId: 'x', pondId: 'P1', startedOn: '2026-05-01', updatedAt: '2026-05-09T00:00:00.000Z' },
    ]);
    expect(res.applied).toBe(0);
    expect(res.rejected.map((r) => r.id)).toEqual(['P1', 'F1']);
    expect(res.rejected[0]?.doc?.['name']).toBe('Pond P1');
    expect(res.rejected[1]?.doc).toBeUndefined(); // nothing to restore: the client drops its row
    expect(mem.get('P1', OWNER.userId)?.['name']).toBe('Pond P1');
    expect(mem.get('F1', OWNER.userId)).toBeUndefined();
    expect(mem.get('F1', BUDDY.userId)).toBeUndefined();
  });

  it('still owns their own ponds normally', async () => {
    const { mem, push, pull, share } = await setup();
    await share();
    await push(BUDDY, [pond('BP'), fish('BC', 'BP')]);
    expect(mem.get('BC', BUDDY.userId)?.['loggedBy']).toBe(BUDDY.userId);
    expect((await pull(OWNER, null)).some((d) => d.id === 'BP' || d.id === 'BC')).toBe(false);
  });
});

describe('the owner of a shared pond', () => {
  it('sees the member list and can edit a member’s catch', async () => {
    const { mem, push, pull, share } = await setup();
    await share();
    await push(BUDDY, [fish('C-buddy', 'P1', '2026-05-01T00:00:00.000Z')]);
    const out = await pull(OWNER, null);
    expect(out.find((d) => d.type === 'pondMember')).toMatchObject({ memberId: BUDDY.userId, memberName: BUDDY.name });
    const res = await push(OWNER, [fish('C-buddy', 'P1', '2026-05-05T00:00:00.000Z', { weightLb: 2.2 })]);
    expect(res.rejected).toEqual([]);
    expect(mem.get('C-buddy', OWNER.userId)).toMatchObject({ weightLb: 2.2, loggedBy: BUDDY.userId });
  });

  it('can remove a member, who then loses access and is told so on their next pull', async () => {
    const { mem, clock, push, pull, share } = await setup();
    await share();
    const since = clock.peek();
    await removeMember(mem.store, OWNER, 'P1', BUDDY.userId, clock.now);

    const out = await pull(BUDDY, since);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'pondMember', pondId: 'P1' });
    expect(out[0]?.deletedAt).toBeDefined();
    expect((await pull(BUDDY, null)).filter((d) => d.type !== 'pondMember')).toEqual([]);

    // A catch the buddy logged offline before being removed is refused, not filed under their own account.
    const res = await push(BUDDY, [fish('C-late', 'P1')]);
    expect(res.rejected).toMatchObject([{ id: 'C-late' }]);
    expect(res.rejected[0]?.doc).toBeUndefined();
    expect(mem.get('C-late', BUDDY.userId)).toBeUndefined();
    expect(mem.get('C-late', OWNER.userId)).toBeUndefined();
  });

  it('only the owner can remove members', async () => {
    const { mem, clock, share } = await setup();
    await share();
    await expect(removeMember(mem.store, STRANGER, 'P1', BUDDY.userId, clock.now)).rejects.toMatchObject({ status: 404 });
    await expect(removeMember(mem.store, BUDDY, 'P1', BUDDY.userId, clock.now)).rejects.toMatchObject({ status: 404 });
  });
});

describe('leaving and rejoining', () => {
  it('a member can leave, and rejoining sends the whole pond again', async () => {
    const { mem, clock, push, pull, share } = await setup();
    await share();
    await leavePond(mem.store, BUDDY, 'P1', clock.now);
    expect((await loadAccess(mem.store, BUDDY.userId)).shared.size).toBe(0);
    await expect(leavePond(mem.store, BUDDY, 'P1', clock.now)).rejects.toMatchObject({ status: 404 });

    await push(OWNER, [fish('C-while-away', 'P1')]);
    await createInvite(mem.store, OWNER, 'P1', clock.now, () => 'WXYZ6789');
    const before = clock.peek();
    await joinWithCode(mem.store, BUDDY, 'WXYZ6789', clock.now);
    const ids = (await pull(BUDDY, before)).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['P1', 'C-owner', 'C-while-away']));
    const m = mem.get(memberDocId('P1', BUDDY.userId), OWNER.userId);
    expect(m?.deletedAt).toBeUndefined();
  });
});

describe('a stranger', () => {
  it('sees nothing of other people’s ponds', async () => {
    const { pull, share } = await setup();
    await share();
    expect(await pull(STRANGER, null)).toEqual([]);
  });

  it('can’t write into someone’s pond by guessing its id', async () => {
    const { mem, push, share } = await setup();
    await share();
    await push(STRANGER, [fish('C-owner', 'P1', '2026-05-09T00:00:00.000Z', { weightLb: 0 })]);
    expect(mem.get('C-owner', OWNER.userId)?.['weightLb']).toBe(1.5);
  });
});

describe('photos', () => {
  const photo = (id: string, catchId: string): SyncDoc => ({ id, type: 'photo', userId: 'x', catchId, updatedAt: '2026-05-01T00:00:00.000Z' });

  it('a member’s photo on their catch is filed with the pond and readable by owner and member', async () => {
    const { mem, push, share } = await setup();
    await share();
    await push(BUDDY, [fish('C-buddy', 'P1'), photo('ph-1', 'C-buddy')]);
    expect(mem.get('ph-1', OWNER.userId)).toMatchObject({ pondId: 'P1', blobPath: `${BUDDY.userId}/ph-1.jpg` });

    const ownerAccess = await loadAccess(mem.store, OWNER.userId);
    const buddyAccess = await loadAccess(mem.store, BUDDY.userId);
    const strangerAccess = await loadAccess(mem.store, STRANGER.userId);
    expect(await resolvePhotoBlob(mem.store, OWNER.userId, 'ph-1', ownerAccess)).toBe(`${BUDDY.userId}/ph-1.jpg`);
    expect(await resolvePhotoBlob(mem.store, BUDDY.userId, 'ph-1', buddyAccess)).toBe(`${BUDDY.userId}/ph-1.jpg`);
    // A stranger only ever gets a path in their own folder, which won't exist.
    expect(await resolvePhotoBlob(mem.store, STRANGER.userId, 'ph-1', strangerAccess)).toBe(`${STRANGER.userId}/ph-1.jpg`);
  });

  it('a member can’t put a photo on the owner’s catch', async () => {
    const { push, share } = await setup();
    await share();
    const res = await push(BUDDY, [photo('ph-2', 'C-owner')]);
    expect(res.rejected).toMatchObject([{ id: 'ph-2', type: 'photo' }]);
  });

  it('older owner photos without a pondId reach a new member and resolve to the owner’s folder', async () => {
    const { mem, clock, pull, share } = await setup();
    await mem.store.upsert({ ...photo('ph-old', 'C-owner'), userId: OWNER.userId, serverUpdatedAt: '2026-01-01T00:00:00.000Z' });
    const { beforeJoin } = await share();
    expect((await pull(BUDDY, beforeJoin)).map((d) => d.id)).toContain('ph-old');
    const access = await loadAccess(mem.store, BUDDY.userId);
    expect(await resolvePhotoBlob(mem.store, BUDDY.userId, 'ph-old', access)).toBe(`${OWNER.userId}/ph-old.jpg`);
  });

  it('never sends blobPath to the client', async () => {
    const { pull, push, share } = await setup();
    await share();
    await push(BUDDY, [fish('C-buddy', 'P1'), photo('ph-1', 'C-buddy')]);
    const out = await pull(OWNER, null);
    expect(out.find((d) => d.id === 'ph-1')).not.toHaveProperty('blobPath');
  });
});
