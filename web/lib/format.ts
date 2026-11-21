export function shortAddr(a?: string | null): string {
  if (!a) return '';
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function ticker(symbol?: string | null, address?: string): string {
  const s = (symbol || '').trim();
  if (s && s.toUpperCase() !== 'UNKNOWN' && s.toUpperCase() !== 'TOKEN') return `$${s}`;
  return address ? shortAddr(address) : 'Unknown';
}

export function usd(n?: number | null): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export function mult(n?: number | null): string {
  const v = Number(n || 1);
  return `${v.toFixed(v >= 10 ? 0 : v >= 2 ? 1 : 2)}x`;
}

export function timeAgo(d?: string | Date | null): string {
  if (!d) return '';
  const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime();
  const s = Math.max(0, Date.now() - t) / 1000;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
