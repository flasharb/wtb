import type { Metadata } from 'next';
import Link from 'next/link';
import { site } from '@/lib/site';
import { getTrackRecord, getRecentCalls, getTopCalls } from '@/lib/stats';
import { CallCard } from '@/components/CallCard';
import { mult, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Track record — every Solana call & result',
  description:
    'The live Stack Alpha track record: every safety-vetted Solana launch call, its peak multiple, win rate, and the rugs we filtered out. Transparent, updated in real time.',
  alternates: { canonical: '/calls' },
};

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="card text-center">
      <div className={`font-display text-2xl font-bold sm:text-3xl ${accent ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-xs text-brand-100/60">{label}</div>
    </div>
  );
}

export default async function CallsPage() {
  const [r, recent, top] = await Promise.all([getTrackRecord(), getRecentCalls(30), getTopCalls(6)]);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Stack Alpha Solana calls',
    numberOfItems: recent.length,
    itemListElement: recent.slice(0, 20).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.symbol ? `$${c.symbol}` : c.tokenAddress,
    })),
  };

  return (
    <div className="container-x py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />

      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Transparent track record</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-white sm:text-5xl">Every call. Every result.</h1>
        <p className="mt-4 text-brand-100/70">
          We track every call from its call price. “Peak” is the best multiple it reached — glitches are capped and rugs are
          marked, so the numbers are honest.
        </p>
      </div>

      {r.total > 0 ? (
        <>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric value={r.total.toLocaleString()} label="Calls tracked" />
            <Metric value={`${pct(r.x2, r.total)}%`} label="Hit 2x+" accent />
            <Metric value={r.x3.toLocaleString()} label="Hit 3x+" />
            <Metric value={r.x5.toLocaleString()} label="Hit 5x+" />
            <Metric value={mult(r.avgPeak)} label="Avg peak" />
            <Metric value={mult(r.best)} label="Best call" />
          </div>
          <p className="mt-3 text-center text-xs text-brand-100/40">
            {r.rugged} marked rugged · {r.faded} faded · all tracked openly. Past performance never guarantees future results.
          </p>

          {top.length > 0 && (
            <section className="mt-14">
              <h2 className="mb-4 font-display text-xl font-bold text-white">Best performers</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {top.map((c) => (
                  <CallCard key={c.tokenAddress} c={c} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-14">
            <h2 className="mb-4 font-display text-xl font-bold text-white">Most recent calls</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {recent.map((c) => (
                <CallCard key={c.tokenAddress} c={c} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="card mx-auto mt-10 max-w-lg text-center">
          <p className="text-brand-100/70">The tracker is warming up — calls will appear here as soon as the next clean launch passes.</p>
          <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-gold mt-5">Join the free channel</a>
        </div>
      )}

      <div className="mt-16 text-center">
        <h2 className="font-display text-2xl font-bold text-white">Want these auto-traded?</h2>
        <p className="mt-2 text-brand-100/70">VIP autopilot buys every call and exits on your rules.</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={site.botUrl} target="_blank" rel="noopener" className="btn-primary w-full sm:w-auto">Open the bot</a>
          <Link href="/pricing" className="btn-ghost w-full sm:w-auto">See pricing</Link>
        </div>
      </div>
    </div>
  );
}
