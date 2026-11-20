import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tradingConfigs } from '../db/schema.js';
import { config } from '../config/index.js';

export type TradingConfig = typeof tradingConfigs.$inferSelect;

/** Fetch the user's trade config, creating one with sensible defaults on first use. */
export async function getOrCreateConfig(uid: string): Promise<TradingConfig> {
  const [existing] = await db.select().from(tradingConfigs).where(eq(tradingConfigs.telegramUserId, uid));
  if (existing) return existing;
  try {
    const [row] = await db
      .insert(tradingConfigs)
      .values({
        telegramUserId: uid,
        enabled: false,
        buySol: config.TRADE_DEFAULT_BUY_SOL.toString(),
        tpPct: config.TRADE_DEFAULT_TP_PCT,
        slPct: config.TRADE_DEFAULT_SL_PCT,
        trailPct: config.TRADE_DEFAULT_TRAIL_PCT,
        tpSellPct: config.TRADE_DEFAULT_TP_SELL_PCT,
        slippageBps: config.TRADE_DEFAULT_SLIPPAGE_BPS,
        maxConcurrent: config.TRADE_DEFAULT_MAX_CONCURRENT,
        maxDailyBuys: config.TRADE_DEFAULT_MAX_DAILY_BUYS,
      })
      .returning();
    return row;
  } catch {
    const [row] = await db.select().from(tradingConfigs).where(eq(tradingConfigs.telegramUserId, uid));
    return row;
  }
}

export async function updateConfig(uid: string, patch: Partial<TradingConfig>): Promise<TradingConfig> {
  await getOrCreateConfig(uid);
  const [row] = await db
    .update(tradingConfigs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tradingConfigs.telegramUserId, uid))
    .returning();
  return row;
}

/** Roll the per-day buy counter over if we've crossed into a new UTC day. Returns the live count. */
export async function dailyBuysUsed(cfg: TradingConfig): Promise<number> {
  const now = new Date();
  const last = cfg.dailyResetAt ? new Date(cfg.dailyResetAt) : new Date(0);
  const newDay = now.getUTCFullYear() !== last.getUTCFullYear() ||
    now.getUTCMonth() !== last.getUTCMonth() ||
    now.getUTCDate() !== last.getUTCDate();
  if (newDay) {
    await db
      .update(tradingConfigs)
      .set({ dailyBuys: 0, dailyResetAt: now })
      .where(eq(tradingConfigs.telegramUserId, cfg.telegramUserId));
    return 0;
  }
  return cfg.dailyBuys;
}
