import { Chain } from '../../classify/types.js';
import { MarketDataProvider, TokenMarketData } from './types.js';

interface CacheEntry {
  data: TokenMarketData | null;
  expiresAt: number;
}

export class DexScreenerMarketProvider implements MarketDataProvider {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs = 60000; // 1 minute cache

  async getTokenMarketData(chain: Chain, tokenAddress: string): Promise<TokenMarketData | null> {
    const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`DexScreener API HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      const pairs: any[] = json?.pairs || [];

      if (!pairs || pairs.length === 0) {
        this.cache.set(cacheKey, { data: null, expiresAt: Date.now() + this.cacheTtlMs });
        return null;
      }

      // Filter to matching chain if possible
      const chainPrefix = chain === 'solana' ? 'solana' : 'ethereum';
      const chainPairs = pairs.filter((p) => p.chainId === chainPrefix);
      const targetPairs = chainPairs.length > 0 ? chainPairs : pairs;

      // Sort by liquidity USD descending
      targetPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const bestPair = targetPairs[0];

      const marketData: TokenMarketData = {
        chain,
        tokenAddress: bestPair.baseToken?.address || tokenAddress,
        name: bestPair.baseToken?.name || 'Unknown Token',
        symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
        priceUsd: parseFloat(bestPair.priceUsd || '0'),
        liquidityUsd: parseFloat(bestPair.liquidity?.usd || '0'),
        fdvUsd: parseFloat(bestPair.fdv || '0'),
        marketCapUsd: bestPair.marketCap ? parseFloat(bestPair.marketCap) : undefined,
        volume24hUsd: parseFloat(bestPair.volume?.h24 || '0'),
        pairCreatedAt: bestPair.pairCreatedAt ? new Date(bestPair.pairCreatedAt) : undefined,
        pairAddress: bestPair.pairAddress,
        dexId: bestPair.dexId,
        url: bestPair.url,
      };

      this.cache.set(cacheKey, { data: marketData, expiresAt: Date.now() + this.cacheTtlMs });
      return marketData;
    } catch (err: any) {
      console.warn(`[DexScreener] Failed to fetch data for ${tokenAddress}:`, err.message);
      return null;
    }
  }

  // Allow setting mock data for testing
  setMockData(chain: Chain, tokenAddress: string, data: TokenMarketData | null) {
    this.cache.set(`${chain}:${tokenAddress.toLowerCase()}`, {
      data,
      expiresAt: Date.now() + 86400000,
    });
  }
}
