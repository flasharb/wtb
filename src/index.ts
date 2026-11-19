import { buildServer } from './ingest/server.js';
import { config } from './config/index.js';
import { IngestionProcessor } from './ingest/processor.js';
import { AlertPipeline } from './signals/pipeline.js';
import { createBot } from './bot/index.js';
import { measureSignalOutcomes } from './jobs/measure-outcomes.js';
import { runLaunchScan } from './jobs/scan-launches.js';
import { expireSubscriptions } from './bot/billing.js';
import { pool } from './db/index.js';

const OUTCOME_INTERVAL_MS = 15 * 60 * 1000; // re-check signal outcomes every 15 min

async function start() {
  // Telegram webhook mode is opt-in and needs HTTPS; otherwise long-poll (works on a bare IP).
  const useWebhookMode = config.TELEGRAM_USE_WEBHOOK && !!config.PUBLIC_BASE_URL;

  // --- Telegram bot ---
  let bot: ReturnType<typeof createBot> | undefined;
  if (config.TELEGRAM_BOT_TOKEN) {
    bot = createBot(config.TELEGRAM_BOT_TOKEN);
  } else {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — bot will not start (ingest only).');
  }

  // --- Ingest server wired to the live alert pipeline ---
  const processor = new IngestionProcessor();
  const pipeline = bot ? new AlertPipeline(bot) : undefined;
  const app = buildServer(processor, pipeline ? (buy) => pipeline.handleBuy(buy) : undefined);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    console.error('Failed to start ingest server:', err);
    process.exit(1);
  }

  // --- Start the bot (long-polling in dev, webhook in prod) ---
  if (bot) {
    // Start the bot in the background — never await Telegram here, or a network hiccup
    // (e.g. a dead IPv6 route) would block the ingest server and the launch scanner.
    const b = bot;
    void (async () => {
      try {
        const me = await b.api.getMe();
        if (useWebhookMode) {
          await b.api.setWebhook(`${config.PUBLIC_BASE_URL}/telegram`, {
            secret_token: config.TELEGRAM_WEBHOOK_SECRET || undefined,
          });
          console.log(`🤖 Bot @${me.username} registered in WEBHOOK mode.`);
        } else {
          await b.api.deleteWebhook().catch(() => {});
          b.start({
            onStart: (info) => console.log(`🤖 Bot @${info.username} started in LONG-POLLING mode.`),
          });
        }
      } catch (err: any) {
        console.error('⚠️  Telegram bot failed to start (will keep scanning):', err?.message ?? err);
      }
    })();
  }

  // --- Periodic outcome measurement (+1h / +24h / +7d price re-checks) ---
  const outcomeTimer = setInterval(() => {
    measureSignalOutcomes()
      .then((r) => {
        if (r.length > 0) console.log(`📈 Measured ${r.length} new signal outcome(s).`);
      })
      .catch((e) => console.error('[Outcomes] measurement error:', e?.message ?? e));
  }, OUTCOME_INTERVAL_MS);
  outcomeTimer.unref?.();

  // --- New-launch scanner (primary product) ---
  let scanTimer: NodeJS.Timeout | undefined;
  if (config.SCAN_ENABLED) {
    const scanMs = config.SCAN_INTERVAL_MIN * 60 * 1000;
    const scan = () => runLaunchScan(bot).catch((e) => console.error('[scan] error:', e?.message ?? e));
    scanTimer = setInterval(scan, scanMs);
    scanTimer.unref?.();
    scan(); // run one immediately on startup
    console.log(`🔭 Launch scanner enabled — every ${config.SCAN_INTERVAL_MIN} min (age ${config.SCAN_MIN_AGE_DAYS}-${config.SCAN_MAX_AGE_DAYS}d, ≥$${config.SCAN_MIN_LIQUIDITY_USD} liq)`);
  }

  // --- VIP subscription expiry sweep (every 30 min) ---
  let subTimer: NodeJS.Timeout | undefined;
  if (bot && config.VIP_CHANNEL_ID) {
    const b = bot;
    subTimer = setInterval(() => {
      expireSubscriptions(b).catch((e) => console.error('[billing] expiry sweep error:', e?.message ?? e));
    }, 30 * 60 * 1000);
    subTimer.unref?.();
    console.log(`⭐ VIP subscriptions enabled — ${config.SUB_PRICE_STARS}⭐ / ${config.SUB_DAYS}d`);
  }

  console.log(`\n======================================================`);
  console.log(`🐋 Telegram Whale Buy Tracker — ACTIVE`);
  console.log(`🚀 Ingest server: http://${config.HOST}:${config.PORT}`);
  console.log(`📡 Endpoints: GET /health · POST /hooks/helius · POST /hooks/alchemy`);
  console.log(`🤖 Telegram bot: ${bot ? 'live' : 'disabled'}`);
  console.log(`🌐 Env: ${config.NODE_ENV}${useWebhookMode ? ' (webhook mode)' : ''}`);
  console.log(`======================================================\n`);

  const shutdown = async () => {
    console.log('\nShutting down gracefully...');
    clearInterval(outcomeTimer);
    if (scanTimer) clearInterval(scanTimer);
    if (subTimer) clearInterval(subTimer);
    try {
      await bot?.stop();
    } catch {
      /* ignore */
    }
    await app.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
