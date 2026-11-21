# Module: market

> Phase **exists (refactor)** · Depends on: `core` · Refactor of `src/providers/*` + `src/trading/jupiter.ts` · Owner: flasharb

## 1. Purpose & responsibilities
A shared, provider-agnostic façade over external market + execution data: **swaps/quotes/valuation**
(Jupiter), **token overview/price/holders** (Birdeye), **market data** (DexScreener), **discovery**
(GeckoTerminal), **safety** (GoPlus + Helius RPC). One place for rate-limits, caching, timeouts, retries.

## 2. Out of scope
Trade decisions → `trading`. Signing → `wallet`. Candidate persistence → `scanner`.

## 3. Folder & files
`modules/market/`: `market.types.ts · providers/{jupiter,birdeye,dexscreener,geckoterminal,safety}.ts · market.service.ts · index.ts` (no controller/routes).

## 4. Data model
None (stateless; in-memory caches only).

## 5. Types & DTOs
```ts
interface Quote { inputMint; outputMint; inAmount: string; outAmount: string; priceImpactPct?: string }
interface Overview { holder: number; liquidityUsd: number; volume24hUsd: number; priceUsd: number }
interface MarketData { liquidityUsd; volume24hUsd; priceUsd; fdvUsd }
interface SafetyResult { passed; verified; mintRevoked; freezeRevoked; transferable; holderCount; top10Pct; checks[] }
interface DiscoveredPool { mint; symbol; name; poolAddress; dex; poolCreatedAt; liquidityUsd; volume24hUsd; fdvUsd; priceUsd }
```

## 6. Service API
```ts
// execution (Jupiter) — all amounts in base units
getQuote(params): Promise<Quote | null>            // null = no route; throws on transient (429/5xx/timeout)
buyToken(kp, mint, solLamports, slippageBps): Promise<{ sig; tokensRaw; costLamports }>
sellToken(kp, mint, tokensRaw, slippageBps): Promise<{ sig; solLamports; tokensRaw }>
quoteValueLamports(mint, tokensRaw, slippageBps): Promise<number | null>
// data
getOverview(mint): Promise<Overview | null>        // Birdeye (60s cache, 429 retry)
getMarketData(mint): Promise<MarketData | null>    // DexScreener
discover(): Promise<DiscoveredPool[]>              // GeckoTerminal
checkSafety(mint, opts): Promise<SafetyResult>     // GoPlus + RPC fallback
```

## 7. HTTP API
None.

## 8. Events
None (pure provider layer).

## 9. Dependencies
`core` (config, logger). External: Jupiter, Birdeye, DexScreener, GeckoTerminal, GoPlus, Helius RPC,
`@solana/web3.js`.

## 10. Security & validation
Per-provider timeouts (`AbortSignal.timeout`) + retry/backoff; API keys from env; distinguish "no route"
from transient errors (don't let a blip look like a rug — consumed by trading/scanner). No user data leaves to providers.

## 11. Observability
Per-provider error-rate + latency metrics; log 429/5xx; cache hit rates.

## 12. Testing
Unit with mocked fetch: quote parsing, no-route vs transient, cache/retry. Contract tests against devnet/live (smoke).

## 13. Tasks — A→Z
- [ ] a. Move `src/providers/*` + `src/trading/jupiter.ts` under `modules/market/providers`.
- [ ] b. Unify timeouts/retries/caches; single `market.service` façade.
- [ ] c. Keep the existing transient-vs-no-route semantics (already fixed in trading).
- [ ] d. Metrics + tests.

## 14. Acceptance criteria
- `trading` and `scanner` consume only `market.service` (no direct provider imports).
- Quotes/valuation/overview/discovery/safety behave exactly as today, with uniform timeouts + metrics.
