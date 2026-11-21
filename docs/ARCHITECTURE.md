# Stack Alpha — Enterprise Architecture & Build Plan

> Status: **proposed** · Owner: flasharb · Last updated: 2026-11-21
> This is the source-of-truth design for turning Stack Alpha into a full product:
> a backend/API + Telegram manager, a web app that consumes the API, wallet-connect
> identity, an in-house custodial trading wallet system, performance fees, and
> dual (crypto + Stars) billing.

---

## 1. Product vision

Stack Alpha scans every new Solana launch, calls only the safety-vetted survivors, and
**auto-trades them for members on full autopilot** — on the web and in Telegram, backed by
one API. Revenue comes from two streams:

1. **VIP subscription** — access to full calls + autopilot (paid in crypto on the web, or
   Telegram Stars in the bot).
2. **Performance fee** — a percentage of **realized profit** on each position that closes in
   profit (never on losses). This is only possible because we run our own custodial wallet
   system.

Registration is **Sign-In With Solana** (connect wallet + sign a message). No passwords, no email.

---

## 2. Guiding principles

- **One backend, many surfaces.** The Fastify backend owns all state and business logic. The web
  app and the Telegram bot are both thin clients of the same API/services. No business logic in the web app.
- **API-first.** Every capability is a documented, versioned, authenticated API endpoint.
- **Security before features.** We custody user funds. Key management, least privilege, auditability,
  and withdrawal controls are first-class, not afterthoughts.
- **Single identity.** A user is one canonical record that may own a wallet (web) and/or a Telegram id.
- **Honest accounting.** Fees, PnL and entitlements are ledgers, not derived guesses. Every money
  movement has a row and (where on-chain) a tx signature.
- **Fail safe.** Trading degrades safely (global kill-switch, per-user caps); public pages degrade to
  cached/placeholder data; nothing cascades into fund loss.
- **Don't break what's live.** The bot, scanner, and current custodial engine are in production and
  must keep working through every migration.

---

## 3. System architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                 BACKEND (Fastify)            │
   Web (Next.js/Vercel)  │  ┌───────────────── API layer ───────────┐  │
   ───── HTTPS ─────────▶│  │ public · auth · account · wallet ·     │  │
   wallet-connect (SIWS) │  │ trading · billing  (versioned /api/v1) │  │
                         │  └───────────────────────────────────────┘  │
   Telegram (grammY bot) │  ┌──────────── core services ────────────┐  │
   ───── in-process ────▶│  │ UserService  WalletService  Trading-  │  │
   (same node process)   │  │ Service  BillingService  FeeService   │  │
                         │  │ ScannerService  NotificationService   │  │
                         │  └───────────────────────────────────────┘  │
                         │  ┌──────────── infrastructure ───────────┐  │
                         │  │ Postgres (Neon) · Redis · Solana RPC · │  │
                         │  │ Jupiter · KMS/secret store · logging   │  │
                         │  └───────────────────────────────────────┘  │
                         └─────────────────────────────────────────────┘
```

- **Deployment:** backend on the DigitalOcean droplet (Docker Compose); web on Vercel. API exposed
  over HTTPS at `api.stackalpha.xyz` (Caddy auto-TLS → :3000). Web at `stackalpha.xyz`.
- **Boundaries:** the web never connects to the DB or RPC directly; it only calls the API. The
  Telegram bot calls the **same core services** in-process (not over HTTP) for low latency.

### 3.1 Code structure — modular monolith

One deployable backend, organized into **self-contained modules**. Each module owns its folder and its
own `types · api (routes) · controllers · services · repo`, talks to other modules only through their
**service interfaces or the event bus** (never another module's repo/DB), and is independently testable.
The web mirrors this with **feature modules** plus a **shared UI kit** (buttons, fields, modals…).

Full spec, per-module A→Z plans, conventions, and the shared-UI inventory live in
**[`docs/modules/README.md`](./modules/README.md)** and the per-module docs under `docs/modules/`.

```
src/
  modules/
    core/          config, db, redis, logger, errors, http, events, crypto   (shared foundation)
    identity/      users, identities, account linking
    auth/          SIWS, nonces, sessions/JWT, guards
    wallet/        exportable trading wallet, keyvault, deposit/withdraw/export
    market/        providers: jupiter, birdeye, dexscreener, gecko, safety
    scanner/       launch discovery → vetting → calls → track record
    trading/       autopilot engine, config, positions, exits
    fees/          performance-fee calc, ledger, treasury sweep
    billing/       entitlements/VIP, crypto + Stars payments
    notifications/ Telegram bot surface + notification dispatch
  app.ts           wires modules into the Fastify server + schedulers
web/
  modules/<feature>/   (ui, api-client, hooks, types per feature)
  components/ui/        shared kit: Button, Field, Modal, Card, Toast, WalletButton…
```

Each backend module file set:

```
modules/<name>/
  <name>.types.ts        domain types, DTOs, Zod schemas, event payloads
  <name>.repo.ts         data access (Drizzle) — the ONLY place that touches this module's tables
  <name>.service.ts      business logic — the module's public interface to other modules
  <name>.controller.ts   HTTP handlers: validate → call service → format response
  <name>.routes.ts       Fastify route registration (maps paths → controller)
  <name>.events.ts       event names + payload types this module emits/consumes (optional)
  index.ts               the module's public exports (service + register(routes))
```

---

## 4. Identity & authentication

### 4.1 Canonical user

A new `users` table is the single identity. A user may link a wallet, a Telegram id, or both.

```
users
  id              uuid pk
  handle          text unique (optional display)
  created_at, updated_at
user_identities
  id              uuid pk
  user_id         uuid fk -> users
  kind            enum('wallet','telegram')
  identifier      text         -- wallet pubkey (base58) or telegram user id
  verified_at     timestamptz
  unique(kind, identifier)
```

All existing domain tables migrate from `telegram_user_id` to `user_id` (see §8.4). The bot resolves
its Telegram id → user via `user_identities`.

### 4.2 Sign-In With Solana (SIWS)

> **Decision:** login is **connect external Phantom** (the true-SIWS flow below). Your Phantom is your
> identity and its key is never shared. Separately you create an in-app **trading wallet** (§5) — a
> different address, app-created and exportable — that the backend funds-manages and automates. Identity
> wallet ≠ trading wallet.

1. Web: user connects Phantom/Solflare (Solana Wallet Adapter).
2. Web calls `POST /api/v1/auth/nonce { address }` → backend returns a one-time nonce + SIWS message.
3. Wallet signs the message; web calls `POST /api/v1/auth/verify { address, signature }`.
4. Backend verifies the ed25519 signature against the address + unused, unexpired nonce, then issues:
   - a short-lived **access JWT** (~15 min) and a rotating **refresh token** (httpOnly cookie).
5. Session is bound to `user_id`. First login auto-provisions a `users` row + wallet identity.

Nonces are single-use, stored with TTL (Redis), and bound to the address to prevent replay.

### 4.3 Linking surfaces

- From web (logged in via wallet): "Link Telegram" → deep-link `t.me/bot?start=link_<token>`; bot's
  `/start` consumes the token and attaches the Telegram identity to the same `user_id`.
- From Telegram: `/linkwallet` → shows a one-time web link to connect a wallet to the existing account.
- Linking merges entitlements and (optionally) trading data under one user.

---

## 5. User-owned, exportable wallet system ("our own wallet infra")

Separate from the **identity wallet** (the Phantom you log in with, §4.2), each user creates an in-app
**trading wallet** — a different address that **they own and can export**, but that the backend can also
sign with so autopilot runs 24/7 and the **1% performance fee** is collected automatically. (This is the
proven BonkBot/Trojan model: the app creates your trading wallet, lets you export the keys, auto-trades
it, and you fund it from / withdraw it back to your Phantom.)

- **Create:** the user clicks **Create Wallet**. The backend generates a **BIP39 seed phrase** and
  derives a Solana keypair on Phantom's path (`m/44'/501'/0'/0'`), so the exact wallet imports cleanly
  into Phantom/Solflare. The **seed phrase and private key are shown once** for the user to back up.
- **Own & export:** the user holds the seed/key and can import the wallet elsewhere or move funds out at
  any time — real ownership and a clean exit. "Import existing wallet" (paste seed/key) is also supported.
- **Automate:** the backend keeps the secret **encrypted at rest** so it can place buys/sells and collect
  fees without the user online.

> **Custody reality (stated plainly):** because the backend holds an encrypted copy of the key to
> automate trading, this is a **managed hot wallet** — convenient and automatable, but if the server were
> compromised, funds could be at risk. The user owning the seed gives them an *exit*, not immunity from a
> server breach. Treat it as a hot wallet; never hold more than you're actively trading. Everything in §12
> (KMS envelope encryption, signing isolation, audit, withdrawal controls) exists to shrink this risk.

### 5.1 Key management (hardening path)

- **Today (live):** per-user random keypair, secret AES-256-GCM encrypted with one master key in env
  (`WALLET_ENCRYPTION_KEY`). (Legacy wallets have no mnemonic — they export as a private key only.)
- **New wallets:** BIP39 mnemonic → Phantom-path derivation (`bip39` + `ed25519-hd-key` + `@solana/web3.js`),
  so users get a real, importable **seed phrase**. Secret still encrypted at rest for automation.
- **Enterprise target:** envelope encryption with a KMS-held master key; a narrow signing module that
  decrypts only for the duration of a signing call and zeroes memory after; encrypted backups + recovery
  runbook; append-only audit of every decrypt/sign/withdraw.

### 5.2 Deposits, withdrawals, export & fee collection

- **Deposit:** fund the wallet from anywhere (address + QR). Balances read live from RPC.
- **Withdraw:** to any address (policy per §17); every withdrawal logged with tx signature.
- **Export:** re-reveal seed/private key behind a confirmation + login re-auth, so users can self-custody
  at will.
- **Fee collection:** the backend signs the closing sell, so it deducts the **1% of profit** and routes it
  to the fee treasury as part of settlement (see §6.2) — no separate user approval needed.

### 5.3 Fund-safety controls

Global `TRADING_ENABLED` kill-switch; per-user daily spend + concurrency caps; fee reserve kept in each
wallet; idempotent buys; rug-confirm streak before force-close; exit slippage floor. (These exist today;
they carry into the new model.)

---

## 6. Trading engine & performance fees

### 6.1 Engine (exists; keyed to `user_id` after migration)

Signal → auto-buy for enabled users within limits → monitor open positions → exit on
take-profit (with moon-bag partial), trailing stop, stop-loss, or rug. All amounts tracked in base
units; triggers measured against entry **liquidation value** (not cost basis); PnL against cost basis.

### 6.2 Performance fee (new revenue pillar)

**Model:** on every position that **closes in net profit**, charge `PERF_FEE_BPS` (**100 = 1%**) of the
realized profit, moved from the user's trading wallet to the **fee treasury** wallet. Never on a loss;
never on the principal — only on profit.

```
realized_profit = total_proceeds − total_cost_basis   (at full close)
fee             = max(0, realized_profit) × PERF_FEE_BPS / 10_000
net_to_user     = realized_profit − fee
```

- **When:** computed at **full position close** on net profit (moon-bag partials accumulate into the
  position; the fee is assessed once, on the final net). This avoids charging a profitable leg that a
  later leg gives back.
- **How:** after the closing sell confirms, transfer `fee` SOL from the trading wallet → treasury, and
  write a `fees` ledger row (user_id, position_id, profit, fee_bps, fee_lamports, tx_sig). The user's
  reported Net PnL already subtracts the fee.
- **Gas optimization:** optionally **accrue** fees per close and **sweep** to treasury on a schedule
  (fewer txs) instead of one transfer per close — ledger records the accrual immediately either way.
- **Config:** `PERF_FEE_BPS`, `FEE_TREASURY_ADDRESS`, `FEE_MIN_LAMPORTS` (skip dust), `FEE_SWEEP_MODE`.
- **Transparency:** fees are shown per trade and in the portfolio; `/api/v1/account/fees` lists them.

### 6.3 Monetization summary

| Stream | Trigger | Rate (default) | Surface |
|---|---|---|---|
| VIP subscription | premium calls + follow-ups + private channel | 1000⭐ / 30d or crypto equiv. | web + bot |
| Performance fee | position closes in profit | **1% of profit** | automatic |

**Access:** autopilot is **open to any funded user** (no VIP required) — revenue comes from the 1% fee,
which scales with trading volume. VIP is a separate product selling the premium alpha: full real-time
calls, pump/fade/rug follow-ups, and the private channel.

---

## 7. Billing & entitlements

### 7.1 Entitlements

A single `entitlements`/`subscriptions` record per user holds `vip_until` (timestamp). VIP is active if
`vip_until > now`. Both payment rails extend the same field. **VIP gates the premium alpha** (full
real-time calls, follow-ups, private channel) — **not autopilot**, which is open to any funded user and
monetized via the 1% performance fee.

### 7.2 Crypto payments (web)

- Price VIP in SOL/USDC (configurable, optionally oracle-priced).
- Flow: `POST /api/v1/billing/intent { plan }` → backend returns a **payment reference** (unique memo)
  + treasury address + amount. User pays from their connected wallet. Backend **verifies on-chain**
  (watch treasury for a matching transfer/memo, confirm finality) → extends `vip_until`, writes a
  `payments` row with tx signature. A reconciler job catches delayed/unmatched payments.

### 7.3 Telegram Stars (bot)

Existing Stars flow continues; on `successful_payment` it extends the **same** `vip_until` on the user
(resolved via the Telegram identity). Auto-invite to the private channel and auto-remove on expiry stay.

### 7.4 Unified gating

VIP checks run in one `BillingService.isVip(userId)` used by both the API (web) and the bot. Expiry
sweeps disable autopilot and channel access regardless of how VIP was purchased.

---

## 8. Data model

### 8.1 New tables

- `users`, `user_identities` (§4.1)
- `auth_nonces` (address, nonce, expires_at) — or Redis
- `sessions` / refresh tokens (id, user_id, token_hash, expires_at, revoked_at)
- `payments` (user_id, rail['crypto'|'stars'], amount, currency, tx_sig/charge_id, status, created_at)
- `fees` (user_id, position_id, profit_lamports, fee_bps, fee_lamports, tx_sig, status, created_at)
- `audit_log` (user_id, actor, action, meta jsonb, created_at) — append-only
- `wallet_withdrawals` (user_id, to_address, lamports, tx_sig, status, created_at)

### 8.2 Changed tables

- `trading_wallets`, `trading_configs`, `positions`, `trades`, `subscriptions` →
  add `user_id uuid` (fk), backfill from existing `telegram_user_id`, then make `user_id` the key.

### 8.3 Keep

- `launch_candidates` and the scanner tables are unchanged (identity-agnostic).

### 8.4 Migration strategy (no downtime, bot stays live)

1. Create `users` + `user_identities`; backfill one user per distinct existing `telegram_user_id` and a
   telegram identity row. (Idempotent script.)
2. Add nullable `user_id` to the domain tables; backfill via the telegram map; add indexes.
3. Dual-read/dual-write period: services resolve a user by either key; new code writes `user_id`.
4. Once verified, make `user_id` NOT NULL and the primary lookup; retain `telegram_user_id` only on
   `user_identities`.
5. Each step is a reversible Drizzle migration; the bot keeps resolving its id → user throughout.

---

## 9. API design

- **Base:** `https://api.stackalpha.xyz/api/v1`. Versioned path. JSON only.
- **Auth:** Bearer access JWT; refresh via httpOnly cookie. Public endpoints need no auth.
- **Conventions:** consistent envelope `{ data } | { error: { code, message } }`; cursor pagination;
  idempotency keys on money-moving POSTs; strict input validation (Zod) + typed responses.
- **Security:** per-IP + per-user rate limits (Redis), CORS allowlist (stackalpha.xyz + previews),
  HMAC/nonce on sensitive actions, audit logging.

### 9.1 Surface (v1)

```
Public
  GET  /public/track-record | /public/calls | /public/top | /public/overview   (done)
Auth
  POST /auth/nonce · /auth/verify · /auth/refresh · /auth/logout
Account
  GET  /account/me               link status, vip_until
  POST /account/link/telegram    issue link token
  GET  /account/fees
Wallet
  GET  /wallet                   address + live balance
  POST /wallet/withdraw          { toAddress, amount }  (controls in §5.2)
Trading
  GET  /trading/config · PATCH /trading/config
  GET  /trading/positions · GET /trading/positions/:id
  GET  /trading/portfolio
Billing
  GET  /billing/plans
  POST /billing/intent           crypto payment reference
  GET  /billing/status
```

Mutations that move funds or change trading behavior require active VIP + fresh auth.

---

## 10. Web app (Next.js on Vercel)

- **Public (SEO, done):** landing, /calls, /pricing, /faq, sitemap/robots/OG/JSON-LD.
- **Auth:** Solana Wallet Adapter (Phantom, Solflare, Backpack) → SIWS → session.
- **App (`/app`, authed):**
  - Dashboard — VIP status, wallet balance, open positions, portfolio + fees.
  - Wallet — deposit (address/QR), withdraw (to connected wallet).
  - Autopilot — enable/disable, buy size, TP/SL/trail/moon-bag, slippage, caps.
  - Positions & history — live positions, closed trades, realized PnL and fees.
  - Billing — upgrade (crypto), VIP status; "Link Telegram".
- **Data:** all via `/api/v1` (server components for reads, route-handler proxies or client calls for
  authed actions). No DB access from the web.
- **State that must persist** (shared, durable) lives in the backend; browser storage only for UI prefs.

---

## 11. Telegram manager

The bot stays a first-class surface and an API client (in-process service calls):
- Posts calls + follow-ups to the VIP/public channels (scanner).
- Runs autopilot + fee collection for Telegram-linked users (shared engine).
- Stars billing → same entitlements.
- Account linking to/from the web.
No business logic unique to the bot; it renders the same core services.

---

## 12. Security & compliance

- **Custody:** KMS-wrapped keys, least-privilege signing module, audit log, withdrawal controls, hot-wallet
  balance monitoring + alerts.
- **App:** rate limiting, input validation, output encoding, CORS allowlist, secrets only in env/KMS
  (never committed), dependency scanning, signed webhooks.
- **Abuse:** per-user trade/withdraw caps, anomaly alerts (sudden drain, repeated failures).
- **Compliance posture:** custodial trading + crypto billing can trigger money-transmission/registration
  obligations depending on jurisdiction — operator decision; documented ToS, risk disclosures, and
  "not financial advice" throughout. (Flagged, not legal advice.)

---

## 13. Observability & ops

- **Logging:** structured (pino) with correlation ids; audit log for money movements.
- **Metrics:** trades/day, fill success rate, fee revenue, VIP MRR, scanner funnel, RPC/Jupiter error
  rates, wallet balances. Expose `/metrics` or push to a dashboard.
- **Alerts:** failed exits, stuck positions, low treasury/hot balances, kill-switch state, deploy health.
- **Runbooks:** key rotation, incident response, reconciliation, mass-exit ("panic sell all").

---

## 14. Infrastructure & deployment

- **Backend:** droplet, Docker Compose (app + redis), Neon Postgres, Caddy auto-TLS at
  `api.stackalpha.xyz`. CI/CD (GitHub Actions) builds, migrates, redeploys on push.
- **Web:** Vercel, root dir `web/`, env `API_URL=https://api.stackalpha.xyz`, auto-deploy on push.
- **DNS:** `stackalpha.xyz` → Vercel; `api.stackalpha.xyz` → droplet.
- **Secrets:** env today; KMS/secret-manager for the master key on the hardening path. Never committed.
- **Environments:** prod now; a staging slice (separate DB + bot token + treasury) recommended before
  touching live funds.

---

## 15. Testing strategy

- **Unit:** fee math, PnL, auth/SIWS verification, entitlement logic, config validation.
- **Integration:** API endpoints with a test DB; on-chain flows against **devnet** (wallets, swaps via
  Jupiter devnet or mocked, deposits/withdrawals, fee transfers).
- **E2E:** wallet-connect login → deposit (devnet) → enable autopilot → simulated call → buy → exit →
  fee → withdraw.
- **Safety gates:** no mainnet fund path ships without devnet E2E + a small real-SOL smoke test.

---

## 16. Phased delivery roadmap

Each phase ships independently and keeps production working.

- **P0 — Identity foundation.** `users`/`user_identities`, backfill from Telegram, add `user_id` to
  domain tables (dual-read/write), `UserService`. *Accept:* bot still trades; every telegram user has a
  canonical user.
- **P1 — Auth + API v1 skeleton.** SIWS (nonce/verify/refresh), JWT sessions, auth middleware, rate
  limiting, `/account/me`. *Accept:* wallet login issues a session; `/account/me` returns identity + VIP.
- **P2 — Web wallet-connect + read-only dashboard.** Wallet adapter, login, `/app` showing wallet
  balance, positions, portfolio (read endpoints). *Accept:* a user logs in with Phantom and sees their data.
- **P3 — Wallet system + deposit/withdraw.** Hardened wallet service, withdraw-to-connected-wallet with
  controls, audit log. *Accept:* deposit shown, withdrawal works on devnet with limits + audit rows.
- **P4 — Autopilot controls on web.** Config read/write endpoints + UI (enable/disable, TP/SL/trail/
  moon-bag/slippage/caps). *Accept:* toggling on web changes live behavior; parity with the bot.
- **P5 — Performance fees.** Treasury, fee engine on profitable close, `fees` ledger, reporting in API +
  UI. *Accept:* a devnet profitable close transfers the correct fee and records it.
- **P6 — Billing (crypto + Stars unified).** Crypto intent + on-chain verify + reconciler; unify with
  Stars on one `vip_until`. *Accept:* paying either way grants VIP across web + bot.
- **P7 — Telegram ↔ wallet linking.** Link flows both directions; merged entitlements. *Accept:* one
  account usable on both surfaces.
- **P8 — Hardening & launch.** KMS keys, observability/alerts, rate-limit tuning, security review,
  staging, docs, ToS/disclosures, `api.stackalpha.xyz` TLS. *Accept:* security checklist green; prod live.

Suggested first build target after sign-off: **P0 + P1** (the backbone), then **P2** so there's a visible
wallet-login dashboard.

---

## 17. Open decisions to confirm

**Resolved:** fee = **1% of realized profit** · wallet = **app-created, exportable trading wallet**
(seed + key shown once, encrypted copy held for automation + fee) · login = **connect external Phantom
(SIWS)**, identity wallet ≠ trading wallet · autopilot = **open to all funded users** (VIP sells premium
calls, not autopilot) · identity = **unified, linkable** (wallet + Telegram) · billing = **crypto + Stars**.

Remaining — I'll proceed with these **defaults** unless you say otherwise:

1. **Fee settlement** → accrue in the `fees` ledger at each profitable close + **periodic sweep** to
   treasury (gas-cheaper than a transfer per close).
2. **VIP crypto price** → fixed SOL amount shown in USD terms (e.g. ~$X), configurable; confirm the number.
3. **Withdrawal policy** → withdraw to **any** address, with the connected Phantom pre-filled as the default
   destination, a per-day cap, and a confirmation step for large amounts.
4. **Key custody tier** → ship P-phases on the current AES-GCM master key; add **KMS envelope encryption in
   P8** before scaling funds.
5. **Staging** → stand up a **devnet** slice before P3 (deposit/withdraw/fees tested on devnet first).
6. **Wallet import** → yes, support **import existing wallet** (paste seed/private key) alongside Create
   Wallet.
7. **Wallet adapters** → Phantom + Solflare + Backpack for login.
```
