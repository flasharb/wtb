# Module: fees

> Phase **P5** · Depends on: `core`, `wallet`, `trading` · New module · Owner: flasharb

## 1. Purpose & responsibilities
Collect the **1% performance fee** on every position that closes in **net profit** (never on losses,
never on principal), record an immutable ledger, and move fees to the **treasury**. Exposes fee history.

## 2. Out of scope
Trade execution → `trading`. Signing → `wallet.withSigner`. VIP/subscription billing → `billing`.

## 3. Folder & files
`modules/fees/`: `fees.types.ts · fees.repo.ts · fees.service.ts · fees.sweeper.ts · fees.controller.ts · fees.routes.ts · index.ts`

## 4. Data model
```sql
fees(
  id uuid pk, user_id uuid, position_id uuid,
  profit_lamports numeric(30,0),      -- realized net profit at close
  fee_bps int,                        -- snapshot of rate (default 100 = 1%)
  fee_lamports numeric(30,0),
  status text check (status in ('accrued','swept','skipped')) default 'accrued',
  tx_sig text null, created_at, swept_at timestamptz null)
```
Config: `PERF_FEE_BPS=100`, `FEE_TREASURY_ADDRESS`, `FEE_MIN_LAMPORTS` (skip dust), `FEE_SWEEP_MODE` (`accrue`|`immediate`), `FEE_SWEEP_CRON`.

## 5. Types & DTOs
```ts
interface Fee { positionId; profitSol; feeBps; feeSol; status; txSig?; createdAt }
interface FeeSummary { totalFeesSol; count; lastSweptAt: string | null }
```

## 6. Service API
```ts
assessOnClose(position): Promise<Fee | null>
  // profit = proceeds - cost_basis; if profit <= 0 -> no fee
  // fee = profit * PERF_FEE_BPS/10_000; if fee < FEE_MIN_LAMPORTS -> skip (ledger 'skipped')
  // mode 'immediate' -> transfer now (wallet.withSigner -> SystemProgram.transfer to treasury)
  // mode 'accrue'    -> ledger 'accrued'; sweeper settles later
listFees(userId, page): Promise<Page<Fee>>
summary(userId): Promise<FeeSummary>
sweep(): Promise<{ swept: number; sol: number }>   // batch accrued -> treasury (per user), cron
```

## 7. HTTP API (base `/api/v1/account`, `requireAuth`)
| Method | Path | Returns |
|---|---|---|
| GET | `/fees` | `Page<Fee>` |
| GET | `/fees/summary` | `FeeSummary` |

## 8. Events
Consumes `position.closed`. Emits `fee.collected`.

## 9. Dependencies
`trading` (position data via event payload), `wallet` (withSigner transfer, balance), `core`.

## 10. Security & validation
- Fee only on **net profit at full close**; idempotent per `position_id` (unique) — never double-charge.
- Transfer keeps the wallet's fee reserve intact; if balance can't cover fee, mark `accrued` and retry on sweep.
- Treasury address validated + from config; all transfers audited with tx sig.

## 11. Observability
Fee revenue metric, accrued-vs-swept balance, failed-transfer alerts, per-day totals.

## 12. Testing
Unit: profit→fee math, loss = no fee, dust skip, idempotency. Devnet e2e: profitable close transfers exact fee + ledger row; sweep batches correctly.

## 13. Tasks — A→Z
- [ ] a. `fees` table + config.
- [ ] b. `assessOnClose` (profit/fee math, modes) subscribed to `position.closed`.
- [ ] c. Treasury transfer via `wallet.withSigner`; audit + tx sig.
- [ ] d. `fees.sweeper` cron for accrue mode.
- [ ] e. Controller + routes (`/account/fees`, summary); show fee in position close + portfolio.
- [ ] f. Unit + devnet e2e.

## 14. Acceptance criteria
- A profitable close creates one `fees` row with fee = 1% of net profit and (immediate) a treasury tx; a loss creates none.
- Fee is never double-charged for a position; user-reported Net PnL already subtracts it.
- Sweep settles accrued fees to treasury and marks them `swept` with a tx sig.
