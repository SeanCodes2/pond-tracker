import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Log', icon: PlusIcon, end: true },
  { to: '/ponds', label: 'Ponds', icon: PondIcon, end: false },
  { to: '/catches', label: 'Catches', icon: ListIcon, end: false },
  { to: '/settings', label: 'Settings', icon: GearIcon, end: false },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <t.icon />
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function PondIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M3 13c3-5 15-5 18 0" />
      <path d="M3 13c3 5 15 5 18 0" />
      <path d="M4 18c2 1 4 1 6 0s4-1 6 0 3 1 4 0" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </svg>
  );
}
