import { beforeEach, describe, expect, it } from 'vitest';
import { PondTrackerDB } from '../db';
import { createRepo } from '../repo';

let repo: ReturnType<typeof createRepo>;
let pondId: string;

beforeEach(async () => {
  const db = new PondTrackerDB(`feeder-${crypto.randomUUID()}`);
  repo = createRepo(db);
  const pond = await repo.savePond({
    name: 'P',
    geofenceM: 150,
    cullSlotMinIn: 8,
    cullSlotMaxIn: 13,
    wrThresholds: { low: 85, ok: 95, high: 110 },
  });
  pondId = pond.id;
});

describe('feeder schedule', () => {
  it('starting a new schedule closes the running one the day before', async () => {
    await repo.startFeederSchedule(pondId, { feedTimes: ['19:00', '07:00'], secondsPerFeed: 8, startedOn: '2026-04-01' });
    await repo.startFeederSchedule(pondId, { feedTimes: ['08:00'], startedOn: '2026-06-15' });
    const logs = await repo.listFeedingLogs(pondId);
    const [current, previous] = logs;
    expect(current?.startedOn).toBe('2026-06-15');
    expect(current?.endedOn).toBeUndefined();
    expect(current?.feedsPerDay).toBe(1);
    expect(previous?.feedTimes).toEqual(['07:00', '19:00']);
    expect(previous?.endedOn).toBe('2026-06-14');
    expect((await repo.currentFeederSchedule(pondId))?.id).toBe(current?.id);
  });

  it('changing settings on the day a schedule started edits it in place', async () => {
    await repo.startFeederSchedule(pondId, { feedTimes: ['07:00'], startedOn: '2026-05-01' });
    await repo.startFeederSchedule(pondId, { feedTimes: ['07:00', '19:00'], startedOn: '2026-05-01' });
    const logs = await repo.listFeedingLogs(pondId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.feedsPerDay).toBe(2);
  });

  it('stopFeeder ends the running schedule; fills are not schedules', async () => {
    await repo.startFeederSchedule(pondId, { feedTimes: ['07:00'], startedOn: '2026-04-01' });
    await repo.logFeederFill(pondId, 50, '2026-05-10');
    await repo.stopFeeder(pondId, '2026-10-15');
    expect(await repo.currentFeederSchedule(pondId)).toBeUndefined();
    const logs = await repo.listFeedingLogs(pondId);
    expect(logs.find((f) => f.kind === 'fill')?.lbsPerFill).toBe(50);
    expect(logs.find((f) => f.kind === 'schedule')?.endedOn).toBe('2026-10-15');
  });
});
