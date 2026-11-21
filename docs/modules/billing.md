# Module: billing

> Phase **P6** · Depends on: `core`, `identity`, `wallet` · Refactor of `src/bot/billing.ts` · Owner: flasharb

## 1. Purpose & responsibilities
Own **entitlements** (one `vip_until` per user) and both payment rails that extend it: **crypto**
(pay SOL/USDC to treasury → verify on-chain) and **Telegram Stars**. Provides the `isVip` check used
everywhere. VIP gates premium calls/channel — **not** autopilot.

## 2. Out of scope
What VIP unlocks (calls/channel) → `scanner`/`notifications`. Trading-wallet mechanics → `wallet`.

## 3. Folder & files
`modules/billing/`: `billing.types.ts · billing.repo.ts · billing.service.ts · billing.crypto.ts · billing.stars.ts · billing.reconciler.ts · billing.controller.ts · billing.routes.ts · billing.events.ts · index.ts`

## 4. Data model
```sql
subscriptions(user_id unique, status, vip_until timestamptz, plan, invite_link, created_at, updated_at)
payments(id, user_id, rail text check (rail in ('crypto','stars')),
  amount numeric, currency text, reference text,   -- memo/charge id
  tx_sig text null, charge_id text null, status text, created_at)
```
Config: `VIP_DAYS`, `SUB_PRICE_STARS`, `VIP_PRICE_SOL` (or USDC / USD-oracle), `BILLING_TREASURY_ADDRESS`.

## 5. Types & DTOs
```ts
interface Vip { isVip: boolean; vipUntil: string | null }
interface Plan { id; days; priceStars; priceSol; priceUsd? }
interface Intent { reference; treasury; amountSol; expiresAt }
const IntentReq = z.object({ plan: z.string() });
```

## 6. Service API
```ts
getVip(userId): Promise<Vip>              // used by /account/me + requireVip
isVip(userId): Promise<boolean>
listPlans(): Plan[]
createCryptoIntent(userId, plan): Promise<Intent>   // unique reference/memo + amount + treasury
confirmCryptoPayment(reference, txSig): Promise<void> // verify transfer to treasury (amount+memo, finality)
recordStarsPayment(userId, charge): Promise<void>     // from the bot's successful_payment
extendVip(userId, days): Promise<void>                // shared by both rails -> emit vip.changed
expireSweep(): Promise<number>                        // lapse VIPs -> emit vip.changed(false)
```

## 7. HTTP API (base `/api/v1/billing`)
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/plans` | — | `Plan[]` |
| POST | `/intent` | requireAuth | `Intent` (crypto) |
| POST | `/confirm` | requireAuth + idempotency | `{ vipUntil }` (submit tx sig; backend verifies) |
| GET | `/status` | requireAuth | `Vip` |

## 8. Events
Emits `payment.confirmed`, `vip.changed`. Consumes none (the bot calls `recordStarsPayment`).

## 9. Dependencies
`identity` (resolve user), `wallet`/`market` (on-chain verify via RPC), `core`. A **reconciler** cron
watches the treasury for unmatched/late payments.

## 10. Security & validation
- Crypto verify: confirm a finalized transfer to treasury matching `reference` (memo) + amount; idempotent per tx sig.
- Stars: verify `successful_payment`/pre-checkout (existing). One `vip_until` advanced by either rail.
- Never trust client-claimed payment — always verify on-chain / via Telegram.

## 11. Observability
MRR, active VIPs, payment success/latency, reconciler catches, expiry sweeps.

## 12. Testing
Unit: vip_until math, plan pricing, idempotency. Integration: intent→confirm (devnet transfer), stars path, expiry sweep. Verify both rails land on one entitlement.

## 13. Tasks — A→Z
- [ ] a. Migrate `subscriptions` to `user_id` + `vip_until`; add `payments`.
- [ ] b. `billing.service` (getVip/isVip/extendVip/expireSweep).
- [ ] c. `billing.crypto` (intent + on-chain verify) + reconciler cron.
- [ ] d. `billing.stars` (port existing Stars flow; call `recordStarsPayment`).
- [ ] e. Controller + routes; wire `requireVip` to `isVip`.
- [ ] f. Emit `vip.changed`; notifications react (channel add/remove).
- [ ] g. Tests (unit + devnet integration).

## 14. Acceptance criteria
- Paying by crypto (verified on-chain) or Stars extends the same `vip_until`.
- `requireVip` / premium-call gating works across web + bot from one source.
- Expiry sweep lapses VIP and triggers channel removal; reconciler recovers delayed crypto payments.
