# Whale Buy Tracker

Telegram bot that watches curated whale/active-trader wallets on **Solana** (MVP) and alerts on
their token **buys** — consensus and high-conviction signals — so you can evaluate buying too.
Alerts only: no trading, no private keys, no custody.

> Not financial advice. Whale buys can be bait. Verify before acting.

See **[PLAN.md](PLAN.md)** for the full spec/decisions and **[docs/](docs/)** for wallet selection and scoring.

## Stack
TypeScript · Node 20 · grammY (Telegram) · Fastify (webhook ingest) · Drizzle + PostgreSQL (Neon) ·
Redis · BullMQ · Zod · pino. Runs as one service (ingest API + bot + workers).

## Architecture
```
Helius webhook ──▶ /hooks/helius ──▶ classify buy ──▶ signal engine ──▶ Telegram alert
                        (idempotent, 200 fast)         (consensus / high-conviction)
```
Postgres is Neon (external). Redis + the app run in Docker. The Telegram bot uses long-polling
(works on a bare-IP server; no TLS needed).

## Local development
```bash
pnpm install
docker compose up -d redis          # Postgres is Neon via DATABASE_URL
cp .env.example .env                 # fill in secrets
pnpm db:migrate
pnpm test
pnpm start                           # ingest on :3000 + bot (long-poll)
```

## Seeding the Solana watch list (real, on-chain)
```bash
pnpm seed:wallets --chain sol --source onchain --min-usd 0 --max-swaps 150 --max-usd 10000000
pnpm sync:webhooks --chain sol       # create/update the Helius webhook for the watched addresses
```

## Deployment (DigitalOcean droplet)
One-time: `bash deploy/provision.sh` (swap + Docker + firewall). Then each deploy:
```bash
bash deploy/deploy.sh                # build + migrate + (re)start docker-compose.prod.yml
```
CI/CD: pushing to `main` runs `.github/workflows/deploy.yml`, which ships the code to the droplet
and runs `deploy/deploy.sh`. Requires repo secrets `DROPLET_HOST` and `DROPLET_SSH_KEY`.

## Environment
See [.env.example](.env.example). Secrets are provided via environment only and never committed.
