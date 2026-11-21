# Module: trading

> Phase **P4** · Depends on: `core`, `wallet`, `market`, `identity` · Refactor of `src/trading/{engine,store}.ts` · Owner: flasharb

## 1. Purpose & responsibilities
The autopilot: react to `call.alerted` → **auto-buy** for enabled funded users within their limits →
**monitor** open positions → **exit** on take-profit (moon-bag), trailing stop, stop-loss, or rug. Owns
per-user config, positions, and trade legs. Open to **all funded users** (no VIP gate).

## 2. Out of scope
Signing/balances → `wallet.withSigner`. Quotes/swaps → `market`. Fee on profit → `fees` (reacts to `position.closed`). Signal source → `scanner`.

## 3. Folder & files
`modules/trading/`: `trading.types.ts · trading.repo.ts · trading.engine.ts · trading.config.ts · trading.service.ts · trading.controller.ts · trading.routes.ts · trading.events.ts · index.ts`

## 4. Data model (add `user_id`, migrate off `telegram_user_id`)
- `trading_configs(user_id unique, enabled, buy_sol, tp_pct, sl_pct, trail_pct, tp_sell_pct, slippage_bps, max_concurrent, max_daily_buys, daily_buys, daily_reset_at)`
- `positions(user_id, candidate_id, token_address, status, cost_lamports, tokens_bought, tokens_remaining, cost_remaining_lamports, base_value_lamports, peak_multiple, tp_hit, proceeds_lamports, realized_pnl_lamports, exit_reason, …)`
- `trades(position_id, user_id, side, kind, tokens_raw, sol_lamports, tx_sig, …)`

## 5. Types & DTOs
```ts
interface TradingConfig { enabled; buySol; tpPct; slPct; trailPct; tpSellPct; slippageBps; maxConcurrent; maxDailyBuys }
const ConfigPatch = z.object({ enabled: z.boolean().optional(), buySol: z.number().min(0.001).optional(),
  tpPct: z.number().min(10).max(10000).optional(), slPct: z.number().min(1).max(95).optional(),
  trailPct: z.number().min(1).max(90).optional(), tpSellPct: z.number().min(0).max(100).optional(),
  slippageBps: z.number().min(50).max(5000).optional(), maxConcurrent: z.number().int().min(1).max(50).optional(),
  maxDailyBuys: z.number().int().min(1).max(200).optional() });
interface PositionDto { id; token; status; buySol; peakMultiple; tpHit; multiple; valueSol; pnlSol; exitReason }
interface Portfolio { balanceSol; openCount; closed; winRate; realizedPnlSol; feesPaidSol }
```

## 6. Service API
```ts
getConfig(userId) / updateConfig(userId, patch): Promise<TradingConfig>
getOpenPositions(userId) / getPosition(userId,id) / getPortfolio(userId)
// engine (scheduler + event driven):
onCallAlerted(candidate): Promise<void>     // subscribes to 'call.alerted'; buys for eligible users
monitorPositions(): Promise<number>          // interval; re-price + exits
```
Engine carries forward the audited fixes: actual on-chain balance as source of truth; exits clamp to live
balance; price-based multiple vs `base_value`; exit slippage floor; fee-inclusive cost basis; transient-vs-rug
streak; fetch timeouts. On close → **emit `position.closed`** (fees + notifications react).

## 7. HTTP API (base `/api/v1/trading`, `requireAuth`)
| Method | Path | Returns |
|---|---|---|
| GET | `/config` | `TradingConfig` |
| PATCH | `/config` | updated `TradingConfig` |
| GET | `/positions` | `PositionDto[]` (open) |
| GET | `/positions/:id` | `PositionDto` |
| GET | `/portfolio` | `Portfolio` |

## 8. Events
Consumes `call.alerted`. Emits `position.opened`, `position.closed`.

## 9. Dependencies
`wallet` (withSigner, balances), `market` (quotes/swaps/value), `identity` (resolve user), `core` (config/events).

## 10. Security & validation
Global `TRADING_ENABLED` kill-switch; per-trade SOL ceiling; fee reserve; daily/concurrency caps;
idempotent buys (unique `(user_id, candidate_id)`); config bounds via Zod. Autopilot continues to run
exits even if the user later disables new buys.

## 11. Observability
Buys/sells, fill success, stuck positions, exit reasons; alerts on repeated exit failures.

## 12. Testing
Unit: TP/SL/trail/moon-bag decisions, PnL math, idempotency, daily reset. Devnet e2e: call→buy→exit.

## 13. Tasks — A→Z
- [ ] a. Add `user_id` to trading tables; dual read/write; backfill from telegram map.
- [ ] b. Split engine/store into `trading.{engine,config,service,repo}`; key by `user_id`.
- [ ] c. Subscribe to `call.alerted`; emit `position.opened/closed`.
- [ ] d. Controller + routes (config/positions/portfolio).
- [ ] e. Keep all audited correctness fixes; port tests; devnet e2e.

## 14. Acceptance criteria
- Toggling config on the web changes live behavior; parity with the bot.
- Autopilot buys off events for any funded user; exits behave exactly as the audited engine.
- `position.closed` fires with correct realized PnL for `fees` to assess.
