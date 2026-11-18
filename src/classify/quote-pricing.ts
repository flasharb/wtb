import { Chain } from './types.js';
import { getQuoteAssetInfo } from './constants.js';

export interface QuotePriceContext {
  solPriceUsd?: number;
  ethPriceUsd?: number;
}

const DEFAULT_PRICES: Required<QuotePriceContext> = {
  solPriceUsd: 200,
  ethPriceUsd: 3000,
};

export function computeQuoteUsdValue(
  chain: Chain,
  quoteAssetAddress: string,
  rawAmount: number | bigint,
  context: QuotePriceContext = {}
): { usdValue: number; quoteSymbol: string; formattedAmount: string } {
  const info = getQuoteAssetInfo(chain, quoteAssetAddress);
  const symbol = info?.symbol || (chain === 'solana' ? 'SOL' : 'ETH');
  const decimals = info?.decimals ?? (chain === 'solana' ? 9 : 18);
  const isStable = info?.isStable ?? false;

  const numericAmount = typeof rawAmount === 'bigint'
    ? Number(rawAmount) / Math.pow(10, decimals)
    : rawAmount / Math.pow(10, decimals);

  let unitPrice = 1;

  if (isStable) {
    unitPrice = 1;
  } else if (symbol === 'SOL') {
    unitPrice = context.solPriceUsd ?? DEFAULT_PRICES.solPriceUsd;
  } else if (symbol === 'ETH' || symbol === 'WETH') {
    unitPrice = context.ethPriceUsd ?? DEFAULT_PRICES.ethPriceUsd;
  }

  const usdValue = Math.round(numericAmount * unitPrice * 100) / 100;

  return {
    usdValue,
    quoteSymbol: symbol,
    formattedAmount: numericAmount.toFixed(4),
  };
}
