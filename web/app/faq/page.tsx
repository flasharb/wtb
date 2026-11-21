import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'FAQ — how Stack Alpha works',
  description: 'How Stack Alpha scans and vets Solana launches, how the autopilot sniper buys and sells, how custody and billing work, and the risks involved.',
  alternates: { canonical: '/faq' },
};

const faqs = [
  {
    q: 'What does Stack Alpha actually do?',
    a: 'It scans every new Solana token across the major launchpads and DEXes, filters out rugs and unsafe contracts, and calls only the ones that pass strict safety checks. VIP members can let the bot auto-buy each call and auto-exit on their own take-profit, stop-loss and trailing-stop rules.',
  },
  {
    q: 'How are tokens vetted before a call?',
    a: 'Mint and freeze authority must be revoked, the token must be transferable (no honeypot), hold a healthy holder spread and real liquidity, and not sit on a rug-prone DEX where the dev can pull liquidity. Only tokens that clear every check are called.',
  },
  {
    q: 'How does the autopilot sniper work?',
    a: 'You get your own Solana wallet inside the bot, fund it with SOL, and set your parameters: buy size, take-profit, stop-loss, trailing stop, moon-bag, slippage and daily caps. When a call fires, the bot buys it and then manages the exit automatically — selling part at take-profit and trailing the rest, cutting losers at your stop, and emergency-exiting on a rug.',
  },
  {
    q: 'Who controls the funds?',
    a: 'Full autopilot requires the bot to sign trades, so each wallet’s key is held server-side, encrypted at rest. You can deposit and withdraw at any time. Only deposit what you’re comfortable having actively traded — treat it like any hot wallet.',
  },
  {
    q: 'How do payments work?',
    a: `VIP is billed in Telegram Stars from ${site.subPriceStars.toLocaleString()} ⭐ for ${site.subDays} days, paid right inside the bot. When you pay, you’re automatically added to the private channel; when it lapses, access and autopilot switch off. No cards, no wallet connect.`,
  },
  {
    q: 'Is this guaranteed to make money?',
    a: 'No. Memecoin trading is extremely high-risk and most tokens fail — even vetted ones can fade or rug. The edge is disciplined entries and automated exits, not a guarantee. Never invest more than you can afford to lose. Nothing here is financial advice.',
  },
];

export default function FaqPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div className="container-x py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <span className="eyebrow">FAQ</span>
          <h1 className="mt-2 font-display text-4xl font-bold text-white sm:text-5xl">Questions, answered</h1>
        </div>
        <div className="mt-10 space-y-3">
          {faqs.map((f, i) => (
            <details key={i} className="card group" {...(i === 0 ? { open: true } : {})}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-white [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="shrink-0 text-brand-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-brand-100/70">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-12 text-center">
          <a href={site.botUrl} target="_blank" rel="noopener" className="btn-primary">Open the bot</a>
        </div>
      </div>
    </div>
  );
}
