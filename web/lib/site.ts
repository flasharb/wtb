// Central site config. Public links are overridable via NEXT_PUBLIC_* env at build time.
export const site = {
  name: 'Stack Alpha',
  tagline: 'Solana launch calls + autopilot sniper',
  description:
    'Stack Alpha scans every new Solana token and only calls the rare ones that survive the rug window and pass strict safety checks — then auto-buys and auto-exits them for VIP members on full autopilot.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://stackalpha.xyz',
  botUrl: process.env.NEXT_PUBLIC_BOT_URL || 'https://t.me/stackalpha_bot',
  freeChannelUrl: process.env.NEXT_PUBLIC_FREE_CHANNEL_URL || 'https://t.me/stackalphaa',
  twitterHandle: '@stackalpha',
  subPriceStars: Number(process.env.NEXT_PUBLIC_SUB_PRICE_STARS || 1000),
  subDays: Number(process.env.NEXT_PUBLIC_SUB_DAYS || 30),
};

export const nav = [
  { href: '/calls', label: 'Track record' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];
