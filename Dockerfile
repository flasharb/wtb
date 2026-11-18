# Whale Buy Tracker — single-service image (ingest API + Telegram bot + workers).
# Runs TypeScript directly via tsx (low-memory, no separate build artifact), which
# suits a 1 GB droplet. Postgres is external (Neon); Redis is a compose sidecar.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# Install dependencies first (better layer caching). Need dev deps too: tsx (runtime)
# and drizzle-kit (migrations) live there.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source
COPY . .

EXPOSE 3000

# Healthcheck hits the ingest server's /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
