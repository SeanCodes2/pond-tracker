import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PondMemberRow, PondRow } from '../db/db';
import { clearLastPond } from '../hooks/useCurrentPond';
import { ShareError, createInvite, formatCode, joinPond, leavePond, removeMember, shortName } from '../lib/sharing';
import { syncNow } from '../sync/sync';
import { ConfirmSheet } from './ConfirmSheet';
import { PondTabs } from './PondTabs';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

const errorText = (e: unknown) => (e instanceof ShareError ? e.message : 'Something went wrong. Try again.');

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// ---------------------------------------------------------------------------------------------
// Owner: invite people and manage who has access
// ---------------------------------------------------------------------------------------------

export function SharingCard({ pond, members }: { pond: PondRow; members: PondMemberRow[] }) {
  const toast = useToast();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PondMemberRow | null>(null);

  if (pond.sample === 1) {
    return (
      <div className="card">
        <h3>Sharing</h3>
        <div className="muted">The sample pond stays on this phone and can’t be shared.</div>
      </div>
    );
  }

  const makeCode = async () => {
    setBusy(true);
    setError(null);
    try {
      // Make sure the pond (and any recent edits) are on the server before asking for a code.
      if (pond.pending === 1) await syncNow();
      setInvite(await createInvite(pond.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shareCode = async () => {
    if (!invite) return;
    const text =
      `Join my pond "${pond.name}" in Pond Tracker: open ${window.location.origin}, go to Ponds → Join, ` +
      `and enter ${formatCode(invite.code)}. The code works once and expires ${longDate(invite.expiresAt)}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Join ${pond.name}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.show({ message: 'Invite copied. Paste it into a text.' });
    } catch {
      // Share sheet dismissed: nothing to do.
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removeMember(pond.id, removing.memberId);
      await syncNow();
      toast.show({ message: `${shortName(removing.memberName)} no longer has access` });
      setRemoving(null);
    } catch (e) {
      toast.show({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Sharing</h3>
      <div className="muted" style={{ fontSize: 15 }}>
        People you share with see this pond, every catch in it and the feeder history, and can log their own catches.
        They can’t change the pond, the feeder or anyone else’s catches.
      </div>

      {members.length ? (
        <div className="list">
          {members.map((m) => (
            <div key={m.id} className="list-item member-row" style={{ cursor: 'default' }}>
              <div className="main">
                <div className="title">{shortName(m.memberName)}</div>
                <div className="sub">
                  {m.memberName} · joined {longDate(m.joinedAt)}
                </div>
              </div>
              <button type="button" className="btn" onClick={() => setRemoving(m)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div> : null}
      <button type="button" className="btn primary block" disabled={busy} onClick={() => void makeCode()}>
        {busy && !removing ? 'Getting a code…' : 'Invite someone'}
      </button>

      <Sheet open={invite !== null} title="Invite code" onClose={() => setInvite(null)}>
        {invite ? (
          <>
            <div className="invite-code" aria-label={`Code ${invite.code.split('').join(' ')}`}>
              {formatCode(invite.code)}
            </div>
            <div className="muted" style={{ textAlign: 'center', marginBottom: 12 }}>
              Works for one person · expires {longDate(invite.expiresAt)}
            </div>
            <div className="notice">
              They need to be able to sign in to the app first. If they can’t yet, invite them in the Azure portal
              (Static Web App → Role management, role <b>angler</b>).
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn primary block" onClick={() => void shareCode()}>
                Send code
              </button>
              <button type="button" className="btn block" onClick={() => setInvite(null)}>
                Done
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={removing !== null}
        title={`Remove ${shortName(removing?.memberName)}?`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        The pond disappears from their phone. Catches they logged here stay in your pond.
      </ConfirmSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Member: read-only pond details, and leaving
// ---------------------------------------------------------------------------------------------

export function MemberPondView({ pond, membership }: { pond: PondRow; membership: PondMemberRow }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = shortName(membership.ownerName);

  const leave = async () => {
    setBusy(true);
    try {
      await leavePond(pond.id);
      clearLastPond(pond.id);
      toast.show({ message: `You left ${pond.name}` });
      navigate('/ponds', { replace: true });
    } catch (e) {
      toast.show({ message: errorText(e) });
      setBusy(false);
      setConfirm(false);
    }
  };

  const rows: [string, string | undefined][] = [
    ['Owner', membership.ownerName],
    ['Size', pond.acres !== undefined ? `${pond.acres} acres` : undefined],
    ['Max depth', pond.depthFt !== undefined ? `${pond.depthFt} ft` : undefined],
    ['Stocked', pond.stockedOn],
    ['Bass harvest range', `${pond.cullSlotMinIn}–${pond.cullSlotMaxIn} in`],
    ['Wr thresholds', `${pond.wrThresholds.low} / ${pond.wrThresholds.ok} / ${pond.wrThresholds.high}`],
    ['You joined', longDate(membership.joinedAt)],
  ];

  return (
    <div className="page">
      <h1>{pond.name}</h1>
      <PondTabs pondId={pond.id} active="edit" />
      <div className="card stack">
        <div className="muted" style={{ fontSize: 15 }}>
          {owner} shared this pond with you. You can log catches here and edit the ones you logged; {owner} manages the
          pond settings and feeder.
        </div>
        <dl className="detail-list">
          {rows
            .filter((r): r is [string, string] => r[1] !== undefined)
            .map(([k, v]) => (
              <div key={k} className="row between">
                <dt className="muted">{k}</dt>
                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</dd>
              </div>
            ))}
        </dl>
        {pond.notes ? <div style={{ whiteSpace: 'pre-wrap' }}>{pond.notes}</div> : null}
      </div>
      <button type="button" className="btn danger block" style={{ marginTop: 16 }} onClick={() => setConfirm(true)}>
        Leave pond
      </button>
      <ConfirmSheet
        open={confirm}
        title={`Leave ${pond.name}?`}
        confirmLabel="Leave pond"
        busy={busy}
        onConfirm={() => void leave()}
        onCancel={() => setConfirm(false)}
      >
        It disappears from your phone. Catches you logged here stay with the pond. To come back you’ll need a new code
        from {owner}.
      </ConfirmSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Anyone: redeem a code
// ---------------------------------------------------------------------------------------------

export function JoinPondSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setCode('');
    setError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await joinPond(code);
      const sync = await syncNow();
      setBusy(false);
      setCode('');
      onClose();
      if (sync.status === 'ok') {
        toast.show({ message: `Joined ${res.pondName}` });
        navigate(`/ponds/${res.pondId}`);
      } else {
        toast.show({ message: `Joined ${res.pondName}. It’ll show up after the next sync.` });
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title="Join a pond" onClose={close}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="muted">Enter the code the pond’s owner sent you.</div>
        <div className="field">
          <input
            className="code-input"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            placeholder="ABCD-2345"
            aria-label="Invite code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </div>
        {error ? <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div> : null}
        <div className="confirm-actions">
          <button type="submit" className="btn primary block" disabled={busy || code.replace(/[\s-]/g, '').length < 8}>
            {busy ? 'Joining…' : 'Join'}
          </button>
          <button type="button" className="btn block" disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
