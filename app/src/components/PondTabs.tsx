import { Link } from 'react-router';
import { usePondAccess } from '../hooks/useSharing';
import { shortName } from '../lib/sharing';

type Tab = 'dashboard' | 'catches' | 'feeder' | 'edit';

/** The Dashboard / Catches / Feeder / Edit tabs, plus a line saying who a shared pond belongs to. */
export function PondTabs({ pondId, active }: { pondId: string; active: Tab }) {
  const access = usePondAccess(pondId);
  const cls = (t: Tab) => (t === active ? 'active' : undefined);
  return (
    <>
      <div className="subtabs">
        <Link to={`/ponds/${pondId}`} className={cls('dashboard')}>
          Dashboard
        </Link>
        <Link to={`/ponds/${pondId}/catches`} className={cls('catches')}>
          Catches
        </Link>
        <Link to={`/ponds/${pondId}/feeder`} className={cls('feeder')}>
          Feeder
        </Link>
        <Link to={`/ponds/${pondId}/edit`} className={cls('edit')}>
          {access.role === 'member' ? 'Info' : 'Edit'}
        </Link>
      </div>
      <SharedLine pondId={pondId} />
    </>
  );
}

/** "Shared by sean" for a member, "Shared with buddy, joe" for the owner; nothing for a private pond. */
export function SharedLine({ pondId }: { pondId: string }) {
  const access = usePondAccess(pondId);
  if (!access.shared) return null;
  const text =
    access.role === 'member'
      ? `Shared with you by ${shortName(access.membership?.ownerName)}`
      : `Shared with ${access.members.map((m) => shortName(m.memberName)).join(', ')}`;
  return (
    <div className="shared-line">
      <PeopleIcon /> {text}
    </div>
  );
}

export function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 14.2c2.8.3 5 2.6 5 5.8" />
    </svg>
  );
}
