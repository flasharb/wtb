import { Bot, InlineKeyboard } from 'grammy';
import { and, eq, gt, gte, lte, sql, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { launchCandidates, chats } from '../db/schema.js';
import { config } from '../config/index.js';
import { GeckoTerminalSource } from '../providers/launches/geckoterminal-source.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { DexScreenerMarketProvider } from '../providers/market/market-data-provider.js';
import { formatLaunchAlert } from '../bot/launch-formatter.js';
import { formatPrice, formatUsd, tokenTicker } from '../bot/formatters.js';

const SAFETY_CHECKS_PER_CYCLE = 30; // bound GoPlus calls per cycle
const PUMP_MILESTONES = [2, 3, 5, 10, 25, 50, 100]; // x-multiples we celebrate
const FOLLOW_UP_DAYS = 30; // stop tracking a call after this long

/**
 * New-launch scanner. One cycle:
 *   1. Discover active Solana pools (GeckoTerminal) and upsert them as candidates.
 *   2. Prune candidates that aged past the window.
 *   3. Evaluate candidates that just crossed into the window (≥min age, ≥liq, ≥vol):
 *      run strict GoPlus safety; alert the ones that pass (once), permanently reject
 *      those with structural (immutable) safety failures.
 */
export class LaunchScanner {
  private gecko = new GeckoTerminalSource();
  private safety = new SolanaSafetyChecker();
  private market = new DexScreenerMarketProvider();

  constructor(private bot?: Bot) {}

  async runCycle(): Promise<{
    discovered: number;
    checked: number;
    alerted: number;
    rejected: number;
    followed: number;
  }> {
    const now = Date.now();
    const minAgeMs = config.SCAN_MIN_AGE_DAYS * 86400_000;
    const maxAgeMs = config.SCAN_MAX_AGE_DAYS * 86400_000;

    // 1. Discover + upsert
    let discovered = 0;
    try {
      const pools = await this.gecko.discover();
      for (const p of pools) {
        discovered++;
        await db
          .insert(launchCandidates)
          .values({
            chain: 'solana',
            tokenAddress: p.mint,
            symbol: p.symbol || null,
            name: p.name || null,
            poolAddress: p.poolAddress || null,
            dex: p.dex || null,
            poolCreatedAt: p.poolCreatedAt,
            liquidityUsd: p.liquidityUsd.toFixed(2),
            volume24hUsd: p.volume24hUsd.toFixed(2),
            fdvUsd: p.fdvUsd.toFixed(2),
            priceUsd: p.priceUsd.toString(),
            lastCheckedAt: null,
          })
          .onConflictDoUpdate({
            target: [launchCandidates.chain, launchCandidates.tokenAddress],
            set: {
              symbol: sql`coalesce(excluded.symbol, ${launchCandidates.symbol})`,
              name: sql`coalesce(excluded.name, ${launchCandidates.name})`,
              poolAddress: sql`coalesce(${launchCandidates.poolAddress}, excluded.pool_address)`,
              poolCreatedAt: sql`coalesce(${launchCandidates.poolCreatedAt}, excluded.pool_created_at)`,
              dex: sql`coalesce(${launchCandidates.dex}, excluded.dex)`,
              liquidityUsd: p.liquidityUsd.toFixed(2),
              volume24hUsd: p.volume24hUsd.toFixed(2),
              fdvUsd: p.fdvUsd.toFixed(2),
              priceUsd: p.priceUsd.toString(),
            },
          });
      }
    } catch (e: any) {
      console.error('[scan] discovery error:', e?.message ?? e);
    }

    // 2. Prune aged-out candidates still 'watching'
    const minCreated = new Date(now - maxAgeMs); // older than this = too old
    await db
      .update(launchCandidates)
      .set({ status: 'rejected', rejectReason: 'Aged out of launch window' })
      .where(
        and(
          eq(launchCandidates.status, 'watching'),
          lte(launchCandidates.poolCreatedAt, minCreated)
        )
      );

    // 3. Select eligible candidates (in window, liquid, active), least-recently-checked first
    const windowNewest = new Date(now - minAgeMs); // created on/before this = old enough
    const windowOldest = new Date(now - maxAgeMs);
    const eligible = await db
      .select()
      .from(launchCandidates)
      .where(
        and(
          eq(launchCandidates.status, 'watching'),
          lte(launchCandidates.poolCreatedAt, windowNewest),
          gte(launchCandidates.poolCreatedAt, windowOldest),
          gte(launchCandidates.liquidityUsd, config.SCAN_MIN_LIQUIDITY_USD.toString()),
          gte(launchCandidates.volume24hUsd, config.SCAN_MIN_VOLUME_24H_USD.toString())
        )
      )
      .orderBy(asc(launchCandidates.lastCheckedAt), desc(launchCandidates.liquidityUsd))
      .limit(SAFETY_CHECKS_PER_CYCLE);

    let checked = 0;
    let alerted = 0;
    let rejected = 0;

    for (const cand of eligible) {
      if (alerted >= config.SCAN_MAX_ALERTS_PER_CYCLE) break;
      checked++;
      const safety = await this.safety.check(cand.tokenAddress, {
        minHolders: config.SCAN_MIN_HOLDERS,
        maxTop10Pct: config.SCAN_MAX_TOP10_PCT,
      });

      const base = {
        lastCheckedAt: new Date(),
        safetyJson: safety as any,
        holderCount: safety.holderCount,
        top10Pct: safety.top10Pct,
      };

      if (safety.passed) {
        await db
          .update(launchCandidates)
          .set({ ...base, status: 'alerted', alertedAt: new Date(), priceAtAlert: cand.priceUsd })
          .where(eq(launchCandidates.id, cand.id));
        await this.sendAlert(cand, safety);
        alerted++;
      } else if (!safety.verified) {
        // Transient (GoPlus rate-limit / not indexed yet) — keep watching, retry next cycle.
        await db.update(launchCandidates).set({ lastCheckedAt: new Date() }).where(eq(launchCandidates.id, cand.id));
      } else {
        // Permanently reject only on immutable/structural failures; otherwise re-check later.
        const structural = !safety.mintRevoked || !safety.freezeRevoked || !safety.transferable;
        await db
          .update(launchCandidates)
          .set(structural ? { ...base, status: 'rejected', rejectReason: safety.reason } : base)
          .where(eq(launchCandidates.id, cand.id));
        if (structural) rejected++;
      }

      await this.sleep(1200); // pace GoPlus calls
    }

    // 4. Follow up on past calls that have pumped.
    const followed = await this.followUpAlerts();

    return { discovered, checked, alerted, rejected, followed };
  }

  private async sendAlert(cand: typeof launchCandidates.$inferSelect, safety: any) {
    if (!this.bot) return;
    const { text, replyMarkup } = formatLaunchAlert(
      {
        tokenAddress: cand.tokenAddress,
        symbol: cand.symbol,
        name: cand.name,
        dex: cand.dex,
        poolCreatedAt: cand.poolCreatedAt,
        liquidityUsd: Number(cand.liquidityUsd),
        volume24hUsd: Number(cand.volume24hUsd),
        fdvUsd: Number(cand.fdvUsd),
        priceUsd: Number(cand.priceUsd),
      },
      safety
    );

    // 1. Broadcast channel (if configured) — capture the post id for threaded follow-ups.
    if (config.ALERT_CHANNEL_ID) {
      const sent = await this.sendMsg(config.ALERT_CHANNEL_ID, text, replyMarkup);
      if (sent?.message_id) {
        await db
          .update(launchCandidates)
          .set({ channelMessageId: sent.message_id })
          .where(eq(launchCandidates.id, cand.id));
      }
    }

    // 2. Individual subscribers (DMs that /started the bot and aren't muted).
    const activeChats = await db.select().from(chats).where(eq(chats.muted, false));
    for (const chat of activeChats) await this.sendMsg(chat.telegramChatId, text, replyMarkup);

    const to = `${config.ALERT_CHANNEL_ID ? 'channel + ' : ''}${activeChats.length} chat(s)`;
    console.log(`[scan] 🚀 alerted ${cand.symbol || cand.tokenAddress} to ${to}`);
  }

  /** Send with a plain-text fallback so Markdown-breaking names never drop a message. */
  private async sendMsg(target: string | number, text: string, keyboard?: InlineKeyboard, replyTo?: number | null) {
    if (!this.bot) return undefined;
    const opts: any = { reply_markup: keyboard };
    if (replyTo) {
      opts.reply_to_message_id = replyTo;
      opts.allow_sending_without_reply = true;
    }
    try {
      return await this.bot.api.sendMessage(target, text, { parse_mode: 'Markdown', ...opts });
    } catch {
      try {
        return await this.bot.api.sendMessage(target, text.replace(/[*_`]/g, ''), opts);
      } catch (e2: any) {
        console.error(`[scan] send to ${target} failed:`, e2?.message ?? e2);
        return undefined;
      }
    }
  }

  /**
   * Follow up on past calls: re-price each alerted token and, when it crosses a new
   * milestone (2x, 3x, 5x…), post "X hit Nx" — threaded under the original channel post.
   */
  private async followUpAlerts(): Promise<number> {
    if (!this.bot) return 0;
    const cutoff = new Date(Date.now() - FOLLOW_UP_DAYS * 86400000);
    const alerted = await db
      .select()
      .from(launchCandidates)
      .where(
        and(
          eq(launchCandidates.status, 'alerted'),
          gt(launchCandidates.priceAtAlert, '0'),
          gte(launchCandidates.alertedAt, cutoff)
        )
      );

    let posted = 0;
    for (const c of alerted) {
      const entry = Number(c.priceAtAlert);
      if (!entry || entry <= 0) continue;
      const md = await this.market.getTokenMarketData('solana', c.tokenAddress);
      const price = md?.priceUsd || 0;
      if (price <= 0) continue;

      const mult = price / entry;
      const updates: any = {};
      if (mult > Number(c.peakMultiple)) updates.peakMultiple = mult;

      // Highest new milestone crossed since we last reported.
      const reported = Number(c.reportedMultiple);
      const crossed = PUMP_MILESTONES.filter((m) => m > reported && mult >= m);
      if (crossed.length > 0) {
        const hit = Math.max(...crossed);
        await this.postPump(c, hit, entry, price, md?.liquidityUsd || 0);
        updates.reportedMultiple = hit;
        posted++;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(launchCandidates).set(updates).where(eq(launchCandidates.id, c.id));
      }
    }
    return posted;
  }

  private async postPump(
    c: typeof launchCandidates.$inferSelect,
    mult: number,
    entry: number,
    price: number,
    liq: number
  ) {
    const ticker = tokenTicker(c.symbol, c.tokenAddress);
    const text =
      `📈 *${mult}x* — *${ticker}* since the call! 🚀\n` +
      `Entry ${formatPrice(entry)} → now ${formatPrice(price)}` +
      (liq > 0 ? ` · 💧 ${formatUsd(liq)}` : '');
    const kb = new InlineKeyboard()
      .url('📈 Chart', `https://dexscreener.com/solana/${c.tokenAddress}`)
      .url('🔍 Solscan', `https://solscan.io/token/${c.tokenAddress}`);

    if (config.ALERT_CHANNEL_ID) {
      await this.sendMsg(config.ALERT_CHANNEL_ID, text, kb, c.channelMessageId);
    }
    const activeChats = await db.select().from(chats).where(eq(chats.muted, false));
    for (const chat of activeChats) await this.sendMsg(chat.telegramChatId, text, kb);
    console.log(`[scan] 📈 ${ticker} hit ${mult}x — follow-up posted`);
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/** Convenience wrapper for the runtime interval. */
export async function runLaunchScan(bot?: Bot) {
  const scanner = new LaunchScanner(bot);
  const r = await scanner.runCycle();
  console.log(
    `[scan] cycle: discovered ${r.discovered}, checked ${r.checked}, alerted ${r.alerted}, rejected ${r.rejected}, pump-follow-ups ${r.followed}`
  );
  return r;
}
