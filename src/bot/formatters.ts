import { EvaluatedSignal } from '../signals/types.js';
import { TokenMarketData } from '../providers/market/types.js';
import { SafetyCheckResult } from '../providers/security/types.js';
import { InlineKeyboard } from 'grammy';

export function formatShortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatUsd(val: number): string {
  if (val >= 1000000) {
    return `$${(val / 1000000).toFixed(2)}M`;
  }
  if (val >= 1000) {
    return `$${(val / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(val).toLocaleString()}`;
}

export function formatAlertMessage(
  signal: EvaluatedSignal,
  marketData: TokenMarketData | null,
  safety: SafetyCheckResult | null
): { text: string; replyMarkup: InlineKeyboard } {
  const chainName = signal.chain === 'solana' ? 'Solana' : 'Ethereum';
  const chainEmoji = signal.chain === 'solana' ? '🟣' : '🔷';
  const signalEmoji = signal.isUpdate ? '🔄' : '🚨';

  // 1. Header & Reason
  let text = `${signalEmoji} *WHALE BUY ALERT (${chainName.toUpperCase()})* ${chainEmoji}\n\n`;
  text = text + `*${signal.tokenName}* (\`${signal.tokenSymbol}\`)\n`;
  text = text + `Contract: \`${signal.tokenAddress}\`\n\n`;

  text = text + `🎯 *Signal Reason:* ${signal.signalReason}\n`;
  text = text + `💰 *Total Inflow:* ${formatUsd(signal.totalUsd)} across ${signal.whaleCount} whale(s)\n\n`;

  // 2. Buyers Breakdown
  text = text + `👥 *Whale Buyers:*\n`;
  signal.buyers.slice(0, 5).forEach((b, idx) => {
    const name = b.label || formatShortAddress(b.walletAddress);
    text = text + `   ${idx + 1}. *${name}* (${formatShortAddress(b.walletAddress)}) | ${formatUsd(
      b.usdValue
    )} | Score: ${Math.round(b.qualityScore)}/100\n`;
  });
  if (signal.buyers.length > 5) {
    text = text + `   _...and ${signal.buyers.length - 5} more whale(s)_\n`;
  }
  text = text + '\n';

  // 3. Token Market Facts
  if (marketData) {
    text = text + `📊 *Token Facts:*\n`;
    text = text + `   • Price: $${marketData.priceUsd > 0.01 ? marketData.priceUsd.toFixed(4) : marketData.priceUsd.toExponential(2)}\n`;
    text = text + `   • Liquidity: ${formatUsd(marketData.liquidityUsd)}\n`;
    text = text + `   • FDV: ${formatUsd(marketData.fdvUsd)}\n`;
    text = text + `   • 24h Volume: ${formatUsd(marketData.volume24hUsd)}\n`;
    if (marketData.pairCreatedAt) {
      const ageHours = Math.round((Date.now() - marketData.pairCreatedAt.getTime()) / 3600000);
      const ageDisplay = ageHours > 24 ? `${(ageHours / 24).toFixed(1)} days` : `${ageHours} hours`;
      text = text + `   • Pool Age: ${ageDisplay}\n`;
    }
    text = text + '\n';
  }

  // 4. Safety Checks
  if (safety) {
    text = text + `🛡️ *Safety Checks:*\n`;
    for (const item of safety.items) {
      const icon = item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : '❌';
      text = text + `   ${icon} ${item.name}: ${item.detail}\n`;
    }
    text = text + '\n';
  }

  // 5. Mandatory Disclaimer
  text = text + `_Not financial advice. Whale buys can be bait. Verify before acting._`;

  // 6. Inline Action Buttons
  const keyboard = new InlineKeyboard();

  // DexScreener URL
  const dexUrl =
    marketData?.url ||
    (signal.chain === 'solana'
      ? `https://dexscreener.com/solana/${signal.tokenAddress}`
      : `https://dexscreener.com/ethereum/${signal.tokenAddress}`);
  keyboard.url('📈 DexScreener', dexUrl);

  // Explorer URL
  const explorerUrl =
    signal.chain === 'solana'
      ? `https://solscan.io/token/${signal.tokenAddress}`
      : `https://etherscan.io/token/${signal.tokenAddress}`;
  keyboard.url('🔍 Explorer', explorerUrl);

  // Biggest Buyer's Wallet URL
  const biggestBuyer = signal.buyers[0];
  if (biggestBuyer) {
    const walletUrl =
      signal.chain === 'solana'
        ? `https://solscan.io/account/${biggestBuyer.walletAddress}`
        : `https://etherscan.io/address/${biggestBuyer.walletAddress}`;
    keyboard.row().url(`🐋 Top Buyer (${formatShortAddress(biggestBuyer.walletAddress)})`, walletUrl);
  }

  return { text, replyMarkup: keyboard };
}
