import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Pricing — free calls & VIP autopilot',
  description: `Stack Alpha pricing: a free Solana calls channel, or VIP from ${site.subPriceStars} Stars / ${site.subDays} days for full real-time calls, pump/fade follow-ups and the autopilot sniper.`,
  alternates: { canonical: '/pricing' },
};

const tiers = [
  {
    name: 'Free',
    price: '0',
    unit: '',
    highlight: false,
    cta: 'Join free channel',
    href: site.freeChannelUrl,
    features: [
      'Public calls channel',
      'Teaser alerts on vetted launches',
      'See the live track record',
      'No contract details / follow-ups',
    ],
  },
  {
    name: 'VIP',
    price: site.subPriceStars.toLocaleString(),
    unit: `⭐ / ${site.subDays} days`,
    highlight: true,
    cta: 'Go VIP',
    href: `${site.botUrl}?start=subscribe`,
    features: [
      'Full real-time calls with contract + chart',
      'Pump, fade & rug follow-ups on every call',
      '🤖 Autopilot sniper — auto-buy & auto-exit',
      'Your own encrypted in-bot Solana wallet',
      'Take-profit, stop-loss, trailing & moon-bag',
      'Deposit / withdraw anytime',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="container-x py-12">
      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Pricing</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-white sm:text-5xl">Start free. Go VIP when you’re ready.</h1>
        <p className="mt-4 text-brand-100/70">Pay with Telegram Stars, right inside the bot. No card, no wallet connect — cancel by simply not renewing.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-3xl gap-5 sm:grid-cols-2">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`card relative flex flex-col ${t.highlight ? 'border-brand-500/60 shadow-glow' : ''}`}
          >
            {t.highlight && (
              <span className="absolute -top-3 right-5 rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink-950">Most popular</span>
            )}
            <h2 className="font-display text-lg font-bold text-white">{t.name}</h2>
            <div className="mt-3 flex items-end gap-1">
              <span className="font-display text-4xl font-bold text-white">{t.price}</span>
              <span className="pb-1 text-sm text-brand-100/60">{t.unit}</span>
            </div>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-brand-100/80">
                  <span className="mt-0.5 text-emerald-400">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={t.href}
              target="_blank"
              rel="noopener"
              className={`mt-7 w-full ${t.highlight ? 'btn-primary' : 'btn-ghost'}`}
            >
              {t.cta}
            </a>
          </div>
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-xl text-center text-xs text-brand-100/40">
        Autopilot trades real funds on Solana. Crypto is volatile and most memecoins fail — never deposit more than you can
        afford to lose. Not financial advice.
      </p>
    </div>
  );
}
