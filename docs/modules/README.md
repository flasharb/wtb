# Stack Alpha — Modular Monolith Blueprint

> Companion to [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Defines how the codebase is organized into
> modules, the conventions every module follows, the shared layers (backend `core` + web UI kit), and
> links to the per-module A→Z plan documents.

---

## 1. Why a modular monolith

One process to deploy and operate, but internally split into **independent, replaceable modules** with
hard boundaries. We get the simplicity/latency of a monolith (the Telegram bot and API call services
in-process) with the clarity of services. Any module could later be extracted to its own process with
minimal change because it already talks to others only through **service interfaces** and the **event bus**.

**Hard rules**
- A module touches **only its own tables**, via its own `*.repo.ts`. Cross-module data goes through the
  other module's **service**, never its repo or raw tables.
- Dependencies flow **downward**: feature modules → `core`. No cycles. `market` and `notifications` are
  shared downstream deps; they never import a feature module.
- Controllers are thin (validate + delegate). Business logic lives in services. DB lives in repos.
- Everything crossing a boundary is a **typed DTO** validated with **Zod**.

---

## 2. Backend module anatomy

```
modules/<name>/
  <name>.types.ts        domain types, request/response DTOs, Zod schemas, event payloads
  <name>.repo.ts         Drizzle data access — ONLY place that reads/writes this module's tables
  <name>.service.ts      business logic; the module's public API to other modules + the bot
  <name>.controller.ts   HTTP handlers: parse → validate → call service → envelope response
  <name>.routes.ts       registerRoutes(app): maps method+path → controller, attaches guards
  <name>.events.ts       (optional) event names + payload types emitted/consumed
  <name>.service.test.ts unit tests for the service
  index.ts               public exports: { service, registerRoutes }
```

- **Service** is the seam. Other modules import `wallet.service`, not `wallet.repo`.
- **Routes** are mounted by `app.ts` under the module's base path (e.g. `/api/v1/wallet`).
- A module with no HTTP surface (e.g. `market`) omits controller/routes.

---

## 3. The shared foundation — `modules/core`

Not a feature; the only thing every module may import.

| File | Provides |
|---|---|
| `config.ts` | Zod-validated env (extends the current `src/config`) |
| `db.ts` | Drizzle client + pg pool (Neon) |
| `redis.ts` | ioredis client (nonces, rate limits, caches) |
| `logger.ts` | pino structured logger + request correlation ids |
| `errors.ts` | `AppError` + typed error codes (see §6) |
| `http.ts` | response envelope, pagination, async handler wrapper |
| `events.ts` | in-process typed event bus (emit/on) — see §5 |
| `crypto.ts` | AES-256-GCM / envelope encryption helpers (keyvault lives in `wallet`) |
| `ids.ts` | uuid, nanoid, idempotency keys |
| `guards.ts` | Fastify preHandlers: `requireAuth`, `requireVip`, `rateLimit` |

---

## 4. Event bus (in-process)

Modules emit domain events; others subscribe. Decouples side effects (e.g. notifications, fees) from the
core flow. Typed via a central `AppEvents` map.

| Event | Emitted by | Consumed by |
|---|---|---|
| `call.alerted` | scanner | trading (auto-buy), notifications (post) |
| `position.opened` | trading | notifications (DM), analytics |
| `position.closed` | trading | fees (assess), notifications (DM) |
| `fee.collected` | fees | notifications, analytics |
| `payment.confirmed` | billing | identity/entitlements, notifications |
| `vip.changed` | billing | notifications, trading (channel access) |
| `wallet.created` | wallet | notifications |
| `user.linked` | identity | notifications |

Events are best-effort within the process; anything that must be durable also writes a DB row (ledgers).

---

## 5. Web structure — feature modules + shared UI kit

```
web/
  modules/<feature>/
    components/      feature-specific components
    <feature>.api.ts   typed client for the backend endpoints this feature uses
    <feature>.hooks.ts React hooks (data fetching, mutations)
    <feature>.types.ts types mirrored from the backend DTOs
  components/ui/      SHARED kit (below)
  lib/               api base client, auth/session, wallet adapter, format, cn()
  app/               Next.js routes (thin — compose feature modules)
```

### 5.1 Shared UI kit — `web/components/ui/`

Built once, used everywhere; themed via design tokens (purple/gold brand, dark-first, mobile-first).

- **Primitives:** `Button` (variants: primary/gold/ghost/danger, sizes, loading), `IconButton`,
  `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`/`Switch`, `Slider`, `Label`.
- **Form:** `Field` (label + control + error + hint), `FormRow`, `FormError`, `NumberField`
  (with min/max/step + unit), `PercentField`, `AmountField` (SOL/USDC with max button).
- **Overlays:** `Modal`, `Drawer`/`Sheet` (mobile bottom-sheet), `Tooltip`, `Popover`,
  `ConfirmDialog`, `Toast`/`toaster`.
- **Surfaces:** `Card`, `Panel`, `Stat`/`StatTile`, `Badge`/`Chip`, `Alert`/`Callout`, `Divider`,
  `Tabs`, `Table` (+ `EmptyState`), `Skeleton`, `Spinner`, `ProgressBar`.
- **Web3/domain:** `WalletButton` (connect/disconnect), `AddressChip` (copy + explorer link),
  `CopyButton`, `QRCode`, `TokenAvatar`, `MultiplePill`, `PnLText`, `SeedPhraseReveal`
  (blurred, reveal-to-copy, confirm-saved), `TxLink`.
- **Hooks:** `useToast`, `useDisclosure` (modal state), `useClipboard`, `useInterval`,
  `useMediaQuery`, `useSession`, `useWallet`.
- **Lib:** `cn()` (class merge), `apiClient` (fetch + auth header + error mapping), `format` (usd,
  mult, sol, timeAgo, shortAddr), `tokens.ts` (colors/space/radii).

Rule: feature modules compose the shared kit; they do not restyle primitives inline. New shared pieces
are added to the kit, not duplicated per feature.

---

## 6. Global conventions

- **Errors:** throw `AppError(code, message, httpStatus, meta?)`. Codes are stable enums
  (`AUTH_REQUIRED`, `VIP_REQUIRED`, `INSUFFICIENT_BALANCE`, `WALLET_LOCKED`, `VALIDATION`, `NOT_FOUND`,
  `RATE_LIMITED`, `CONFLICT`, `UPSTREAM`, `INTERNAL`). A global error handler maps to the response envelope.
- **Responses:** success `{ data }`, error `{ error: { code, message, details? } }`. Lists use
  `{ data, page: { cursor, hasMore } }`.
- **Validation:** every input parsed by a Zod schema in `*.types.ts`; reject with `VALIDATION`.
- **Auth:** `requireAuth` sets `req.user`. `requireVip` checks entitlement. Money-moving routes also
  require a fresh-auth window + idempotency key.
- **Config:** all tunables via env (Zod-validated in `core/config`); no magic numbers in logic.
- **Logging/audit:** structured logs with correlation id; money movements also write `audit_log`.
- **Testing:** service unit tests (pure logic), controller/route integration tests (test DB),
  on-chain flows on **devnet**; no mainnet fund path merges without devnet E2E.
- **Migrations:** Drizzle, additive + reversible; one migration per PR; dual read/write during the
  identity cutover.

---

## 7. Module registry

| Module | Phase | Depends on | HTTP | Status |
|---|---|---|---|---|
| [core](./core.md) | P0 | — | no | partially exists (config/db) |
| [identity](./identity.md) | P0 | core | yes | new |
| [auth](./auth.md) | P1 | core, identity | yes | new |
| [wallet](./wallet.md) | P2–P3 | core, identity | yes | refactor of `src/trading/wallet` |
| [market](./market.md) | exists | core | no | refactor of `src/providers` |
| [scanner](./scanner.md) | exists | core, market, notifications | yes (public) | refactor of `src/jobs/scan-launches` + `src/api` |
| [trading](./trading.md) | P4 | core, wallet, market, identity | yes | refactor of `src/trading` |
| [fees](./fees.md) | P5 | core, wallet, trading | yes | new |
| [billing](./billing.md) | P6 | core, identity, wallet | yes | refactor of `src/bot/billing` |
| [notifications](./notifications.md) | exists | core, identity | n/a | refactor of `src/bot` |
| [web](./web.md) | P2+ | API | — | Next.js feature modules + UI kit |

---

## 8. Per-module plan template

Every `docs/modules/<name>.md` follows this outline (A→Z):

```
# Module: <name>
> Phase · Depends on · Replaces/new · Owner
1. Purpose & responsibilities
2. Out of scope / non-goals
3. Folder & files
4. Data model (tables, columns, migrations)
5. Types & DTOs (interfaces + Zod schemas)
6. Service API (method signatures → behavior)
7. HTTP API (method, path, auth, request, response, errors)
8. Events (emitted / consumed)
9. Dependencies (modules + external)
10. Security & validation
11. Observability (logs, metrics, audit)
12. Testing (unit / integration / e2e)
13. Tasks — A→Z checklist
14. Acceptance criteria
```

---

## 9. Build contract — read before building any module

This section carries the shared detail so a module doc doesn't repeat it. An agent should be able to pick
a module doc + this section and build with no further questions.

### 9.1 Stack & versions (pin these)
Backend (Node 20, ESM/NodeNext, tsx, Fastify 5, Drizzle 0.39, pg 8, grammY 1.35, zod 3, ioredis 5,
`@solana/web3.js` 1.98.4 — all already present). **New deps to add:**
`bip39@3.1.0`, `ed25519-hd-key@1.3.0`, `tweetnacl@1.0.3` (ed25519 verify), `jose@5.9.6` (JWT),
`@fastify/cookie@11`, `@fastify/cors@10`, `@fastify/rate-limit@10`.
Web (Next 14.2.23, React 18.3.1, Tailwind 3.4 — present). **New:** `@solana/wallet-adapter-react`,
`@solana/wallet-adapter-react-ui`, `@solana/wallet-adapter-wallets`, `@solana/web3.js`, `tweetnacl`,
`@tanstack/react-query@5`, `qrcode.react@4`.

### 9.2 Environment registry (new/changed vars → `.env.example` + `core/config`)
| Var | Module | Default | Notes |
|---|---|---|---|
| `AUTH_JWT_SECRET` | auth | — (required) | HS256 signing key |
| `AUTH_ACCESS_TTL_SEC` | auth | 900 | access JWT TTL |
| `AUTH_REFRESH_TTL_DAYS` | auth | 30 | refresh TTL |
| `SIWS_DOMAIN` | auth | stackalpha.xyz | message domain binding |
| `CORS_ORIGINS` | core | https://stackalpha.xyz | comma list (+ Vercel previews) |
| `RATE_LIMIT_MAX` / `_WINDOW_SEC` | core | 120 / 60 | default bucket |
| `WALLET_ENCRYPTION_KEY` | wallet | — (required for funds) | 64-hex; **exists** |
| `WALLET_DAILY_WITHDRAW_SOL` | wallet | 50 | per-user cap |
| `PERF_FEE_BPS` | fees | 100 | 1% of profit |
| `FEE_TREASURY_ADDRESS` | fees | — (required) | fee destination |
| `FEE_MIN_LAMPORTS` | fees | 50000 | skip dust |
| `FEE_SWEEP_MODE` | fees | accrue | `accrue`\|`immediate` |
| `VIP_PRICE_SOL` | billing | — | crypto VIP price |
| `BILLING_TREASURY_ADDRESS` | billing | — | VIP payment destination |
| `SUB_PRICE_STARS` / `SUB_DAYS` | billing | 1000 / 30 | **exist** |
| `TRADING_ENABLED`, `TRADE_*` | trading | — | **exist** (see `src/config`) |
| `HELIUS_API_KEY`, `BIRD_EYE_KEY`, `JUPITER_API_URL` | market | — | **exist** |
| `SOLANA_CLUSTER` | core | mainnet | `devnet` for staging |

### 9.3 Existing code → target module (what to move/reuse, not rewrite)
| Existing | Goes to | Action |
|---|---|---|
| `src/config/index.ts` | `core/config` | extend (keep back-compat export) |
| `src/db/*` | `core/db` | move |
| `src/providers/*`, `src/trading/jupiter.ts` | `market` | move + unify |
| `src/trading/{wallet,crypto,solana}.ts` | `wallet` | move + add BIP39 |
| `src/trading/{engine,store}.ts` | `trading` | move, re-key to `user_id` |
| `src/jobs/scan-launches.ts`, `src/api/*` | `scanner` | move; swap broadcast→events |
| `src/bot/*` | `notifications` | move; commands call services |
| `src/bot/billing.ts` | `billing` | move + add crypto rail |
| `web/app/*` public, `web/lib/*` | `web/modules/calls` + `marketing` | keep (done) |

### 9.4 Build order (dependency-safe)
`core` → `identity` (+backfill) → `auth` → `market` (refactor) → `wallet` → `scanner` (refactor+events)
→ `trading` (refactor, re-key) → `fees` → `billing` → `notifications` (refactor) → `web` features.
The live bot keeps running throughout; each step is a reversible migration + PR.

### 9.5 Migration protocol (identity cutover)
For every table re-keyed to `user_id`: (1) add nullable `user_id`; (2) backfill from the telegram→user
map; (3) dual read/write (resolve by either key); (4) verify; (5) make `user_id` the key, keep
`telegram_user_id` only on `user_identities`. Never drop the telegram path until the bot reads `user_id`.

### 9.6 Definition of Done (per module)
- [ ] `pnpm lint` (tsc) clean; `pnpm test` green (unit + integration).
- [ ] Migrations additive **and** reversible; dual read/write where applicable; **bot still trades**.
- [ ] New env in `.env.example` + validated in `core/config`; no secret ever logged.
- [ ] Fund-moving paths tested on **devnet** (E2E) before mainnet.
- [ ] Only the module's repo touches its tables; other modules used via service/events.
- [ ] Acceptance criteria in the module doc met; endpoints return the standard envelope.

### 9.7 Verify
`pnpm lint` · `pnpm test` · run API locally (buildServer only, **not** the bot — avoids a second
long-poll conflicting with prod) and `curl /api/v1/...` · devnet for wallet/trade/fee flows
(`SOLANA_CLUSTER=devnet`). Never start a second mainnet bot instance against the live token.
