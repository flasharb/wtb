import Link from 'next/link';
import { site } from '@/lib/site';
import { getTrackRecord, getTopCalls } from '@/lib/stats';
import { StatBand } from '@/components/StatBand';
import { CallCard } from '@/components/CallCard';

export const dynamic = 'force-dynamic'; // always SSR fresh numbers (cached 60s in lib/stats)

const steps = [
  { n: '01', t: 'Scan every launch', d: 'We watch new Solana tokens across Pump.fun, Raydium, Meteora and more — thousands a day.' },
  { n: '02', t: 'Vet ruthlessly', d: 'Mint & freeze revoked, no honeypot, healthy holder spread, real liquidity, rug-prone DEXes filtered out.' },
  { n: '03', t: 'Call the survivors', d: 'Only the rare tokens that clear every check get called — in real time, with the contract and the chart.' },
  { n: '04', t: 'Autopilot trades it', d: 'VIP members auto-buy each call and auto-exit on their own take-profit, stop-loss and trailing stop.' },
];

export default async function HomePage() {
  const [record, top] = await Promise.all([getTrackRecord(), getTopCalls(4)]);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="container-x pb-14 pt-16 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="chip mx-auto">🟣 Solana · live now</span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
              The Solana launches that <span className="text-brand-400">actually survive</span> — called & auto-traded for you.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-brand-100/70 sm:text-lg">
              Stack Alpha scans every new token, filters out the rugs, and calls only the ones that pass strict safety.
              VIP members let the bot <strong className="text-white">buy and sell on full autopilot</strong> — your rules, 24/7.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={site.botUrl} target="_blank" rel="noopener" className="btn-primary w-full sm:w-auto">
                Start on Telegram
              </a>
              <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-gold w-full sm:w-auto">
                Get free calls
              </a>
            </div>
            <p className="mt-3 text-xs text-brand-100/40">Free calls channel · VIP from {site.subPriceStars.toLocaleString()} ⭐ / {site.subDays} days</p>
          </div>

          <div className="mx-auto mt-12 max-w-3xl">
            <StatBand r={record} />
            <p className="mt-2 text-center text-xs text-brand-100/40">
              Live from the tracker. “Peak” = best multiple each call reached from the call price.{' '}
              <Link href="/calls" className="text-brand-300 underline-offset-4 hover:underline">See the full track record →</Link>
            </p>
          </div>
        </div>
      </section>

      {/* Top calls */}
      {top.length > 0 && (
        <section className="container-x py-6">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-xl font-bold text-white">Recent big calls</h2>
            <Link href="/calls" className="text-sm text-brand-300 hover:text-white">All calls →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {top.map((c) => (
              <CallCard key={c.tokenAddress} c={c} />
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="container-x py-16">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">How it works</span>
          <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">Safety first, then speed</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="card">
              <div className="font-display text-sm font-bold text-brand-400">{s.n}</div>
              <h3 className="mt-2 font-semibold text-white">{s.t}</h3>
              <p className="mt-1.5 text-sm text-brand-100/60">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Autopilot */}
      <section className="container-x py-10">
        <div className="card overflow-hidden bg-gradient-to-br from-ink-800/80 to-ink-850/40 p-8 sm:p-12">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <span className="eyebrow">VIP autopilot sniper</span>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">Set your rules. It trades while you sleep.</h2>
              <p className="mt-4 text-brand-100/70">
                Fund your in-bot Solana wallet, pick your size and exits, and flip it on. Every call that passes gets bought
                automatically and sold on your terms — no screens, no FOMO.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  'Take-profit with a moon-bag — bank profit, let a runner ride',
                  'Trailing stop captures the 10x without giving it all back',
                  'Hard stop-loss + rug protection on every position',
                  'Per-trade size, slippage, daily caps — all your call',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-brand-100/80">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <a href={site.botUrl} target="_blank" rel="noopener" className="btn-primary">Enable autopilot</a>
              </div>
            </div>
            <div className="rounded-2xl border border-ink-border bg-ink-950/60 p-5 font-mono text-sm shadow-glow">
              <div className="text-brand-100/50">/autotrade</div>
              <div className="mt-3 space-y-2 text-brand-100/80">
                <div className="flex justify-between"><span>Status</span><span className="text-emerald-400">🟢 ON</span></div>
                <div className="flex justify-between"><span>Buy size</span><span>0.25 SOL</span></div>
                <div className="flex justify-between"><span>Take-profit</span><span>+150% · sell 50%</span></div>
                <div className="flex justify-between"><span>Stop-loss</span><span>-35%</span></div>
                <div className="flex justify-between"><span>Trailing</span><span>25% off peak</span></div>
              </div>
              <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                🎯 $WIF hit 3.1x — sold 50% for +0.38 SOL · trailing the rest
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="container-x py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">Start free. Upgrade when it pays for itself.</h2>
          <p className="mt-3 text-brand-100/70">Join the free calls channel today, or go VIP for full real-time calls, follow-ups and autopilot.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-gold w-full sm:w-auto">Join free calls</a>
            <Link href="/pricing" className="btn-ghost w-full sm:w-auto">See pricing</Link>
          </div>
        </div>
      </section>
    </>
  );
}
