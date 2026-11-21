import type { Call } from '@/lib/stats';
import { ticker, usd, mult, timeAgo } from '@/lib/format';

export function CallCard({ c }: { c: Call }) {
  const up = c.peakMultiple >= 2;
  const rugged = c.status === 'closed';
  return (
    <a
      href={`https://dexscreener.com/solana/${c.tokenAddress}`}
      target="_blank"
      rel="noopener nofollow"
      className="card flex items-center justify-between gap-3 transition hover:border-brand-500/60 hover:bg-ink-800/70"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-white">{ticker(c.symbol, c.tokenAddress)}</span>
          {rugged && <span className="chip border-red-500/30 text-red-300">rugged</span>}
          {!rugged && c.reportedFade && <span className="chip border-amber-500/30 text-amber-300">faded</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-brand-100/60">
          <span>💧 {usd(c.liquidityUsd)}</span>
          {c.holderCount > 0 && <span>👥 {c.holderCount.toLocaleString()}</span>}
          <span>{timeAgo(c.alertedAt)}</span>
        </div>
      </div>
      <div className="text-right">
        <div className={`font-display text-xl font-bold ${up ? 'text-emerald-400' : 'text-brand-200'}`}>{mult(c.peakMultiple)}</div>
        <div className="text-[10px] uppercase tracking-wider text-brand-100/40">peak</div>
      </div>
    </a>
  );
}
