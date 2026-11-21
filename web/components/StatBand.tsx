import type { TrackRecord } from '@/lib/stats';
import { mult, pct } from '@/lib/format';

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-2xl font-bold text-white sm:text-3xl">{value}</div>
      <div className="mt-1 text-xs text-brand-100/60">{label}</div>
    </div>
  );
}

export function StatBand({ r }: { r: TrackRecord }) {
  // Only render meaningful numbers once there's data; fall back to inviting copy otherwise.
  const hasData = r.total > 0;
  return (
    <div className="card grid grid-cols-2 gap-6 sm:grid-cols-4">
      <Stat value={hasData ? r.total.toLocaleString() : '—'} label="Calls tracked" />
      <Stat value={hasData ? `${pct(r.x2, r.total)}%` : '—'} label="Hit 2x or more" />
      <Stat value={hasData ? mult(r.avgPeak) : '—'} label="Avg peak" />
      <Stat value={hasData ? mult(r.best) : '—'} label="Best call" />
    </div>
  );
}
