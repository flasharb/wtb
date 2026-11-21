# Module: web (Next.js app — feature modules + shared UI kit)

> Phase **P2+** · Depends on: the backend API (`/api/v1`) · Extends existing `web/` (public site done) · Owner: flasharb

## 1. Purpose & responsibilities
The user-facing app on Vercel: public SEO pages (done) + the authenticated `/app` dashboard. Wallet-connect
login (SIWS), then wallet/autopilot/positions/billing — all via the backend API. **No DB access.** Built
from **feature modules** that compose a **shared UI kit**.

## 2. Out of scope
Business logic, signing, DB — all backend. The web only connects the identity wallet (Phantom) for login
and renders API data.

## 3. Folder & files
```
web/
  app/                      routes (thin; compose features)
    (marketing) /, /calls, /pricing, /faq           [done]
    /app, /app/wallet, /app/positions, /app/billing, /app/settings
  modules/
    auth/        WalletButton wiring, SIWS flow, useSession
    account/     linking (telegram), profile summary
    wallet/      create/import/deposit/withdraw/export UI + hooks
    autopilot/   config form (enable, sizes, TP/SL/trail/moonbag/slippage/caps)
    positions/   open positions, history, portfolio, fees
    billing/     plans, crypto upgrade, VIP status
    calls/       public track record (exists, move here)
  components/ui/            shared kit (see §5)
  lib/          apiClient.ts, auth.ts (session), wallet.ts (adapter), format.ts, cn.ts
```

## 4. Tech
Next.js 14 (App Router) · React 18 · Tailwind · `@solana/wallet-adapter-react` (+ Phantom/Solflare/Backpack)
· `@solana/web3.js` (client, read-only) · `tweetnacl`/adapter for message signing. SSR for public SEO;
authed `/app` is client-rendered behind the session.

## 5. Shared UI kit (`web/components/ui/`) — specs
Each is a typed, themed, mobile-first component (dark-first, brand purple/gold). Minimum props:
- `Button({ variant:'primary'|'gold'|'ghost'|'danger', size:'sm'|'md'|'lg', loading, leftIcon, disabled })`
- `Field({ label, hint, error, required, children })` · `Input` · `NumberField({ min,max,step,unit })`
  · `PercentField` · `AmountField({ token:'SOL'|'USDC', max, onMax })` · `Select` · `Toggle` · `Slider`
- `Modal({ open, onClose, title, footer })` · `Drawer` (mobile sheet) · `ConfirmDialog` · `Toast`/`useToast`
- `Card` · `Panel` · `StatTile({ label, value, sub })` · `Badge` · `Alert({ tone })` · `Tabs` · `Table`
  · `EmptyState` · `Skeleton` · `Spinner`
- Web3: `WalletButton` · `AddressChip({ address, copy, explorer })` · `CopyButton` · `QRCode` · `TxLink`
  · `MultiplePill({ x })` · `PnLText({ sol })` · `SeedPhraseReveal({ words, onConfirmedSaved })`
- Hooks: `useToast`, `useDisclosure`, `useClipboard`, `useSession`, `useWallet`, `useMediaQuery`
- Lib: `apiClient` (adds Bearer, maps `{error}`→throw), `format` (usd/mult/sol/timeAgo/shortAddr), `cn`

## 6. Feature modules — API consumption
Each feature has `<f>.api.ts` (typed calls), `<f>.hooks.ts` (SWR/React Query), `<f>.types.ts` (mirror DTOs):
- **auth**: `POST /auth/nonce` → wallet signs → `POST /auth/verify` → store session; `useSession` guards `/app`.
- **account**: `GET /account/me`; `POST /account/link/telegram` → show deep link.
- **wallet**: `POST /wallet/create` (show `SeedPhraseReveal` once) · `POST /wallet/import` · `GET /wallet`
  · `POST /wallet/withdraw` (freshAuth modal) · `POST /wallet/export` (freshAuth).
- **autopilot**: `GET/PATCH /trading/config` (form with NumberField/PercentField/Toggle/Slider).
- **positions**: `GET /trading/positions`, `/positions/:id`, `/portfolio`, `/account/fees`.
- **billing**: `GET /billing/plans`, `POST /billing/intent` (pay → `POST /billing/confirm`), `GET /billing/status`.

## 7. Pages & flows
- **/app (dashboard):** VIP status, wallet balance, open positions, portfolio+fees; CTAs.
- **Login flow:** Connect wallet → sign message → session → redirect `/app`.
- **Create wallet flow:** Create → `SeedPhraseReveal` (blur, reveal-to-copy, "I saved it" required) → funded.
- **Deposit:** show `AddressChip` + `QRCode` + live balance.
- **Withdraw:** `AmountField` (max) + destination (Phantom pre-filled) → fresh-auth confirm → `TxLink`.
- **Autopilot:** toggle + form; optimistic update; validation mirrors backend Zod bounds.
- **Upgrade:** plans → crypto intent (pay) or deep-link to bot Stars → status refresh.

## 8. SEO/perf
Public pages SSR with metadata/OG/JSON-LD (done). `/app` is `noindex`. Keep shared JS lean; code-split the
wallet adapter so marketing pages don't ship it.

## 9. Security
Access token in memory; refresh via httpOnly cookie. Never hold private keys in the browser (keys live on
the backend). Fresh-auth gate for withdraw/export. CSP + the existing security headers.

## 10. Env
`API_URL` (server), `NEXT_PUBLIC_API_URL` (client authed calls), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BOT_URL`,
`NEXT_PUBLIC_FREE_CHANNEL_URL`, `NEXT_PUBLIC_SOLANA_RPC` (read-only), `NEXT_PUBLIC_SUB_PRICE_STARS`, `_SUB_DAYS`.

## 11. Testing
Component tests for the kit; flow tests (login, create wallet, withdraw) against a mocked API; devnet manual E2E.

## 12. Tasks — A→Z
- [ ] a. Build the shared UI kit (`components/ui/*`) + `lib` (apiClient, auth, wallet, format, cn).
- [ ] b. Wallet adapter provider + `WalletButton` + SIWS `auth` module → session.
- [ ] c. `/app` shell + dashboard (read endpoints).
- [ ] d. wallet module (create/import/deposit/withdraw/export) with fresh-auth modals.
- [ ] e. autopilot config form; positions/portfolio/fees views.
- [ ] f. billing (plans/intent/confirm) + link-telegram.
- [ ] g. noindex `/app`, code-split adapter, tests.

## 13. Acceptance criteria
- A user connects Phantom, signs in, creates a wallet (sees the seed once), funds it, enables autopilot,
  sees positions/portfolio/fees, upgrades VIP, and withdraws — all through the API, mobile-first.
- Public SEO pages unchanged; `/app` not indexed; no private key ever in the browser.
