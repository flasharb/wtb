import { EvaluatedSignal } from '../signals/types.js';
import { TokenMarketData } from '../providers/market/types.js';
import { SafetyCheckResult } from '../providers/security/types.js';
import { InlineKeyboard } from 'grammy';

export function formatShortAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatUsd(val: number): string {
  if (!val || val < 0) val = 0;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}k`;
  return `$${Math.round(val).toLocaleString()}`;
}

export function formatPrice(p: number | string): string {
  const n = typeof p === 'string' ? parseFloat(p) : p;
  if (!n || n <= 0 || !isFinite(n)) return '—';
  // Show the EXACT value — no rounding/approximation. Prefer the original string (full stored
  // precision); otherwise the number's shortest exact form. Just expand scientific notation
  // to plain decimal and trim trailing zeros.
  let s = typeof p === 'string' ? p : String(p);
  if (/e/i.test(s)) s = expandExponential(s);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return `$${s}`;
}

/** Expand "1.64e-7" → "0.000000164" without losing or rounding any digits. */
function expandExponential(input: string): string {
  const neg = input.startsWith('-');
  const s = neg ? input.slice(1) : input;
  const [mant, expPart] = s.toLowerCase().split('e');
  const exp = parseInt(expPart, 10);
  const [intPart, fracPart = ''] = mant.split('.');
  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  let out: string;
  if (pointPos <= 0) out = '0.' + '0'.repeat(-pointPos) + digits;
  else if (pointPos >= digits.length) out = digits + '0'.repeat(pointPos - digits.length);
  else out = digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
  return (neg ? '-' : '') + out;
}

/** "$WIF" when we know the ticker, otherwise a short mint — never a confusing "TOKEN". */
export function tokenTicker(symbol?: string | null, address?: string): string {
  const s = (symbol || '').trim();
  if (s && s.toUpperCase() !== 'UNKNOWN' && s.toUpperCase() !== 'TOKEN') return `$${s}`;
  return address ? formatShortAddress(address) : 'Unknown token';
}

export function formatTimeAgo(d: Date | string | number): string {
  const t = typeof d === 'object' ? d.getTime() : new Date(d).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatAge(createdAt?: Date): string {
  if (!createdAt) return '—';
  const h = Math.max(0, (Date.now() - createdAt.getTime()) / 3600000);
  if (h < 24) return `${Math.round(h)}h`;
  const days = h / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${(months / 12).toFixed(1)}y`;
}

/**
 * The alert message: a one-glance verdict line, the essentials, then detail.
 * Solana-focused, mobile-friendly, Markdown.
 */
export function formatAlertMessage(
  signal: EvaluatedSignal,
  marketData: TokenMarketData | null,
  safety: SafetyCheckResult | null
): { text: string; replyMarkup: InlineKeyboard } {
  const name = marketData?.name || signal.tokenName;
  const ticker = tokenTicker(marketData?.symbol || signal.tokenSymbol, signal.tokenAddress);

  const verdict =
    signal.signalType === 'high_conviction'
      ? '🟡 *HIGH-CONVICTION BUY*'
      : '🟢 *CONSENSUS BUY*';
  const head = signal.isUpdate ? `🔄 *UPDATE* · ${verdict.replace('*', '').replace('*', '')}` : verdict;

  // Safety one-liner
  const warns = safety?.items.filter((i) => i.status === 'warn').length ?? 0;
  const fails = safety?.items.filter((i) => i.status === 'fail').length ?? 0;
  const safetyLine = !safety
    ? ''
    : fails > 0
      ? `❌ ${fails} safety issue(s)`
      : warns > 0
        ? `⚠️ Passed with ${warns} warning(s)`
        : '✅ All safety checks passed';

  let text = `${head}\n`;
  text += `*${name}* · ${ticker}\n\n`;
  text += `${signal.signalReason} · *${formatUsd(signal.totalUsd)}* total\n`;
  if (safetyLine) text += `${safetyLine}\n`;
  text += `\n\`${signal.tokenAddress}\`\n`;

  if (marketData) {
    const bits = [
      `💲 ${formatPrice(marketData.priceUsd)}`,
      `💧 ${formatUsd(marketData.liquidityUsd)} liq`,
      `📊 ${formatUsd(marketData.volume24hUsd)} 24h`,
      `⏳ ${formatAge(marketData.pairCreatedAt)}`,
    ];
    text += `${bits.join(' · ')}\n`;
  }

  // Buyers
  text += `\n*Buyers:*\n`;
  signal.buyers.slice(0, 5).forEach((b) => {
    const who = b.label || formatShortAddress(b.walletAddress);
    text += `• ${who} — ${formatUsd(b.usdValue)} _(score ${Math.round(b.qualityScore)})_\n`;
  });
  if (signal.buyers.length > 5) text += `• +${signal.buyers.length - 5} more\n`;

  // Only show individual checks that matter (warn/fail); passing ones are summarized above.
  const notable = safety?.items.filter((i) => i.status !== 'pass') ?? [];
  if (notable.length > 0) {
    text += `\n*Flags:*\n`;
    for (const item of notable) {
      text += `${item.status === 'fail' ? '❌' : '⚠️'} ${item.name}: ${item.detail}\n`;
    }
  }

  text += `\n_Not financial advice. Whale buys can be bait. Verify before acting._`;

  // Buttons
  const dexUrl = marketData?.url || `https://dexscreener.com/solana/${signal.tokenAddress}`;
  const explorerUrl = `https://solscan.io/token/${signal.tokenAddress}`;
  const keyboard = new InlineKeyboard().url('📈 Chart', dexUrl).url('🔍 Solscan', explorerUrl);
  const top = signal.buyers[0];
  if (top) {
    keyboard.row().url(`🐋 Top buyer`, `https://solscan.io/account/${top.walletAddress}`);
  }

  return { text, replyMarkup: keyboard };
}
