# Whale Buy Tracker — single-service image (ingest API + Telegram bot + workers).
# Runs TypeScript directly via tsx (low-memory, no separate build artifact), which
# suits a 1 GB droplet. Postgres is external (Neon); Redis is a compose sidecar.
FROM node:20-slim

WORKDIR /app

RUN corepack enable

# Install dependencies first (better layer caching). We deliberately do NOT set
# NODE_ENV=production here: tsx (runtime) and drizzle-kit (migrations) are devDependencies
# and must be installed. NODE_ENV=production is set at runtime by docker-compose.prod.yml.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# App source
COPY . .

EXPOSE 3000

# Healthcheck hits the ingest server's /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
