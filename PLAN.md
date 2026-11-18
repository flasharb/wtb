# Whale Buy Tracker — Build Plan (v2)

> Telegram bot that watches curated whale wallets on Solana + Ethereum, detects **buys**,
> and alerts you so you can evaluate buying too. Alerts only — no trading, no keys, no custody.
> Every alert ends with: *"Not financial advice. Whale buys can be bait. Verify before acting."*

This is the working spec. It supersedes the original build prompt where they conflict, and the
reasons for each change are called out inline. Last updated 2026-11-18.

---

## 0. What changed from the original prompt and why (read this first)

I verified the provider facts before touching code. The important deltas:

| Area | Original assumption | Reality (Nov 2026) | Consequence |
|---|---|---|---|
| **Helius product** | Enhanced Transaction Webhooks | Enhanced Txns now in **maintenance mode**; **Parsed Streams** is GA on all plans incl. Free, billed **1 credit / delivered event**. Webhook/stream create-edit-delete = 100 credits. | Build on Parsed Streams, not the legacy webhook. Architecture note below — it may be a persistent stream, not a plain HTTP push. |
| **Helius free plan** | 1M credits, 1 webhook | Confirmed ~1M credits/mo. Webhook count on free is contested (official says **1**). | 1 stream/filter holding the Solana list is enough. Must confirm in dashboard. |
| **Alchemy free tier** | "free tier allows 5 webhooks" (implied generous) | **30M compute units/month, HARD CAP, no overage.** 5 webhooks, 100k addr/webhook. Address Activity ≈ 40 CU/event + any receipt fetch. | **This is the binding constraint of the whole project.** 1,000 active ETH whales will blow 30M CU. See §2 cost math. |
| **BigQuery Solana** | `crypto_solana_mainnet_us`, weekly seeding | Dataset **stalled Mar–Nov 2025**, community-maintained "as-is", lags several days, DEX-swap parsing is painful. | Demote BigQuery to **secondary** for Solana. Primary Solana seeding = curated list + on-chain verification. ETH BigQuery is fine. |
| **GoPlus security** | GoPlus or Honeypot.is, "verify availability" | GoPlus free, **no API key**, `api.gopluslabs.io/api/v1`, covers EVM honeypot/tax **and** Solana token security. Static analysis only. | Use GoPlus for both chains' safety checks. Pair with a sim check for EVM honeypots. |
| **Scoring cold start** | Quality score drives a "high-conviction single whale (≥80)" signal | Scores need recorded outcomes to exist. At launch **everything sits at 50** for weeks. | High-conviction single-whale signal can't fire at launch. Needs a seeded prior + a cold-start plan (§5). |

**Net:** the Solana side is feasible on free. The **Ethereum side is not feasible at 1,000 wallets on
Alchemy's free tier** — it needs either a much smaller list (~200–300, well-filtered) or a few dollars/month
of pay-as-you-go. This is the main decision I need from you (see §2 and the open questions at the end).

Sources: [Helius Parsed Streams](https://www.helius.dev/docs/parsed-streams) ·
[Helius credits](https://www.helius.dev/docs/billing/credits) ·
[Helius plans](https://www.helius.dev/docs/billing/plans) ·
[Alchemy pricing 2026](https://markaicode.com/pricing/alchemy-pricing/) ·
[BigQuery Solana stall thread](https://discuss.google.dev/t/public-solana-bigquery-dataset-crypto-solana-mainnet-us-stopped-updating-on-march-31-2025/185629) ·
[GoPlus docs](https://docs.gopluslabs.io/).

---

## 1. Guiding principles

- **Ship Solana first.** Helius on free is solid and the credit math works. Get the full loop
  (seed → ingest → classify → signal → alert → outcome) working end-to-end on Solana, *then* add
  Ethereum. This de-risks the hard part (ETH cost) without blocking a usable product.
- **Trust is the product.** The bot's job is to help *you decide*. That means: every alert shows its
  reasoning and safety checks, and the bot is honest about its own track record (outcome follow-ups,
  `/performance`, a paper-trading view). A bot that cries wolf gets muted in a day.
- **Config-driven scale.** `MVP_WALLET_CAP` and all thresholds are env/DB config. Raising the cap later
  is a config + plan-upgrade change, not a rewrite.
- **Never spend silently.** Credit/CU guards, projections, and auto-trim with notification. No surprise bills.
- **Simple stack.** One service + Postgres + Redis. No Kafka/K8s/microservices.

---

## 2. Feasibility & cost (the honest numbers)

### Solana (Helius free) — FEASIBLE
- Budget: ~1,000,000 credits/mo, 1 credit per delivered swap event. Stream edits (~weekly) ≈ 100 credits each → negligible.
- Usable swap events/month ≈ 950k after overhead → ~31,000 swap events/day.
- Selection ceiling `MAX_SWAPS_PER_DAY` must be enforced on the **30-day average**, not peak.
- Realistic active whale averages ~5–15 DEX swaps/day. Scenarios at 1,000 wallets:
  - 8 avg → 240k credits/mo ✅ huge headroom
  - 15 avg → 450k/mo ✅ comfortable
  - 25 avg → 750k/mo ⚠️ tight, guard should warn
- **Recommendation:** start at **MVP_WALLET_CAP = 600–700 Solana wallets**, measure real swap rates for
  2 weeks via `usage_daily`, then raise toward 1,000 if the projection stays < 70%. The credit guard
  (§8) makes this safe to tune live.

### Ethereum (Alchemy free) — NOT feasible at 1,000 wallets
- Budget: **30M CU/month, hard cap.** ≈ 1M CU/day.
- Cost per event ≈ 40 CU just for webhook delivery, plus classification. **Big catch:** whale wallets
  receive heavy **inbound spam/airdrop token transfers**. Every one is an Address Activity event.
- Even at ~40 CU/event with zero extra fetches: 1M CU/day ÷ 40 ≈ 25,000 events/day total. Active ETH
  whales routinely see >25 transfer events each **per day** once spam is counted → 1,000 wallets would
  need **3–6× the free cap**.
- **Mitigations baked into the plan:**
  1. **Classify from the webhook payload first.** Alchemy's Address Activity payload already includes the
     per-tx transfer list (asset, value, from/to). If the watched wallet shows no quote-asset outflow in
     the same tx, it's not a buy — **drop it with zero extra RPC calls.** Only fetch a receipt when the
     payload is genuinely ambiguous (internal transfers / router nesting).
  2. **Spam-token denylist + heuristics** (no price, no liquidity, airdrop pattern) to discard inbound-only noise early.
  3. **Smaller, tighter ETH list.** 200–300 wallets with a hard average-activity ceiling.
- **Recommendation (needs your call):**
  - **Option A — ETH on free, small list:** cap ETH at ~250 wallets, aggressive filtering. $0 but partial coverage.
  - **Option B — ETH pay-as-you-go:** keep 500–1,000, accept ~$3–10/mo at Alchemy's ~$0.52/1M CU. Cheap, full coverage.
  - **Option C — Solana-only for MVP**, add ETH in a later phase once the loop is proven. Lowest risk, fastest to value.

### Rest of the stack (monthly)
| Item | Cheapest viable | Notes |
|---|---|---|
| Hosting | **DigitalOcean droplet ~$6–12** | Ubuntu droplet, Docker Compose: Node service + Postgres + Redis in 1–2 GB RAM. |
| Postgres + Redis | $0 self-hosted on the VPS, or ~$0 free tiers | Managed adds ~$5–15 if you want backups handled. |
| Helius | **$0** (free) | Upgrade path: Developer $49/mo / 10M credits if cap is raised. |
| Alchemy | **$0** (Option A/C) or **~$3–10** (Option B) | Hard cap on free = safe; PAYG needs a billing alert set. |
| Market data (DexScreener/GeckoTerminal) | **$0** | Public APIs, respect rate limits + cache. |
| GoPlus security | **$0** | No key, free tier. |
| Dune | **$0 / skipped** | Optional, behind source interface. Not required. |
| **Total MVP** | **~$5–7/mo** (Solana-only) to **~$10–17/mo** (both chains, ETH PAYG) | |

---

## 3. Product behavior (improved UX)

### 3.1 Onboarding — 3 taps, not a settings dump
`/start` runs a short wizard instead of printing a wall of commands:
1. **Pick chains** → `[ Solana ]  [ Ethereum ]  [ Both ]`
2. **Pick a preset** (so nobody has to understand `min_buy_usd` on day one):
   - 🛡️ **Conservative** — ≥4 whales, ≥$10k buys, ≥$100k liquidity, passes all safety, no tokens < 2h old.
   - ⚖️ **Balanced** (default) — ≥3 whales, ≥$5k buys, ≥$50k liquidity, standard safety.
   - 🎲 **Degen** — ≥2 whales OR 1 high-score whale, ≥$2k buys, ≥$20k liquidity, new-token mode on, warns instead of suppressing.
   - 🔧 **Custom** — opens the detailed `/settings` menu.
3. **Send a sample alert immediately** so the user sees exactly what to expect, then "You're set. I'll ping you when whales move."

Presets write concrete values into the `chats` row; `/settings` still lets power users tune every field.
Non-allowlisted users (`ADMIN_TELEGRAM_IDS`) get a friendly "this is a private beta" message.

### 3.2 Commands
- `/start` — onboarding wizard + help.
- `/chains sol eth` — choose chains.
- `/settings` — inline menu: preset switch, min buy USD, min whales, window hours, min liquidity, new-token mode, digest mode, quiet hours.
- `/recent [n]` — last n whale buys (default 10).
- `/top` — tokens with most distinct whale buyers in last 24h.
- `/wallet <address>` — label, chain, recent buys, quality score, its best/worst past calls.
- `/token <address>` — on-demand: who bought, when, current facts + safety. (new — serves "evaluate before buying")
- `/watch <address>` / `/watchlist` / `/unwatch` — track a specific token's whale activity even below signal threshold. (new)
- `/performance` — median/mean % change at +1h/+24h/+7d, win rate, and a "if you'd bought every alert" paper-PnL. (expanded)
- `/leaderboard` — best-performing whales by recorded outcomes. (new)
- `/digest on|off` — switch from real-time pings to a once-daily summary. (new)
- `/snooze 1h|8h|morning` and `/mute` / `/unmute` — graduated quiet, not just on/off. (expanded)
- `/status` — admin: wallets/chain, events last hour, queue depth, last webhook per provider, credits/CU used + projected.
- `/admin` — allowlisted: force-include/exclude a wallet, reload lists, trigger reseed, send test alert.

### 3.3 Alert format — scannable on a phone, with a verdict line
```
🟢 STRONG BUY SIGNAL · Solana
$WIF — dogwifhat

4 whales bought in 3h · $82k total
Safety: ✅ all checks pass

Mint: EKpQGSJtjMFqKZ9KQ... (tap to copy)
Price $2.41 · FDV $2.4B · Liq $48M · Vol24h $310M · Age 14mo

Buyers:
• Cupsey (score 88) — $31k
• 7xKX…9fma (score 74) — $22k
• Orca-whale-3 (score 69) — $18k
• 2 more…

Checks:
✅ Mint & freeze authority revoked
✅ Liquidity $48M (> $50k floor? ✅)
⚠️ Top-10 hold 31% of supply

[ 📈 DexScreener ] [ 🔎 Solscan ]
[ 👤 Biggest buyer ] [ 👍 Good ] [ 👎 Meh ]
[ 🔕 Mute token ] [ ⭐ Watch ] [ ❓ Why? ]

Not financial advice. Whale buys can be bait. Verify before acting.
```
- **Top verdict line** (🟢 STRONG / 🟡 MIXED / consensus vs high-conviction) so the decision reads in one glance.
- **Live update, not re-send:** when more whales join, edit the message ("🔥 now 6 whales, $140k") per §5.
- **Feedback buttons** (`👍 / 👎 / 🔕 / ⭐`) — tune the user's personal filtering and feed a lightweight signal into scoring.
- **"❓ Why?"** expands the exact rule that fired.
- **Opt-in outcome follow-up:** when +24h outcome is measured, optionally reply in-thread
  ("⏱ +24h on $WIF: **+32%**") so the bot's track record builds visibly. Off by default to avoid spam; toggle in `/settings`.
- **No "buy now" buttons. Ever.**

### 3.4 Watchdog & liveness
- If no webhook/stream event from a provider for > 30 min, alert the admin in Telegram (silent failure is the #1 risk).
- Optional "still here, quiet day: N signals" heartbeat so silence never looks like a crash.

---

## 4. Buy detection (unchanged logic, hardened)

A **buy** of token T by wallet W in one tx when, net within that tx:
- W's balance of T increases (T not a stablecoin / native / wrapped-native / LP token), AND
- W's balance of a quote asset (native, wrapped native, USDC/USDT/DAI…) decreases, AND
- quote outflow in USD ≥ `MIN_BUY_USD` (default 5,000). Value from the **quote side** (more reliable).

Ignore: inbound-only transfers (airdrops/withdrawals/wallet moves), mint/LP events, and
already-held-at-similar-size (flag "add to position", don't alert as new buy).

- **Solana:** Helius Parsed Streams `SWAP` event (Jupiter/Raydium/Orca/Meteora/Pump.fun); verify with pre/post token balances.
- **Ethereum:** compute net per-asset flow from the Address Activity payload's transfer list first; fetch receipt
  only when ambiguous (§2 cost mitigation). Dedupe `(txHash, logIndex)`; handle reorg re-sends.

Classifiers are **pure functions**, unit-tested with **≥10 real fixture txs per chain** (swap, multi-hop,
aggregator route, plain transfer, airdrop, LP add, bridge, failed tx, spam-token inbound, add-to-position).

---

## 5. Signals (configurable per chat)

- **Consensus:** ≥ `MIN_WHALES` (default 3) distinct whales buy the same token within `WINDOW_HOURS` (default 6).
  Alert once, then **edit** the message as more join.
- **High-conviction single:** one whale, score ≥ 80, buy ≥ `HIGH_CONVICTION_USD` (default 50k).
- **Cooldown:** same token ≤ once / 12h / chat, unless whale count doubles.
- Hard-fail safety (§6) suppresses the alert.

### Scoring cold start (new — the original plan can't fire high-conviction at launch)
- Score 0–100, documented in `docs/scoring.md`. Formula = weighted win-rate + median return at +24h/+7d,
  **shrunk toward 50** when < 10 recorded buys.
- **Seed a prior at selection time** from BigQuery/on-chain signals we already compute: distinct tokens traded,
  holding-period profile, and a realized-PnL proxy if available. New wallets start near their prior, not a flat 50.
- Until a wallet has ≥ `MIN_SCORED_BUYS` (default 8) real outcomes, **it can contribute to consensus but
  cannot trigger a solo high-conviction alert.** Documented so you know why solo alerts are quiet early on.
- Recompute nightly; keep history for inspection. Optional 30-day backfill for the top 500 wallets only —
  **costs credits, so ask before running** (`pnpm backfill:scores --top 500 --confirm`).

---

## 6. Safety checks (on every alert)

- **Solana (GoPlus Solana + on-chain):** mint authority revoked?, freeze authority revoked?, top-10 holder
  concentration, token age, pool liquidity USD.
- **Ethereum (GoPlus + sim):** contract verified?, honeypot / buy-sell tax, owner can mint/pause?, liquidity
  locked?, token age, pool liquidity USD. Pair GoPlus (static) with a buy/sell simulation for honeypots.
- **Hard fail (suppress):** honeypot, liquidity < `MIN_LIQUIDITY_USD` (50k), or token < `MIN_TOKEN_AGE_MIN`
  (30 min) unless new-token mode on.
- **Warn (show + still alert):** high holder concentration, unverified contract, FDV ⋙ liquidity.

Cache safety results (`tokens.safety_json`, `safety_checked_at`); don't re-check the same token within a short TTL.

---

## 7. Whale list seeding (realistic sourcing)

Pluggable `WhaleSource` interface. Priority per chain:

**Solana (BigQuery is unreliable here):**
1. **Curated seed CSV** of known smart-money wallets (public leaderboards, Birdeye/known traders) →
   `pnpm seed:wallets --chain sol --file wallets.csv`.
2. **On-chain verification** via Helius RPC / Birdeye: balance proxy (native + stables priced once),
   30-day swap count (activity floor/ceiling), bot/MM exclusion heuristics. Cheap, bounded.
3. **BigQuery Solana** as *optional/experimental* only, with `MAX(block_timestamp)` freshness check reported first.

**Ethereum (BigQuery works):**
1. **BigQuery** `bigquery-public-data.goog_blockchain_ethereum_mainnet_us` (verify name + freshness;
   fall back to `crypto_ethereum` if maintained). Rules: never `SELECT *`, always filter the date partition,
   select only needed columns, **dry-run every query and show estimated bytes**, hard `maximum_bytes_billed` cap.
2. **CSV import** fallback. **Dune** optional, same interface, only if you choose to pay.

**Selection filters (in order), per chain, to build the list:**
1. Balance ≥ `MIN_WALLET_USD` (100k) — native + stables + token holdings priced in USD (BigQuery has no USD:
   use native+stable proxy, documented in `docs/wallet-selection.md` that token holdings aren't fully counted).
2. Activity floor ≥ `MIN_SWAPS_30D` (10).
3. Activity ceiling ≤ `MAX_SWAPS_PER_DAY` (40) on the **30-day average** (protects credits, removes bots).
4. Exclude non-targets: CEX, bridges, staking/program/contract-owned, burn, MMs, MEV/sandwich bots.
   Ethereum: also exclude any address with contract code (`eth_getCode`).
5. Rank remainder by: distinct tokens traded, holding-period hours–days, realized-PnL proxy. Take top `MVP_WALLET_CAP`.

- `labels` table + manual force-include/exclude via `/admin` or CSV.
- Document the exact query + thresholds in `docs/wallet-selection.md`.
- **Weekly refresh:** diff old/new list, sync the provider address set in **one batched edit per chain**
  (stream/webhook edits cost credits — never one address at a time).
- If free-tier limits or data access prevent the full list, **start at 200–300 and report the real numbers.**

---

## 8. Reliability, credit guard, cost safety

- **Idempotent everywhere.** Dedupe Solana by tx signature; ETH by `(txHash, logIndex)`. Safe to replay any event.
- **Webhook/stream routes:** verify auth (Helius auth header; Alchemy `X-Alchemy-Signature`), store the event
  key for idempotency, **respond 200 fast, enqueue a job.** No slow work in the handler.
- **Telegram:** rate-limit sends, retry with backoff on 429 (respect `retry_after`).
- **Credit budget guard (Helius):** count events/day + /month in `usage_daily`. Project month-end from
  month-to-date average. Warn in Telegram at **70%** and **90%** of `HELIUS_MONTHLY_CREDIT_BUDGET` (1M),
  or earlier if the projection exceeds budget.
- **CU budget guard (Alchemy):** same pattern against `ALCHEMY_MONTHLY_CU_BUDGET` (default 30M). **New** —
  the original plan only guarded Helius, but Alchemy's hard cap is the tighter constraint.
- **Auto-trim fallback:** if a projection exceeds budget and `AUTO_TRIM=true`, remove the noisiest wallets
  (highest avg swaps/day) in **one batched edit** until projection < ~85% of budget. Log which wallets,
  tell you in Telegram. Never trim silently.
- **Don't spend credits on what's free:** prices, liquidity, token metadata come from DexScreener/GeckoTerminal/payload, not paid RPC.
- `/status` shows: wallets/chain, events last hour, queue depth, last webhook per provider, credits + CU used,
  daily average, projected month-end.

---

## 9. Data model (Postgres, Drizzle)

Tables as in the original §7, with these additions:
- `wallets`: + `avg_swaps_per_day`, `est_usd_balance`, `is_bot_flagged`, `selected_at`, `prior_score`, `scored_buys_count`.
- `chats`: + `preset`, `digest_mode`, `quiet_until`, `outcome_followup` (bool).
- `chat_token_mutes(chat_id, chain, token_address, muted_until)` — per-token mute. **new**
- `watchlist(chat_id, chain, token_address, created_at)` — `/watch`. **new**
- `alert_feedback(alert_id, chat_id, verdict, created_at)` — 👍/👎 signal. **new**
- `usage_daily(provider, day, events, cu)` — add `cu` for the Alchemy guard.
- Indexes: `buys (token_id, block_time)`, `buys (wallet_id, block_time)`, unique `(chain, tx_id, wallet_id, token_id)`.

---

## 10. Architecture & structure

```
src/
  config/           env parsing (zod)
  providers/
    helius/         parsed-stream create/sync, payload parsing
    alchemy/        webhook sync, signature verify, payload-first classify, tx fetch (fallback)
    market/         DexScreener/GeckoTerminal + MarketDataProvider interface (cache + backoff)
    security/       GoPlus + sim, per-chain safety
    whale-sources/  csv, bigquery, onchain-verify, (dune optional) — WhaleSource interface
  ingest/           fastify: POST /hooks/helius, POST /hooks/alchemy, GET /health
  classify/         buy detection per chain (pure, unit tested)
  signals/          consensus engine, cooldown, scoring, cold-start gating
  jobs/             BullMQ: process-event, enrich-token, safety-check, send-alert,
                    measure-outcomes, refresh-whales, recompute-scores, digest, watchdog
  bot/              grammY commands, onboarding wizard, menus, formatting, feedback handlers
  db/               schema, migrations, queries
tests/  docs/
```
Flow: route verifies auth → stores event key → 200 fast → enqueue. Workers classify, enrich, evaluate, send.
Telegram: webhook mode in prod, long-poll in dev.

---

## 11. Phases & acceptance

**Phase 0 — Decisions & spikes (1–2 days).** Confirm in the live dashboards: Helius free webhook/stream count
+ Parsed Streams eligibility; Alchemy free CU cap + Address-Activity payload shape; BigQuery ETH table name/freshness.
Resolve the ETH cost decision (A/B/C). *Done when:* `docs/providers.md` records confirmed facts and the ETH decision.

**Phase 1 — Skeleton + seeding (Solana first).** Docker Compose, schema/migrations, config, `WhaleSource`
(CSV + on-chain verify; BigQuery for ETH), exclusions/labels, admin sync script, `docs/wallet-selection.md`.
*Done when:* a filtered Solana list (≥200–300, target 600–700) is in the DB and the Helius stream holds that address set.

**Phase 2 — Ingestion + classification.** Routes with auth/signature + idempotency, buy classifiers, fixtures,
unit tests. *Done when:* replaying fixtures yields the expected `buys` rows; duplicates yield none.

**Phase 3 — Bot + alerts.** Onboarding wizard, presets, settings, enrichment, safety, consensus + single-whale
signals, the alert format, live editing, feedback buttons. *Done when:* a simulated burst of 5 buys of one token
yields **one** alert that edits as whales join.

**Phase 4 — Scoring + performance.** Outcome jobs (+1h/+24h/+7d), quality score + cold-start prior,
`/performance` (incl. paper-PnL), `/wallet`, `/leaderboard`. *Done when:* outcomes are recorded at all three
horizons for every signal.

**Phase 5 — Hardening + deploy (DigitalOcean).** Rate limits, retries, health/status, no-webhook watchdog,
Helius credit guard, auto-trim, README with droplet deploy steps (Compose, firewall, TLS webhook, backups),
`.env.example`. *Done when:* the bot runs **48h on a DigitalOcean droplet** with no manual intervention.

**Phase 6 — Ethereum (LATER / optional).** Only after the Solana loop is proven and the ETH cost path is
chosen. Alchemy ingest with payload-first classify + spam filtering, ETH safety (GoPlus+sim), ETH seeding
via BigQuery, CU guard (un-inert the Alchemy scaffolding). *Done when:* ETH buys classify correctly within
the chosen CU budget.

---

## 12. Environment variables (`.env.example`)
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
PUBLIC_BASE_URL=
DATABASE_URL=
REDIS_URL=
HELIUS_API_KEY=
HELIUS_WEBHOOK_AUTH_HEADER=
ALCHEMY_API_KEY=
ALCHEMY_AUTH_TOKEN=
ALCHEMY_WEBHOOK_SIGNING_KEY=
DUNE_API_KEY=
MVP_WALLET_CAP=700
MVP_WALLET_CAP_ETH=250
MIN_WALLET_USD=100000
MIN_SWAPS_30D=10
MAX_SWAPS_PER_DAY=40
MIN_SCORED_BUYS=8
HELIUS_MONTHLY_CREDIT_BUDGET=1000000
ALCHEMY_MONTHLY_CU_BUDGET=30000000
AUTO_TRIM=true
MIN_BUY_USD=5000
MIN_WHALES=3
WINDOW_HOURS=6
HIGH_CONVICTION_USD=50000
MIN_LIQUIDITY_USD=50000
MIN_TOKEN_AGE_MIN=30
ADMIN_TELEGRAM_IDS=
```

## 13. Out of scope
Trade execution, copy-trading, wallet clustering, other chains, web dashboard, paid subscriptions,
scaling to 10,000 wallets. `chats` is multi-user-ready; first release serves you + a few allowlisted chats.

## 14. Decisions (locked 2026-11-18)
1. **Scope:** ✅ **Solana-only MVP.** Build and prove the full loop on Solana (Phases 1–4, 6).
   Ethereum/Alchemy becomes an **optional later phase** (old Phase 5), picked up only after the
   Solana loop is running and only with the ETH cost path chosen then.
2. **Solana cap:** ✅ **Start 600–700**, measure real swap rates for ~2 weeks via `usage_daily`,
   raise toward 1,000 via config once the projection stays < 70% of budget. `MVP_WALLET_CAP=700`.
3. **Hosting:** ✅ **DigitalOcean Ubuntu droplet.** One droplet runs the Node service + Postgres +
   Redis via Docker Compose. Target the $6–12/mo basic droplet (1–2 GB RAM). README documents
   droplet provisioning, firewall, systemd/Compose, TLS for the Telegram webhook, and backups.
4. **Score backfill:** ✅ **Start cold** (recommended). No upfront credit spend; scores accrue as
   real buys get outcomes. Consensus signals work day one; solo high-conviction alerts stay quiet
   until wallets reach `MIN_SCORED_BUYS`. The backfill script still ships (`pnpm backfill:scores`)
   for optional later use, gated behind a credit estimate + `--confirm`.

Because the MVP is Solana-only, Ethereum-specific env vars (`ALCHEMY_*`) and the CU guard ship as
**inert scaffolding** (present, documented, unused) so adding ETH later is a config + enable change,
not a rewrite.
