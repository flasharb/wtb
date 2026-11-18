/**
 * GeckoTerminal launch discovery (free, ~30 req/min).
 *
 * GeckoTerminal indexes every Solana DEX pool — so a single source covers tokens from
 * ALL launchpads (Pump.fun, BONK.fun, Raydium LaunchLab, Meteora, Bags, …) the moment they
 * have a tradable pool. We pull `new_pools` (fresh, to start tracking) and `trending_pools`
 * (currently active, to catch 7–30-day survivors right now). Age is computed per-pool from
 * `pool_created_at`, so the scanner filters by age regardless of which feed surfaced a token.
 */

export interface LaunchPool {
  mint: string;
  poolAddress: string;
  dex: string;
  name: string;
  symbol: string;
  poolCreatedAt: Date | null;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number;
  priceUsd: number;
}

const BASE = 'https://api.geckoterminal.com/api/v2/networks/solana';

export class GeckoTerminalSource {
  private async getJson(url: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 429 || r.status >= 500) {
          await this.sleep(1500 * (i + 1));
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (i === retries - 1) throw e;
        await this.sleep(700 * (i + 1));
      }
    }
  }

  private parse(payload: any): LaunchPool[] {
    const included = new Map<string, { symbol: string; name: string }>();
    for (const inc of payload?.included || []) {
      if (inc.type === 'token') {
        included.set(inc.id, {
          symbol: inc.attributes?.symbol || '',
          name: inc.attributes?.name || '',
        });
      }
    }
    const out: LaunchPool[] = [];
    for (const p of payload?.data || []) {
      const a = p.attributes || {};
      const baseId: string = p.relationships?.base_token?.data?.id || '';
      const mint = baseId.replace(/^solana_/, '');
      if (!mint) continue;
      const tok = included.get(baseId);
      out.push({
        mint,
        poolAddress: a.address || '',
        dex: p.relationships?.dex?.data?.id || '',
        name: tok?.name || (a.name ? String(a.name).split(' / ')[0] : ''),
        symbol: tok?.symbol || (a.name ? String(a.name).split(' / ')[0] : ''),
        poolCreatedAt: a.pool_created_at ? new Date(a.pool_created_at) : null,
        liquidityUsd: parseFloat(a.reserve_in_usd || '0') || 0,
        volume24hUsd: parseFloat(a.volume_usd?.h24 || '0') || 0,
        fdvUsd: parseFloat(a.fdv_usd || '0') || 0,
        priceUsd: parseFloat(a.base_token_price_usd || '0') || 0,
      });
    }
    return out;
  }

  /** Discover candidate pools: trending (active, any age) + newest (for tracking to maturity). */
  async discover(): Promise<LaunchPool[]> {
    const byMint = new Map<string, LaunchPool>();
    const feeds = [
      `${BASE}/trending_pools?include=base_token,dex&page=1`,
      `${BASE}/trending_pools?include=base_token,dex&page=2`,
      `${BASE}/pools?include=base_token,dex&sort=h24_volume_usd_desc&page=1`,
      `${BASE}/new_pools?include=base_token,dex&page=1`,
    ];
    for (const url of feeds) {
      try {
        const pools = this.parse(await this.getJson(url));
        for (const p of pools) {
          // keep the richest record per mint (highest liquidity)
          const prev = byMint.get(p.mint);
          if (!prev || p.liquidityUsd > prev.liquidityUsd) byMint.set(p.mint, p);
        }
      } catch {
        /* skip feed */
      }
      await this.sleep(400); // stay well under rate limit
    }
    return Array.from(byMint.values());
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
