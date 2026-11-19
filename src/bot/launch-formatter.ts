import { InlineKeyboard } from 'grammy';
import { TokenSafety } from '../providers/security/solana-safety.js';
import { formatUsd, formatPrice, tokenTicker, formatAge } from './formatters.js';

export interface LaunchView {
  tokenAddress: string;
  symbol?: string | null;
  name?: string | null;
  dex?: string | null;
  poolCreatedAt?: Date | null;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number;
  priceUsd: number | string;
}

const DEX_LABEL: Record<string, string> = {
  raydium: 'Raydium',
  pumpswap: 'PumpSwap',
  'pump-fun': 'Pump.fun',
  meteora: 'Meteora',
  orca: 'Orca',
  bags: 'Bags',
};

export function formatLaunchAlert(
  c: LaunchView,
  safety: TokenSafety
): { text: string; replyMarkup: InlineKeyboard } {
  const ticker = tokenTicker(c.symbol, c.tokenAddress);
  const name = c.name && c.name !== c.symbol ? c.name : '';
  const dex = c.dex ? DEX_LABEL[c.dex] || c.dex : 'Solana DEX';
  const age = formatAge(c.poolCreatedAt || undefined);

  let text = `🚀 *ALPHA CALL!!! — PASSED ALL CHECKS*\n`;
  text += name ? `*${name}* · ${ticker}\n` : `*${ticker}*\n`;
  text += `🗓 Launched *${age}* ago · ${dex}\n\n`;

  const holders = safety.holderCount > 0 ? ` · 👥 ${safety.holderCount.toLocaleString()} holders` : '';
  text += `💧 Liquidity *${formatUsd(c.liquidityUsd)}* · 📊 24h *${formatUsd(c.volume24hUsd)}*\n`;
  text += `💲 ${formatPrice(c.priceUsd)} · FDV ${formatUsd(c.fdvUsd)}${holders}\n\n`;

  text += `🛡️ *Safety*\n`;
  for (const chk of safety.checks) {
    const icon = chk.status === 'pass' ? '✅' : chk.status === 'warn' ? '⚠️' : '❌';
    text += `${icon} ${chk.name}: ${chk.detail}\n`;
  }

  text += `\n\`${c.tokenAddress}\`\n`;
  text += `\n_Not financial advice. Whale buys can be bait. Verify before acting._`;

  const kb = new InlineKeyboard()
    .url('📈 Chart', `https://dexscreener.com/solana/${c.tokenAddress}`)
    .url('🔍 Solscan', `https://solscan.io/token/${c.tokenAddress}`)
    .row()
    .url('🐦 Search X', `https://x.com/search?q=${encodeURIComponent(c.tokenAddress)}`);

  return { text, replyMarkup: kb };
}
