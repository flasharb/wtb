import { buildServer } from './ingest/server.js';
import { config } from './config/index.js';
import { IngestionProcessor } from './ingest/processor.js';
import { AlertPipeline } from './signals/pipeline.js';
import { createBot } from './bot/index.js';
import { measureSignalOutcomes } from './jobs/measure-outcomes.js';
import { runLaunchScan } from './jobs/scan-launches.js';
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
    try {
      const me = await bot.api.getMe();
      if (useWebhookMode) {
        // In webhook mode the ingest server (or a reverse proxy) must route
        // POST {PUBLIC_BASE_URL}/telegram to the bot; long-polling is disabled.
        await bot.api.setWebhook(`${config.PUBLIC_BASE_URL}/telegram`, {
          secret_token: config.TELEGRAM_WEBHOOK_SECRET || undefined,
        });
        console.log(`🤖 Bot @${me.username} registered in WEBHOOK mode.`);
      } else {
        // Ensure no stale webhook is set, then long-poll.
        await bot.api.deleteWebhook();
        bot.start({
          onStart: (info) => console.log(`🤖 Bot @${info.username} started in LONG-POLLING mode.`),
        });
      }
    } catch (err: any) {
      console.error('⚠️  Telegram bot failed to start:', err?.message ?? err);
      console.error('   (Ingest server stays up. Check TELEGRAM_BOT_TOKEN.)');
      bot = undefined;
    }
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
