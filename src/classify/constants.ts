import { Chain } from './types.js';

export const SOLANA_QUOTE_ASSETS: Record<string, { symbol: string; decimals: number; isStable: boolean }> = {
  // Wrapped SOL & Native
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, isStable: false },
  'SOL': { symbol: 'SOL', decimals: 9, isStable: false },
  // Stablecoins
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, isStable: true },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6, isStable: true },
  'USDSwr9ApdHk5bvJKMjzff41tpJFCaozA6hCQ6yvTMq': { symbol: 'USDS', decimals: 6, isStable: true },
  'USDH1SM1ojcxkgZsq8mdsohmxfYsCkspKjBpMnC6nYq': { symbol: 'USDH', decimals: 6, isStable: true },
  '2b1kV6ydDS3TCgTg51wGVQQE6WhZmZiGy3mdv7mZdK5w': { symbol: 'PYUSD', decimals: 6, isStable: true },
};

export const ETHEREUM_QUOTE_ASSETS: Record<string, { symbol: string; decimals: number; isStable: boolean }> = {
  // Native ETH & Wrapped ETH
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18, isStable: false },
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': { symbol: 'ETH', decimals: 18, isStable: false },
  'ETH': { symbol: 'ETH', decimals: 18, isStable: false },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18, isStable: false },
  // Stablecoins
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6, isStable: true },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6, isStable: true },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18, isStable: true },
  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3': { symbol: 'USDe', decimals: 18, isStable: true },
  '0x6c3ea9036406852006290770bedfcaba0e23a0e8': { symbol: 'PYUSD', decimals: 6, isStable: true },
};

export const ERC20_TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export function isQuoteAsset(chain: Chain, address: string): boolean {
  if (chain === 'solana') {
    return !!SOLANA_QUOTE_ASSETS[address];
  }
  return !!ETHEREUM_QUOTE_ASSETS[address.toLowerCase()];
}

export function getQuoteAssetInfo(chain: Chain, address: string) {
  if (chain === 'solana') {
    return SOLANA_QUOTE_ASSETS[address] || null;
  }
  return ETHEREUM_QUOTE_ASSETS[address.toLowerCase()] || null;
}
