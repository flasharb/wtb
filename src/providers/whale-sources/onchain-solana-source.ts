import { config } from '../../config/index.js';
import { CandidateWallet, Chain, WhaleSource } from './types.js';

/**
 * OnchainSolanaSource — discovers REAL active Solana traders with zero hard-coded
 * or hallucinated addresses, using two free data sources:
 *
 *   1. DexScreener (free, no key): real trending / liquid Solana tokens + their pool addresses.
 *   2. Helius RPC (standard methods, ~1 credit each): recent swappers of those pools, then
 *      per-wallet verification (owner, SOL + stablecoin balance, activity rate, token diversity).
 *
 * Returns CandidateWallet[] with real metrics; the shared filter-engine then applies the
 * balance / activity / bot thresholds and ranks them. Program accounts (not owned by the
 * System Program) are dropped during discovery so they never reach the filter.
 *
 * Cost: ~1 credit per discovery signature/tx + ~4 credits per verified candidate. A full
 * run is a few thousand credits against the 1M monthly budget (one-off / weekly).
 */

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

export interface OnchainSolanaOptions {
  maxTokens?: number; // how many trending tokens to pull swappers from
  sigsPerPool?: number; // recent signatures sampled per pool
  holdersPerToken?: number; // top token holders sampled per token
  maxCandidates?: number; // hard cap on wallets to verify (cost guard)
  minPoolLiquidityUsd?: number;
  maxPoolLiquidityUsd?: number; // skip giant stable pools dominated by arb bots
  concurrency?: number;
  activityWindowDays?: number;
}

interface DexPair {
  pairAddress: string;
  mint: string;
  symbol: string;
  liquidityUsd: number;
  volume24h: number;
}

export class OnchainSolanaSource implements WhaleSource {
  name = 'onchain';
  private rpcUrl: string;
  private solPriceUsd = 0;

  constructor(apiKey: string = config.HELIUS_API_KEY) {
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  async fetchCandidates(chain: Chain): Promise<CandidateWallet[]> {
    if (chain !== 'solana') {
      console.warn('[onchain] OnchainSolanaSource only supports Solana. Returning [].');
      return [];
    }
    if (!config.HELIUS_API_KEY) throw new Error('HELIUS_API_KEY required for onchain discovery');

    const opts = this.defaults();
    this.solPriceUsd = await this.fetchSolPrice();
    console.log(`[onchain] SOL price ≈ $${this.solPriceUsd.toFixed(2)}`);

    // 1. Discover real pools from DexScreener
    const pools = await this.discoverPools(opts);
    console.log(`[onchain] ${pools.length} pools selected for swapper discovery.`);

    // 2. Collect candidates two ways:
    //    (a) biggest HOLDERS of each token (getTokenLargestAccounts) — true whales, and
    //    (b) recent SWAPPERS of each pool — proves "trades constantly".
    const candidateSet = new Set<string>();
    for (const pool of pools) {
      if (candidateSet.size >= opts.maxCandidates) break;
      const holders = await this.whaleHoldersForToken(pool.mint, opts.holdersPerToken);
      holders.forEach((w) => candidateSet.add(w));
      const swappers = await this.swappersForPool(pool.pairAddress, opts.sigsPerPool);
      swappers.forEach((w) => candidateSet.add(w));
      console.log(
        `[onchain] ${pool.symbol}: +${holders.size} holders, +${swappers.size} swappers (total ${candidateSet.size})`
      );
    }

    const candidates = Array.from(candidateSet).slice(0, opts.maxCandidates);
    console.log(`[onchain] Verifying ${candidates.length} distinct candidate wallets...`);

    // 3. Verify + enrich each candidate (bounded concurrency)
    const verified: CandidateWallet[] = [];
    let done = 0;
    await this.mapPool(candidates, opts.concurrency, async (addr) => {
      const c = await this.verifyWallet(addr, opts.activityWindowDays);
      done++;
      if (done % 25 === 0) console.log(`[onchain]   verified ${done}/${candidates.length}`);
      if (c) verified.push(c);
    });

    console.log(`[onchain] ${verified.length}/${candidates.length} candidates are real user wallets.`);
    return verified;
  }

  private defaults(): Required<OnchainSolanaOptions> {
    return {
      maxTokens: Number(process.env.ONCHAIN_MAX_TOKENS ?? 18),
      sigsPerPool: Number(process.env.ONCHAIN_SIGS_PER_POOL ?? 25),
      holdersPerToken: Number(process.env.ONCHAIN_HOLDERS_PER_TOKEN ?? 20),
      maxCandidates: Number(process.env.ONCHAIN_MAX_CANDIDATES ?? 250),
      minPoolLiquidityUsd: Number(process.env.ONCHAIN_MIN_POOL_LIQ ?? 150000),
      maxPoolLiquidityUsd: Number(process.env.ONCHAIN_MAX_POOL_LIQ ?? 30000000),
      concurrency: Number(process.env.ONCHAIN_CONCURRENCY ?? 5),
      activityWindowDays: 30,
    };
  }

  private async rpc(method: string, params: any[]): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (r.status === 429) {
          await this.sleep(400 * (attempt + 1));
          continue;
        }
        const j = (await r.json()) as any;
        if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
        return j.result;
      } catch (err: any) {
        if (attempt === 2) throw err;
        await this.sleep(300 * (attempt + 1));
      }
    }
  }

  /** Resilient JSON GET with retry/backoff (DexScreener throttles aggressive callers). */
  private async getJson(url: string, retries = 4): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 429 || r.status >= 500) {
          await this.sleep(1200 * (i + 1));
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (i === retries - 1) throw e;
        await this.sleep(800 * (i + 1));
      }
    }
  }

  private async fetchSolPrice(): Promise<number> {
    try {
      const json = (await this.getJson(`https://api.dexscreener.com/latest/dex/tokens/${WSOL_MINT}`)) as any;
      const pairs: any[] = json?.pairs || [];
      const best = pairs
        .filter((p) => p.chainId === 'solana' && p.priceUsd)
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      return best ? parseFloat(best.priceUsd) : 0;
    } catch {
      return 0;
    }
  }

  /** Pull trending Solana tokens from DexScreener and resolve their best pools in a liquidity band. */
  private async discoverPools(opts: Required<OnchainSolanaOptions>): Promise<DexPair[]> {
    // Ordered + de-duped candidate token list. Blue-chip tickers go FIRST so their
    // (whale-grade) pools are not crowded out by tiny trending memecoins.
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (addr?: string) => {
      if (addr && !seen.has(addr)) {
        seen.add(addr);
        ordered.push(addr);
      }
    };

    // 1. Blue-chip Solana tickers (resolved by DexScreener search, no hard-coded addresses).
    const tickers = (process.env.ONCHAIN_TICKERS ?? 'JUP,WIF,BONK,JTO,PYTH,RAY').split(',');
    for (const q of tickers) {
      try {
        const search = (await this.getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q.trim())}`)) as any;
        const sol = (search?.pairs || [])
          .filter((p: any) => p.chainId === 'solana' && p.baseToken?.address)
          .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        sol.slice(0, 3).forEach((p: any) => add(p.baseToken.address));
      } catch {
        /* ignore ticker */
      }
      await this.sleep(250);
    }

    // 2. Trending boosted tokens (fill remaining slots).
    try {
      const boosts = (await this.getJson('https://api.dexscreener.com/token-boosts/top/v1')) as any[];
      for (const b of boosts || []) {
        if (b.chainId === 'solana' && b.tokenAddress) add(b.tokenAddress);
      }
    } catch (e: any) {
      console.warn('[onchain] token-boosts fetch failed:', e.message);
    }
    const tokenAddrs = ordered;

    const pools: DexPair[] = [];
    for (const addr of Array.from(tokenAddrs).slice(0, opts.maxTokens * 2)) {
      if (pools.length >= opts.maxTokens) break;
      try {
        const json = (await this.getJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`)) as any;
        const pairs: any[] = (json?.pairs || []).filter((p: any) => p.chainId === 'solana');
        pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        const best = pairs[0];
        const liq = best?.liquidity?.usd || 0;
        if (best && liq >= opts.minPoolLiquidityUsd && liq <= opts.maxPoolLiquidityUsd) {
          pools.push({
            pairAddress: best.pairAddress,
            mint: best.baseToken?.address || addr,
            symbol: best.baseToken?.symbol || '???',
            liquidityUsd: liq,
            volume24h: best.volume?.h24 || 0,
          });
        }
      } catch {
        /* ignore token */
      }
    }
    pools.sort((a, b) => b.volume24h - a.volume24h);
    return pools;
  }

  /** Extract recent distinct fee-payer (trader) wallets from a pool's recent signatures. */
  private async swappersForPool(pairAddress: string, sigLimit: number): Promise<Set<string>> {
    const out = new Set<string>();
    let sigs: any[] = [];
    try {
      sigs = (await this.rpc('getSignaturesForAddress', [pairAddress, { limit: sigLimit }])) || [];
    } catch {
      return out;
    }
    for (const s of sigs) {
      if (s.err) continue; // skip failed txs
      try {
        const tx = await this.rpc('getTransaction', [
          s.signature,
          { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' },
        ]);
        const keys = tx?.transaction?.message?.accountKeys;
        if (!keys || keys.length === 0) continue;
        // Fee payer = first signer account
        const signer = keys.find((k: any) => k.signer) || keys[0];
        const pubkey = signer?.pubkey || signer;
        if (pubkey) out.add(pubkey);
      } catch {
        /* skip tx */
      }
    }
    return out;
  }

  /** Biggest holders of a token (getTokenLargestAccounts), resolved to their owner wallets. */
  private async whaleHoldersForToken(mint: string, topN: number): Promise<Set<string>> {
    const out = new Set<string>();
    let largest: any;
    try {
      largest = await this.rpc('getTokenLargestAccounts', [mint]);
    } catch {
      return out;
    }
    const accounts = (largest?.value || []).slice(0, topN);
    for (const a of accounts) {
      try {
        const info = await this.rpc('getAccountInfo', [a.address, { encoding: 'jsonParsed' }]);
        const owner = info?.value?.data?.parsed?.info?.owner;
        if (owner) out.add(owner); // owner of the token account = the holder wallet
      } catch {
        /* skip */
      }
    }
    return out;
  }

  /** Verify a candidate is a real user wallet and compute its metrics. Returns null if excluded. */
  private async verifyWallet(address: string, windowDays: number): Promise<CandidateWallet | null> {
    // Owner check: real user wallets are owned by the System Program (and not executable)
    let info: any;
    try {
      info = await this.rpc('getAccountInfo', [address, { encoding: 'base64' }]);
    } catch {
      return null;
    }
    const val = info?.value;
    if (!val || val.owner !== SYSTEM_PROGRAM || val.executable) return null; // program/PDA/token acct

    // SOL balance -> USD
    let solUsd = 0;
    try {
      const bal = await this.rpc('getBalance', [address]);
      solUsd = ((bal?.value || 0) / 1e9) * this.solPriceUsd;
    } catch {
      /* ignore */
    }

    // Token accounts: stablecoin balances + distinct token diversity
    let stableUsd = 0;
    let distinctTokens = 0;
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      try {
        const res = await this.rpc('getTokenAccountsByOwner', [
          address,
          { programId },
          { encoding: 'jsonParsed' },
        ]);
        for (const acc of res?.value || []) {
          const info2 = acc.account?.data?.parsed?.info;
          const amt = info2?.tokenAmount?.uiAmount || 0;
          if (amt > 0) {
            distinctTokens++;
            if (STABLE_MINTS.has(info2.mint)) stableUsd += amt;
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Activity: recent signatures -> swaps30d proxy + avg/day + bot detection
    let swaps30d = 0;
    let avgSwapsPerDay = 0;
    let isBot = false;
    try {
      const sigs: any[] = (await this.rpc('getSignaturesForAddress', [address, { limit: 100 }])) || [];
      const cutoff = Date.now() / 1000 - windowDays * 86400;
      const inWindow = sigs.filter((s) => (s.blockTime || 0) >= cutoff);
      swaps30d = inWindow.length;
      if (sigs.length >= 2) {
        const newest = sigs[0].blockTime || 0;
        const oldest = sigs[sigs.length - 1].blockTime || newest;
        const spanDays = Math.max((newest - oldest) / 86400, 0.5);
        avgSwapsPerDay = Math.round((sigs.length / spanDays) * 100) / 100;
        // If 100 sigs span a very short time, it's a high-frequency bot
        if (sigs.length >= 100 && spanDays < 2) isBot = true;
      }
    } catch {
      /* ignore */
    }

    const estUsdBalance = Math.round(solUsd + stableUsd);

    return {
      chain: 'solana',
      address,
      estUsdBalance,
      swaps30d,
      avgSwapsPerDay,
      distinctTokensCount: distinctTokens,
      avgHoldingHours: 24, // neutral prior; true holding period needs deeper tx analysis (later)
      label: undefined,
      category: 'smart_money',
      isContract: false,
      isExchangeOrBridge: false,
      isBot,
    };
  }

  private async mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    let idx = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]);
      }
    });
    await Promise.all(workers);
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
