#!/usr/bin/env bash
# Build + migrate + (re)start the Whale Buy Tracker on the droplet.
# Operates on the code already present in APP_DIR (CI rsyncs it in; .env stays put).
# Idempotent. Run by hand or by the GitHub Actions deploy workflow.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wtb}"
COMPOSE="docker compose -f docker-compose.prod.yml"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERROR: $APP_DIR/.env is missing — refusing to deploy without secrets." >&2
  exit 1
fi

echo "==> Building image"
$COMPOSE build

echo "==> Running DB migrations (Neon)"
$COMPOSE run --rm app pnpm db:migrate

echo "==> Starting stack"
$COMPOSE up -d

echo "==> Status"
$COMPOSE ps
sleep 3
curl -fsS http://127.0.0.1:3000/health && echo "" || echo "WARN: health check not ready yet"
echo "DEPLOY_DONE"
