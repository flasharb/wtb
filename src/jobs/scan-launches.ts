import { Bot } from 'grammy';
import { and, eq, gte, lte, sql, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { launchCandidates, chats } from '../db/schema.js';
import { config } from '../config/index.js';
import { GeckoTerminalSource } from '../providers/launches/geckoterminal-source.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { formatLaunchAlert } from '../bot/launch-formatter.js';

const SAFETY_CHECKS_PER_CYCLE = 30; // bound GoPlus calls per cycle

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

  constructor(private bot?: Bot) {}

  async runCycle(): Promise<{ discovered: number; checked: number; alerted: number; rejected: number }> {
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

    return { discovered, checked, alerted, rejected };
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

    const activeChats = await db.select().from(chats).where(eq(chats.muted, false));
    for (const chat of activeChats) {
      try {
        await this.bot.api.sendMessage(chat.telegramChatId, text, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      } catch (e: any) {
        // A token name with Markdown-breaking chars can make parsing fail — never drop the
        // alert: retry as plain text (strip Markdown markers) so it always gets through.
        try {
          await this.bot.api.sendMessage(chat.telegramChatId, text.replace(/[*_`]/g, ''), {
            reply_markup: replyMarkup,
          });
        } catch (e2: any) {
          console.error(`[scan] send to ${chat.telegramChatId} failed:`, e2?.message ?? e2);
        }
      }
    }
    console.log(`[scan] 🚀 alerted ${cand.symbol || cand.tokenAddress} to ${activeChats.length} chat(s)`);
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
    `[scan] cycle: discovered ${r.discovered}, checked ${r.checked}, alerted ${r.alerted}, rejected ${r.rejected}`
  );
  return r;
}
