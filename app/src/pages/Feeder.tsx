import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import type { FeedingLogRow } from '../db/db';
import { repo } from '../db/repo';
import { usePond } from '../hooks/usePonds';

const DEFAULT_TIMES = ['07:00', '19:00'];

/** Feeder schedule for one pond: what's running now, change/stop/start, fills, and history. */
export function Feeder() {
  const { id = '' } = useParams();
  const pond = usePond(id);
  const logs = useLiveQuery(() => repo.listFeedingLogs(id), [id]);
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  if (pond === undefined || logs === undefined) return <div className="page muted">Loading…</div>;
  if (!pond) return <div className="page empty">Pond not found.</div>;

  const schedules = logs.filter((f) => f.kind !== 'fill');
  const fills = logs.filter((f) => f.kind === 'fill');
  const running = schedules.find((f) => !f.endedOn);
  const last = running ?? schedules[0];
  const lastFill = fills[0];

  const stop = async () => {
    await repo.stopFeeder(pond.id);
    toast.show({ message: 'Feeder marked off as of today' });
  };
  const fill = async () => {
    const previousLbs = lastFill?.lbsPerFill;
    await repo.logFeederFill(pond.id, previousLbs);
    toast.show({ message: previousLbs ? `Logged a ${previousLbs} lb fill` : 'Logged a fill' });
  };

  return (
    <div className="page stack">
      <h1>{pond.name}</h1>
      <div className="subtabs">
        <Link to={`/ponds/${pond.id}`}>Dashboard</Link>
        <Link to={`/ponds/${pond.id}/catches`}>Catches</Link>
        <Link to={`/ponds/${pond.id}/feeder`} className="active">
          Feeder
        </Link>
        <Link to={`/ponds/${pond.id}/edit`}>Edit</Link>
      </div>

      {editing ? (
        <ScheduleForm
          initial={last}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await repo.startFeederSchedule(pond.id, input);
            setEditing(false);
            toast.show({ message: running ? 'Schedule updated from today' : 'Feeder on from today' });
          }}
        />
      ) : (
        <div className="card stack">
          <div className="row between">
            <h3 style={{ margin: 0 }}>{running ? 'Feeder on' : 'Feeder off'}</h3>
            <span className={`feeder-dot ${running ? 'on' : ''}`} aria-hidden />
          </div>
          {running ? (
            <>
              <div className="feeder-times">
                {(running.feedTimes ?? []).map((t) => (
                  <span key={t} className="feeder-time">
                    {formatTime(t)}
                  </span>
                ))}
                {!running.feedTimes?.length && running.feedsPerDay ? <span>{running.feedsPerDay}× daily</span> : null}
              </div>
              <div className="muted">
                {running.secondsPerFeed ? `${running.secondsPerFeed} s per feeding · ` : ''}since {formatDate(running.startedOn)}
              </div>
            </>
          ) : (
            <div className="muted">
              {last?.endedOn ? `Last ran ${formatDate(last.startedOn)} – ${formatDate(last.endedOn)}` : 'No feeder schedule logged for this pond yet.'}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" style={{ flex: 1 }} onClick={() => setEditing(true)}>
              {running ? 'Change schedule' : last ? 'Turn on' : 'Set up feeder'}
            </button>
            {running ? (
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void stop()}>
                Turn off
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="card stack">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Hopper</h3>
          <span className="muted">{lastFill ? `last filled ${formatDate(lastFill.startedOn)}` : 'no fills logged'}</span>
        </div>
        <button type="button" className="btn" onClick={() => void fill()}>
          Filled it today
        </button>
      </div>

      {logs.length ? (
        <>
          <h2>History</h2>
          <div className="list">
            {logs.map((f) => (
              <HistoryRow key={f.id} f={f} onDelete={() => void repo.softDeleteFeedingLog(f.id)} />
            ))}
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            The Wr-by-month chart on the dashboard is shaded for each period the feeder was on.
          </div>
        </>
      ) : null}
    </div>
  );
}

interface ScheduleInputUi {
  feedTimes: string[];
  secondsPerFeed?: number;
  feederModel?: string;
  pelletSizeMm?: number;
}

function ScheduleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: FeedingLogRow | undefined;
  onSave: (v: ScheduleInputUi) => Promise<void>;
  onCancel: () => void;
}) {
  const [times, setTimes] = useState<string[]>(initial?.feedTimes?.length ? initial.feedTimes : DEFAULT_TIMES);
  const [seconds, setSeconds] = useState(initial?.secondsPerFeed ? String(initial.secondsPerFeed) : '');
  const [model, setModel] = useState(initial?.feederModel ?? '');
  const [pellet, setPellet] = useState(initial?.pelletSizeMm ? String(initial.pelletSizeMm) : '');
  const [saving, setSaving] = useState(false);
  const valid = times.length > 0 && times.every((t) => /^\d{2}:\d{2}$/.test(t));

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const optNum = (v: string) => {
    const n = Number(v);
    return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Feeder schedule</h3>
      <div className="muted" style={{ fontSize: 14 }}>Takes effect today. The previous settings stay in the history.</div>

      <div className="field">
        <label>Feed times</label>
        <div className="stack" style={{ gap: 8 }}>
          {times.map((t, i) => (
            <div className="row" key={i} style={{ gap: 8 }}>
              <input
                type="time"
                aria-label={`Feed time ${i + 1}`}
                value={t}
                onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                aria-label={`Remove feed time ${i + 1}`}
                disabled={times.length === 1}
                onClick={() => setTimes(times.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setTimes([...times, '12:00'])}>
            + Add a feed time
          </button>
        </div>
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="secs">Seconds per feeding</label>
          <input id="secs" type="number" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} placeholder="e.g. 8" />
        </div>
        <div className="field">
          <label htmlFor="pellet">Pellet size (mm)</label>
          <input id="pellet" type="number" inputMode="decimal" value={pellet} onChange={(e) => setPellet(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="model">Feeder</label>
        <input id="model" type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="optional, e.g. Texas Hunter" />
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn primary"
          style={{ flex: 1 }}
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                feedTimes: times,
                secondsPerFeed: optNum(seconds),
                pelletSizeMm: optNum(pellet),
                feederModel: model.trim() || undefined,
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          Save
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function HistoryRow({ f, onDelete }: { f: FeedingLogRow; onDelete: () => void }) {
  const isFill = f.kind === 'fill';
  const title = isFill
    ? `Filled${f.lbsPerFill ? ` · ${f.lbsPerFill} lb` : ''}`
    : `${f.feedTimes?.length ? f.feedTimes.map(formatTime).join(', ') : `${f.feedsPerDay ?? '?'}× daily`}${f.secondsPerFeed ? ` · ${f.secondsPerFeed} s` : ''}`;
  const when = isFill
    ? formatDate(f.startedOn)
    : `${formatDate(f.startedOn)} – ${f.endedOn ? formatDate(f.endedOn) : 'now'}`;
  return (
    <div className="list-item" style={{ cursor: 'default' }}>
      <div className="main">
        <div className="title">{title}</div>
        <div className="sub">{when}</div>
      </div>
      <button type="button" className="btn" aria-label="Delete entry" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
