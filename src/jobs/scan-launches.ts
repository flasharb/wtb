import { Bot, InlineKeyboard } from 'grammy';
import { and, eq, gt, gte, lte, sql, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { launchCandidates, chats } from '../db/schema.js';
import { config } from '../config/index.js';
import { GeckoTerminalSource } from '../providers/launches/geckoterminal-source.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { DexScreenerMarketProvider } from '../providers/market/market-data-provider.js';
import { BirdeyeProvider } from '../providers/market/birdeye-provider.js';
import { formatLaunchAlert, formatTeaser } from '../bot/launch-formatter.js';
import { formatPrice, formatUsd, tokenTicker } from '../bot/formatters.js';
import { isSubscriber } from '../bot/billing.js';
import { autoBuyForSignal } from '../trading/engine.js';

const SAFETY_CHECKS_PER_CYCLE = 30; // bound GoPlus calls per cycle
const REFRESH_PER_CYCLE = 60; // market-data refreshes per cycle (DexScreener)
const REFRESH_FROM_DAYS = 1; // re-price candidates ≥1 day old (brand-new ones have fresh discovery data)
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
  private birdeye = new BirdeyeProvider();

  constructor(private bot?: Bot) {}

  async runCycle(): Promise<{
    discovered: number;
    refreshed: number;
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

    // 2b. Refresh market data for candidates in / approaching the window, so we evaluate
    // maturity with CURRENT liquidity & volume (discovery feeds skew heavily to brand-new
    // tokens, so a survivor would otherwise be judged on stale day-0 data).
    const refreshed = await this.refreshWatching(now);

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
      // Rug protection: skip DEXes where the dev can pull liquidity. pump.fun/PumpSwap burn
      // LP at migration (unruggable); meteora-damm-v2 / raydium-launchlab often don't.
      if (cand.dex && config.SCAN_DEX_DENYLIST.includes(cand.dex.toLowerCase())) {
        await db
          .update(launchCandidates)
          .set({ status: 'rejected', rejectReason: `Rug-prone DEX (${cand.dex})` })
          .where(eq(launchCandidates.id, cand.id));
        rejected++;
        continue;
      }
      checked++;
      // Safety is rug-only here (minHolders:0); the holder gate is applied via Birdeye below
      // so it works for brand-new tokens GoPlus hasn't indexed yet.
      const safety = await this.safety.check(cand.tokenAddress, {
        minHolders: 0,
        maxTop10Pct: config.SCAN_MAX_TOP10_PCT,
      });

      const base = {
        lastCheckedAt: new Date(),
        safetyJson: safety as any,
        holderCount: safety.holderCount,
        top10Pct: safety.top10Pct,
      };

      if (safety.passed) {
        // Holder gate: live holder count from Birdeye (covers any age).
        const ov = await this.birdeye.getOverview(cand.tokenAddress);
        const holders = ov?.holder ?? safety.holderCount ?? 0;
        if (holders < config.SCAN_MIN_HOLDERS) {
          // Safe but not enough holders yet — keep watching (holder count grows over time).
          await db.update(launchCandidates).set({ ...base, holderCount: holders }).where(eq(launchCandidates.id, cand.id));
        } else {
          // Show the real holder count on the alert.
          safety.holderCount = holders;
          const hc = safety.checks.find((c) => c.name === 'Holders');
          if (hc) hc.detail = holders.toLocaleString();
          else safety.checks.push({ name: 'Holders', status: 'pass', detail: holders.toLocaleString() });
          await db
            .update(launchCandidates)
            .set({
              ...base,
              holderCount: holders,
              status: 'alerted',
              alertedAt: new Date(),
              // Entry price from Birdeye (same source used in follow-ups) for consistent multiples.
              priceAtAlert: ov?.priceUsd && ov.priceUsd > 0 ? ov.priceUsd.toString() : cand.priceUsd,
            })
            .where(eq(launchCandidates.id, cand.id));
          await this.sendAlert(cand, safety);
          alerted++;
        }
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

    return { discovered, refreshed, checked, alerted, rejected, followed };
  }

  /** Re-price watching candidates that are in or approaching the age window. */
  private async refreshWatching(now: number): Promise<number> {
    const oldest = new Date(now - config.SCAN_MAX_AGE_DAYS * 86400000);
    const newest = new Date(now - REFRESH_FROM_DAYS * 86400000); // created on/before ~5d ago
    const rows = await db
      .select({ id: launchCandidates.id, addr: launchCandidates.tokenAddress, created: launchCandidates.poolCreatedAt })
      .from(launchCandidates)
      .where(
        and(
          eq(launchCandidates.status, 'watching'),
          lte(launchCandidates.poolCreatedAt, newest),
          gte(launchCandidates.poolCreatedAt, oldest)
        )
      )
      .orderBy(asc(launchCandidates.lastCheckedAt))
      .limit(REFRESH_PER_CYCLE);

    let n = 0;
    for (const r of rows) {
      const md = await this.market.getTokenMarketData('solana', r.addr);
      if (md && md.liquidityUsd > 0) {
        await db
          .update(launchCandidates)
          .set({
            liquidityUsd: md.liquidityUsd.toFixed(2),
            volume24hUsd: (md.volume24hUsd || 0).toFixed(2),
            priceUsd: (md.priceUsd || 0).toString(),
            fdvUsd: (md.fdvUsd || 0).toFixed(2),
          })
          .where(eq(launchCandidates.id, r.id));
        n++;
      } else {
        // No live pool / liquidity — the token is dead. Drop it so it never alerts.
        await db
          .update(launchCandidates)
          .set({ status: 'rejected', rejectReason: 'Pool gone / no liquidity' })
          .where(eq(launchCandidates.id, r.id));
      }
    }
    return n;
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
        priceUsd: cand.priceUsd ?? 0, // raw stored string → exact price, no rounding
      },
      safety
    );

    // Full call → VIP channel (or public if no VIP) + eligible DMs. Capture the channel
    // post id for threaded follow-ups.
    const msgId = await this.broadcastFull(text, replyMarkup);
    if (msgId) {
      await db.update(launchCandidates).set({ channelMessageId: msgId }).where(eq(launchCandidates.id, cand.id));
    }

    // Public teaser (contract hidden) → drives subscriptions — only when VIP is a separate channel.
    if (
      config.TEASER_ENABLED &&
      config.VIP_CHANNEL_ID &&
      config.ALERT_CHANNEL_ID &&
      config.ALERT_CHANNEL_ID !== config.VIP_CHANNEL_ID
    ) {
      const view = {
        tokenAddress: cand.tokenAddress,
        symbol: cand.symbol,
        name: cand.name,
        dex: cand.dex,
        poolCreatedAt: cand.poolCreatedAt,
        liquidityUsd: Number(cand.liquidityUsd),
        volume24hUsd: Number(cand.volume24hUsd),
        fdvUsd: Number(cand.fdvUsd),
        priceUsd: cand.priceUsd ?? 0,
      };
      const t = formatTeaser(view, safety);
      await this.sendMsg(config.ALERT_CHANNEL_ID, t.text, t.replyMarkup);
    }
    console.log(`[scan] 🚀 alerted ${cand.symbol || cand.tokenAddress}`);

    // Autopilot: buy this fresh call for every VIP who has the sniper enabled.
    // Non-blocking — a slow/failed trade must never hold up the scan cycle or other alerts.
    if (this.bot) {
      const b = this.bot;
      void autoBuyForSignal(b, cand).catch((e) => console.error('[trade] autoBuy error:', e?.message ?? e));
    }
  }

  /**
   * Deliver a full call/follow-up to the VIP channel (or the public channel if no VIP is
   * configured) plus DMs. Once a VIP channel is set, DMs go only to admins and active
   * subscribers so the paywall isn't bypassed. Returns the channel message id.
   */
  private async broadcastFull(text: string, keyboard?: InlineKeyboard, channelReplyTo?: number | null) {
    const target = config.VIP_CHANNEL_ID || config.ALERT_CHANNEL_ID;
    let msgId: number | undefined;
    if (target) {
      const sent = await this.sendMsg(target, text, keyboard, channelReplyTo);
      msgId = sent?.message_id;
    }
    const activeChats = await db.select().from(chats).where(eq(chats.muted, false));
    for (const chat of activeChats) {
      if (
        config.VIP_CHANNEL_ID &&
        !config.ADMIN_TELEGRAM_IDS.includes(chat.telegramChatId) &&
        !(await isSubscriber(chat.telegramChatId))
      ) {
        continue; // non-subscriber DM is gated once VIP is live
      }
      await this.sendMsg(chat.telegramChatId, text, keyboard);
    }
    return msgId;
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
      const ov = await this.birdeye.getOverview(c.tokenAddress);
      const liq = md?.liquidityUsd ?? ov?.liquidityUsd;

      // Rug / liquidity death — report once, then stop tracking this call.
      if (typeof liq === 'number' && liq > 0 && liq < config.SCAN_RUG_LIQUIDITY_USD) {
        await this.postRug(c, liq);
        await db
          .update(launchCandidates)
          .set({ status: 'closed', rejectReason: 'Liquidity died' })
          .where(eq(launchCandidates.id, c.id));
        posted++;
        continue;
      }

      // Current price: use the CONSERVATIVE (lower) of DexScreener + Birdeye so a single-source
      // price glitch can't fabricate a pump (this is what caused the false 100x/11000x reports).
      const prices = [ov?.priceUsd || 0, md?.priceUsd || 0].filter((p) => p > 0);
      if (prices.length === 0) continue;
      const price = Math.min(...prices);
      const mult = price / entry;
      // Glitch guard: ignore absurd multiples outright.
      if (!isFinite(mult) || mult > config.FOLLOWUP_MAX_MULT) continue;
      const updates: any = {};
      if (mult > Number(c.peakMultiple)) updates.peakMultiple = mult;

      // Highest new pump milestone crossed since we last reported.
      const reported = Number(c.reportedMultiple);
      const crossed = PUMP_MILESTONES.filter((m) => m > reported && mult >= m);
      if (crossed.length > 0) {
        const hit = Math.max(...crossed);
        await this.postPump(c, hit, entry, price, liq || 0);
        updates.reportedMultiple = hit;
        posted++;
      } else if (!c.reportedFade && mult <= config.SCAN_FADE_MULT) {
        // Faded below the entry threshold — report once (keep tracking in case it recovers).
        await this.postFade(c, mult, entry, price);
        updates.reportedFade = true;
        posted++;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(launchCandidates).set(updates).where(eq(launchCandidates.id, c.id));
      }
    }
    return posted;
  }

  private async postFade(
    c: typeof launchCandidates.$inferSelect,
    mult: number,
    entry: number,
    price: number
  ) {
    const ticker = tokenTicker(c.symbol, c.tokenAddress);
    const pct = Math.round((mult - 1) * 100); // negative
    const text =
      `📉 *${ticker}* faded *${pct}%* from the call.\n` +
      `Entry ${formatPrice(entry)} → now ${formatPrice(price)}`;
    const kb = new InlineKeyboard().url('📈 Chart', `https://dexscreener.com/solana/${c.tokenAddress}`);
    await this.broadcastFull(text, kb, c.channelMessageId);
    console.log(`[scan] 📉 ${ticker} faded ${pct}% — follow-up posted`);
  }

  private async postRug(c: typeof launchCandidates.$inferSelect, liq: number) {
    const ticker = tokenTicker(c.symbol, c.tokenAddress);
    const text =
      `💀 *${ticker}* — liquidity gone (${formatUsd(liq)}). Looks dead/rugged; tracking stopped.`;
    const kb = new InlineKeyboard().url('🔍 Solscan', `https://solscan.io/token/${c.tokenAddress}`);
    await this.broadcastFull(text, kb, c.channelMessageId);
    console.log(`[scan] 💀 ${ticker} rugged (liq ${formatUsd(liq)}) — follow-up posted`);
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

    await this.broadcastFull(text, kb, c.channelMessageId);
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
    `[scan] cycle: discovered ${r.discovered}, refreshed ${r.refreshed}, checked ${r.checked}, alerted ${r.alerted}, rejected ${r.rejected}, follow-ups ${r.followed}`
  );
  return r;
}
