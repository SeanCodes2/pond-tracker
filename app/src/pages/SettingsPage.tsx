import { useEffect, useState } from 'react';
import type { Settings, WeightUnits } from '@pond-tracker/shared';
import { useToast } from '../components/Toast';
import { repo } from '../db/repo';
import { usePonds } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';
import { catchesToCsv, downloadBlob } from '../lib/csv';
import { formatBytes } from '../lib/format';

export function SettingsPage() {
  const settings = useSettings();
  const ponds = usePonds();
  const toast = useToast();
  const [exportPond, setExportPond] = useState<string>('all');
  const [usage, setUsage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.storage) return;
      const est = navigator.storage.estimate ? await navigator.storage.estimate() : {};
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      setUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
  }, []);

  const patch = (p: Partial<Omit<Settings, 'id'>>) => void repo.saveSettings(p);
  const numField = (k: 'lengthStepIn' | 'weightStepLb', v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) patch({ [k]: n });
  };

  const exportCsv = async () => {
    const pondId = exportPond === 'all' ? undefined : exportPond;
    const rows = await repo.listCatches(pondId);
    const csv = catchesToCsv(rows, ponds ?? []);
    const name = exportPond === 'all' ? 'all-ponds' : (ponds?.find((p) => p.id === exportPond)?.name ?? 'pond');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `pond-tracker-${slug(name)}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.show({ message: `Exported ${rows.length} catches` });
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="form">
        <div className="field">
          <label htmlFor="units">Weight units</label>
          <select id="units" value={settings.weightUnits} onChange={(e) => patch({ weightUnits: e.target.value as WeightUnits })}>
            <option value="decimal">Decimal pounds (2.35 lb)</option>
            <option value="lbsOz">Pounds and ounces (2 lb 6 oz)</option>
          </select>
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="lstep">Length step (in)</label>
            <select id="lstep" value={settings.lengthStepIn} onChange={(e) => numField('lengthStepIn', e.target.value)}>
              <option value={0.125}>1/8</option>
              <option value={0.25}>1/4</option>
              <option value={0.5}>1/2</option>
              <option value={1}>1</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="wstep">Weight step (lb)</label>
            <select id="wstep" value={settings.weightStepLb} onChange={(e) => numField('weightStepLb', e.target.value)}>
              <option value={0.01}>0.01</option>
              <option value={0.05}>0.05</option>
              <option value={0.1}>0.10</option>
              <option value={0.25}>0.25</option>
            </select>
          </div>
        </div>

        <Toggle label="Require weight" hint="Save is disabled until a weight is entered" checked={settings.requireWeight} onChange={(v) => patch({ requireWeight: v })} />
        <Toggle label="Require photo" hint="Save is disabled until a photo is attached" checked={settings.requirePhoto} onChange={(v) => patch({ requirePhoto: v })} />
        <Toggle label="Wi-Fi only photo sync" hint="Applies once cloud sync exists" checked={settings.wifiOnlyPhotoSync} onChange={(v) => patch({ wifiOnlyPhotoSync: v })} />

        <h2>Defaults for new ponds</h2>
        <div className="field-grid three">
          <NumField label="Wr low" value={settings.defaultThresholds.low} onChange={(v) => patch({ defaultThresholds: { ...settings.defaultThresholds, low: v } })} />
          <NumField label="Wr ok" value={settings.defaultThresholds.ok} onChange={(v) => patch({ defaultThresholds: { ...settings.defaultThresholds, ok: v } })} />
          <NumField label="Wr high" value={settings.defaultThresholds.high} onChange={(v) => patch({ defaultThresholds: { ...settings.defaultThresholds, high: v } })} />
        </div>
        <div className="field-grid">
          <NumField label="Slot min (in)" value={settings.defaultSlot.minIn} onChange={(v) => patch({ defaultSlot: { ...settings.defaultSlot, minIn: v } })} />
          <NumField label="Slot max (in)" value={settings.defaultSlot.maxIn} onChange={(v) => patch({ defaultSlot: { ...settings.defaultSlot, maxIn: v } })} />
        </div>

        <h2>Export</h2>
        <div className="field">
          <label htmlFor="exp">Pond</label>
          <select id="exp" value={exportPond} onChange={(e) => setExportPond(e.target.value)}>
            <option value="all">All ponds</option>
            {ponds?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn primary block" onClick={() => void exportCsv()}>
          Export CSV
        </button>

        <h2>Storage</h2>
        <div className="muted">
          {usage
            ? `${formatBytes(usage.usage)} used of ${formatBytes(usage.quota)} · ${usage.persisted ? 'persistent' : 'best-effort (install the app to make it persistent)'}`
            : 'Storage estimate unavailable'}
        </div>
        <div className="muted" style={{ fontSize: 14 }}>
          All data lives in this browser's IndexedDB on this phone. Export CSV regularly until cloud sync exists.
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const id = `nf-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n) && n > 0 && n !== value) onChange(n);
          else setText(String(value));
        }}
      />
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pond';
}
