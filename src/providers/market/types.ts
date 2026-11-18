import { Chain } from '../../classify/types.js';

export interface TokenMarketData {
  chain: Chain;
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals?: number;
  priceUsd: number;
  liquidityUsd: number;
  fdvUsd: number;
  marketCapUsd?: number;
  volume24hUsd: number;
  pairCreatedAt?: Date;
  pairAddress?: string;
  dexId?: string;
  url?: string;
}

export interface MarketDataProvider {
  getTokenMarketData(chain: Chain, tokenAddress: string): Promise<TokenMarketData | null>;
}
