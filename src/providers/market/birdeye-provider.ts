import { config } from '../../config/index.js';

export interface BirdeyeOverview {
  holder: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
}

/**
 * Birdeye token overview — gives LIVE holder count (works for brand-new tokens, unlike
 * GoPlus which lags). Free key supports /defi/token_overview (rate-limited, so cache + backoff).
 */
export class BirdeyeProvider {
  private cache = new Map<string, { data: BirdeyeOverview | null; expires: number }>();
  private ttlMs = 60_000;

  get enabled(): boolean {
    return !!config.BIRD_EYE_KEY;
  }

  async getOverview(mint: string): Promise<BirdeyeOverview | null> {
    if (!this.enabled) return null;
    const hit = this.cache.get(mint);
    if (hit && hit.expires > Date.now()) return hit.data;

    let data: BirdeyeOverview | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, {
          headers: { 'X-API-KEY': config.BIRD_EYE_KEY, 'x-chain': 'solana', accept: 'application/json' },
        });
        if (r.status === 429) {
          await this.sleep(1200 * (attempt + 1));
          continue;
        }
        if (r.ok) {
          const j = (await r.json()) as any;
          const d = j?.data;
          if (d) {
            data = {
              holder: Number(d.holder) || 0,
              liquidityUsd: Number(d.liquidity) || 0,
              volume24hUsd: Number(d.v24hUSD) || 0,
              priceUsd: Number(d.price) || 0,
            };
          }
          break;
        }
      } catch {
        await this.sleep(500 * (attempt + 1));
      }
    }
    this.cache.set(mint, { data, expires: Date.now() + this.ttlMs });
    return data;
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
