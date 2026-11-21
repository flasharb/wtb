# Module: wallet

> Phase **P2–P3** · Depends on: `core`, `identity` · Refactor of `src/trading/wallet.ts` + `crypto.ts` · Owner: flasharb

## 1. Purpose & responsibilities
The **exportable managed trading wallet**: create (BIP39 seed, Phantom-path derivation), import, show
seed/key once, keep the secret encrypted so autopilot can sign, read balances, deposit (address), and
withdraw. The signing surface used by `trading` and `fees`.

## 2. Out of scope
Trade logic → `trading`. Fee math/transfer → `fees` (uses this module's signer). Identity → `identity`.

## 3. Folder & files
`modules/wallet/`: `wallet.types.ts · wallet.repo.ts · wallet.service.ts · wallet.keyvault.ts · wallet.controller.ts · wallet.routes.ts · index.ts`

## 4. Data model
```sql
-- evolve existing trading_wallets:
trading_wallets(
  id uuid pk, user_id uuid fk -> users unique,
  public_key text not null,
  encrypted_secret text not null,    -- envelope: wrapped data-key + AES-256-GCM(secret)
  derivation text null,              -- "bip39:m/44'/501'/0'/0'" | "imported" | "legacy-random"
  created_at timestamptz)
wallet_withdrawals(
  id uuid pk, user_id uuid, to_address text, lamports numeric(30,0),
  tx_sig text, status text, created_at timestamptz)
audit_log(... action in ('wallet.create','wallet.export','wallet.sign','wallet.withdraw'))
```
Legacy rows (random `Keypair.generate`) keep working: `derivation='legacy-random'`, export = private key only.

## 5. Types & DTOs
```ts
interface TradingWallet { address: string; balanceSol: number; derivation: string }
interface CreatedWallet { address: string; mnemonic: string; secretKeyB58: string } // returned ONCE
const ImportReq   = z.object({ secret: z.string() });          // seed phrase or base58 key
const WithdrawReq = z.object({ toAddress: z.string(), amountSol: z.number().positive() });
const ExportReq   = z.object({});                               // requireFreshAuth
```

## 6. Service API
```ts
create(userId): Promise<CreatedWallet>          // BIP39 mnemonic -> derive -> encrypt+store -> show once
import(userId, secret): Promise<TradingWallet>  // accept mnemonic or base58 secret key
get(userId): Promise<TradingWallet | null>
getBalanceSol(address): Promise<number>
getTokenBalanceRaw(address, mint): Promise<bigint>
withdraw(userId, toAddress, amountSol): Promise<{ sig }>   // controls per §10
export(userId): Promise<{ mnemonic?: string; secretKeyB58: string }> // requireFreshAuth, audited
// signer used by trading/fees (never leaves the backend):
withSigner<T>(userId, fn: (kp: Keypair) => Promise<T>): Promise<T>  // decrypt -> use -> zero
```

## 7. Keyvault (`wallet.keyvault.ts`)
- **MVP:** AES-256-GCM(secret) with env master key (current behavior).
- **Target (P8):** envelope — per-wallet data key, wrapped by a KMS master key; decrypt only inside
  `withSigner`, zero buffers after. All decrypts audited.

## 8. HTTP API (base `/api/v1/wallet`, all `requireAuth`)
| Method | Path | Guard | Returns |
|---|---|---|---|
| POST | `/create` | auth | `CreatedWallet` (once) |
| POST | `/import` | auth | `TradingWallet` |
| GET | `/` | auth | `TradingWallet` (address + live balance) |
| POST | `/withdraw` | auth + freshAuth + idempotency | `{ sig }` |
| POST | `/export` | auth + freshAuth | `{ mnemonic?, secretKeyB58 }` (audited) |

## 9. Events
Emits `wallet.created`, `wallet.withdrawn`. Consumes none.

## 10. Security & validation
- Secrets **never** logged or returned except explicit `create`/`export` (both audited; export needs fresh auth).
- Withdraw controls (config): default suggested destination = connected Phantom; per-day cap
  (`WALLET_DAILY_WITHDRAW_SOL`); large-amount confirmation; valid-address check; fee reserve kept.
- `withSigner` is the only path that decrypts; buffers zeroed after use.
- Idempotency key on withdraw to prevent double-send.

## 11. Observability
`audit_log` for create/export/withdraw/sign; alert on hot-wallet anomalies (rapid drains).

## 12. Testing
Unit: BIP39 derivation matches Phantom (known vector), encrypt/decrypt round-trip, withdraw cap logic.
Integration/e2e on **devnet**: create → deposit → balance → withdraw; import existing; export reveals correct key.

## 13. Tasks — A→Z
- [ ] a. Add `bip39` + `ed25519-hd-key`; mnemonic→keypair (Phantom path) util + test vector.
- [ ] b. Keyvault module (envelope-ready interface; MVP = AES-GCM).
- [ ] c. Migrate `trading_wallets` (add `user_id`, `derivation`); backfill legacy as `legacy-random`.
- [ ] d. `wallet.service`: create/import/get/balance/withdraw/export/withSigner.
- [ ] e. `wallet_withdrawals` + `audit_log`; withdraw controls.
- [ ] f. Controller + routes with guards + idempotency.
- [ ] g. Devnet e2e; unit tests.

## 14. Acceptance criteria
- Create returns a seed phrase that imports into Phantom as the same address.
- Secret is encrypted at rest; autopilot signs via `withSigner`; nothing leaks in logs.
- Withdraw respects caps + fresh-auth + idempotency and logs a tx sig; export is audited.
- Legacy wallets still sign and can export their private key.
