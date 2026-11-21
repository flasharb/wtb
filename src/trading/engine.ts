import { Bot } from 'grammy';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tradingConfigs, positions, trades, launchCandidates } from '../db/schema.js';
import { config } from '../config/index.js';
import { tokenTicker } from '../bot/formatters.js';
import { encryptionReady } from './crypto.js';
import { getKeypair, getPublicKey, getBalanceSol, getTokenBalanceRaw } from './wallet.js';
import { buyToken, sellToken, quoteValueLamports } from './jupiter.js';
import { solToLamports, lamportsToSol } from './solana.js';
import { getOrCreateConfig, dailyBuysUsed, TradingConfig } from './store.js';

/** Sells use a wider slippage floor so exits on fast-dumping tokens actually land. */
function exitSlippageBps(cfg: TradingConfig): number {
  return Math.min(5000, Math.max(cfg.slippageBps, config.TRADE_EXIT_SLIPPAGE_BPS));
}

type Candidate = typeof launchCandidates.$inferSelect;
type Position = typeof positions.$inferSelect;

async function dm(bot: Bot, uid: string, text: string) {
  try {
    await bot.api.sendMessage(uid, text, { parse_mode: 'Markdown' });
  } catch {
    // Markdown-breaking symbol? Retry as plain text so trade alerts never silently drop.
    try {
      await bot.api.sendMessage(uid, text.replace(/[*_`]/g, ''));
    } catch {
      /* user may have blocked the bot */
    }
  }
}

/** True when the trading subsystem can actually execute (kill-switch + key vault ready). */
export function tradingLive(): boolean {
  return config.TRADING_ENABLED && encryptionReady();
}

/**
 * A new VIP call just fired. Auto-buy it for every user who has autopilot enabled and is
 * within their own limits (balance, concurrency, daily cap). Runs sequentially to stay gentle
 * on the RPC; each user trades their own isolated wallet.
 */
export async function autoBuyForSignal(bot: Bot, candidate: Candidate): Promise<void> {
  if (!tradingLive()) return;
  const enabled = await db.select().from(tradingConfigs).where(eq(tradingConfigs.enabled, true));
  if (enabled.length === 0) return;
  const ticker = tokenTicker(candidate.symbol, candidate.tokenAddress);

  for (const cfg of enabled) {
    const uid = cfg.telegramUserId;
    try {
      // Idempotency: one position per (user, call).
      const [dupe] = await db
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.telegramUserId, uid), eq(positions.candidateId, candidate.id)));
      if (dupe) continue;

      // Daily cap.
      const used = await dailyBuysUsed(cfg);
      if (used >= cfg.maxDailyBuys) continue;

      // Concurrency cap.
      const [{ open }] = await db
        .select({ open: sql<number>`count(*)::int` })
        .from(positions)
        .where(and(eq(positions.telegramUserId, uid), eq(positions.status, 'open')));
      if (open >= cfg.maxConcurrent) continue;

      // Balance check (respect the global per-trade ceiling and keep a fee reserve).
      const pubkey = await getPublicKey(uid);
      if (!pubkey) continue;
      const buySol = Math.min(Number(cfg.buySol), config.TRADE_MAX_BUY_SOL);
      if (buySol <= 0) continue;
      const bal = await getBalanceSol(pubkey);
      if (bal < buySol + config.TRADE_FEE_RESERVE_SOL) continue; // underfunded — skip quietly

      // Execute the buy.
      const kp = await getKeypair(uid);
      const lamports = solToLamports(buySol);
      const { sig, tokensRaw, costLamports } = await buyToken(kp, candidate.tokenAddress, lamports, cfg.slippageBps);

      // Source of truth for how many tokens we actually hold = the on-chain balance after the
      // swap, NOT the quoted outAmount (slippage means the real fill differs). This is what the
      // exit monitor must sell, or sells fail with "insufficient funds".
      let heldRaw = tokensRaw;
      try {
        const actual = await getTokenBalanceRaw(kp.publicKey, candidate.tokenAddress);
        if (actual > 0n) heldRaw = actual.toString();
      } catch {
        /* fall back to the quoted amount; the sell path re-clamps to live balance anyway */
      }
      // Cost basis includes the priority + base fee so PnL/break-even reflect real account growth.
      const basisLamports = Number(costLamports) + config.TRADE_PRIORITY_FEE_LAMPORTS + 5000;
      // Entry liquidation value = what the full fill would fetch right now. TP/SL are measured
      // against this (price moves), not cost basis, so the entry spread isn't an instant loss.
      let baseValue = basisLamports;
      try {
        const v = await quoteValueLamports(candidate.tokenAddress, heldRaw, exitSlippageBps(cfg));
        if (v && v > 0) baseValue = v;
      } catch {
        /* transient — fall back to cost basis as the baseline */
      }

      const [pos] = await db
        .insert(positions)
        .values({
          telegramUserId: uid,
          candidateId: candidate.id,
          tokenAddress: candidate.tokenAddress,
          symbol: candidate.symbol ?? null,
          status: 'open',
          buySol: buySol.toFixed(9),
          costLamports: String(basisLamports),
          tokensBought: heldRaw,
          tokensRemaining: heldRaw,
          costRemainingLamports: String(basisLamports),
          baseValueLamports: String(baseValue),
          buyTxSig: sig,
          peakMultiple: 1,
        })
        .returning();

      await db.insert(trades).values({
        positionId: pos.id,
        telegramUserId: uid,
        side: 'buy',
        kind: 'entry',
        tokensRaw: heldRaw,
        solLamports: costLamports,
        txSig: sig,
      });

      await db
        .update(tradingConfigs)
        .set({ dailyBuys: sql`${tradingConfigs.dailyBuys} + 1` })
        .where(eq(tradingConfigs.telegramUserId, uid));

      await dm(
        bot,
        uid,
        `🟢 *Autopilot bought ${ticker}*\n` +
          `Spent *${buySol} SOL*\n` +
          `Exit plan: TP *+${cfg.tpPct}%* (sell ${cfg.tpSellPct}%) · SL *-${cfg.slPct}%* · trail ${cfg.trailPct}%\n` +
          `[tx](https://solscan.io/tx/${sig})`
      );
      console.log(`[trade] ${uid} bought ${ticker} for ${buySol} SOL (${sig})`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(`[trade] buy failed for ${uid} on ${ticker}:`, msg);
      await dm(bot, uid, `⚠️ Autopilot couldn't buy *${ticker}*: ${msg.slice(0, 160)}`);
    }
  }
}

/**
 * Re-price every open position and act: stop-loss, take-profit (with moon-bag partial), and a
 * trailing stop on the runner. A dead route (no liquidity) closes the position as a rug.
 */
// A null quote means "no route right now" — which is usually a dead/rugged pool, but can also
// be a transient Jupiter/RPC blip. Require a few consecutive failures before closing as a rug so
// a momentary outage never force-sells (or writes off) a healthy position.
const RUG_CONFIRM_STREAK = 3;
const nullStreak = new Map<number, number>();

let monitoring = false;
export async function monitorPositions(bot: Bot): Promise<number> {
  if (!tradingLive() || monitoring) return 0;
  monitoring = true;
  let acted = 0;
  try {
    const open = await db.select().from(positions).where(eq(positions.status, 'open'));
    for (const p of open) {
      try {
        const cfg = await getOrCreateConfig(p.telegramUserId);
        const tokensRemaining = BigInt(p.tokensRemaining);
        if (tokensRemaining <= 0n) {
          await closePosition(p, p.exitReason ?? 'manual');
          continue;
        }

        const value = await quoteValueLamports(p.tokenAddress, p.tokensRemaining, cfg.slippageBps);
        // No route — likely liquidity death, but confirm over a few cycles first (not a blip).
        if (value === null) {
          const streak = (nullStreak.get(p.id) ?? 0) + 1;
          nullStreak.set(p.id, streak);
          if (streak < RUG_CONFIRM_STREAK) {
            await db.update(positions).set({ lastCheckedAt: new Date() }).where(eq(positions.id, p.id));
            continue;
          }
          nullStreak.delete(p.id);
          await db
            .update(positions)
            .set({ status: 'closed', exitReason: 'rug', closedAt: new Date(), lastCheckedAt: new Date(),
              realizedPnlLamports: sql`${positions.proceedsLamports} - ${positions.costLamports}`,
              lastError: 'No swap route (liquidity died)' })
            .where(eq(positions.id, p.id));
          await dm(bot, p.telegramUserId, `💀 *${tokenTicker(p.symbol, p.tokenAddress)}* rugged — no exit route. Position closed.`);
          acted++;
          continue;
        }
        nullStreak.delete(p.id); // healthy quote — reset the failure streak

        // Multiple is measured against the entry liquidation value (scaled to the still-held
        // fraction), so TP/SL track real price movement — not the fixed entry spread. Falls back
        // to cost basis for legacy rows written before base_value existed.
        const totalCost = Number(p.costLamports);
        const remFrac = totalCost > 0 ? Number(p.costRemainingLamports) / totalCost : 1;
        const baseFull = Number(p.baseValueLamports) > 0 ? Number(p.baseValueLamports) : Number(p.costLamports);
        const baseRem = baseFull * remFrac;
        const mult = baseRem > 0 ? value / baseRem : 1;
        const peak = Math.max(p.peakMultiple, mult);

        const slFloor = 1 - cfg.slPct / 100;
        const tpTrigger = 1 + cfg.tpPct / 100;

        if (!p.tpHit && mult <= slFloor) {
          acted += await sellAndSettle(bot, p, cfg, tokensRemaining, 'sl', true, mult);
        } else if (!p.tpHit && mult >= tpTrigger) {
          if (cfg.tpSellPct >= 100) {
            acted += await sellAndSettle(bot, p, cfg, tokensRemaining, 'tp', true, mult);
          } else {
            const sellRaw = (tokensRemaining * BigInt(Math.round(cfg.tpSellPct))) / 100n;
            if (sellRaw > 0n) acted += await sellAndSettle(bot, p, cfg, sellRaw, 'tp', false, mult);
          }
        } else if (p.tpHit) {
          const trailStop = peak * (1 - cfg.trailPct / 100);
          if (mult <= trailStop) {
            acted += await sellAndSettle(bot, p, cfg, tokensRemaining, 'trail', true, mult);
          } else {
            await db.update(positions).set({ peakMultiple: peak, lastCheckedAt: new Date() }).where(eq(positions.id, p.id));
          }
        } else {
          await db.update(positions).set({ peakMultiple: peak, lastCheckedAt: new Date() }).where(eq(positions.id, p.id));
        }
      } catch (e: any) {
        console.error(`[trade] monitor error on position ${p.id}:`, e?.message ?? e);
        await db.update(positions).set({ lastCheckedAt: new Date(), lastError: (e?.message ?? '').slice(0, 240) }).where(eq(positions.id, p.id));
      }
    }
  } finally {
    monitoring = false;
  }
  return acted;
}

/** Execute a sell leg and update the position (partial for moon-bag TP, full otherwise). */
async function sellAndSettle(
  bot: Bot,
  p: Position,
  cfg: TradingConfig,
  tokensToSell: bigint,
  reason: 'tp' | 'sl' | 'trail' | 'rug' | 'manual',
  closeAfter: boolean,
  mult: number
): Promise<number> {
  const ticker = tokenTicker(p.symbol, p.tokenAddress);
  try {
    const kp = await getKeypair(p.telegramUserId);

    // Clamp to the live on-chain balance so a sell never exceeds what we actually hold (slippage,
    // rounding, dust, or a manual sale). For a full exit, dump the entire real balance.
    let actualHeld: bigint | null = null;
    try {
      actualHeld = await getTokenBalanceRaw(kp.publicKey, p.tokenAddress);
    } catch {
      /* RPC blip — fall back to our tracked amount */
    }
    if (actualHeld !== null && actualHeld <= 0n) {
      // Nothing left on-chain — reconcile and close so we stop retrying a dead position.
      await db
        .update(positions)
        .set({
          status: 'closed', exitReason: reason, tokensRemaining: '0', costRemainingLamports: '0',
          realizedPnlLamports: String(Number(p.proceedsLamports) - Number(p.costLamports)),
          closedAt: new Date(), lastCheckedAt: new Date(), lastError: 'No tokens on-chain at exit',
        })
        .where(eq(positions.id, p.id));
      return 1;
    }
    let sellAmt = tokensToSell;
    if (actualHeld !== null) sellAmt = closeAfter ? actualHeld : (tokensToSell <= actualHeld ? tokensToSell : actualHeld);
    if (sellAmt <= 0n) return 0;

    const { sig, solLamports } = await sellToken(kp, p.tokenAddress, sellAmt.toString(), exitSlippageBps(cfg));
    const proceeds = Number(solLamports);

    const totalRemaining = BigInt(p.tokensRemaining);
    const costRem = Number(p.costRemainingLamports);
    const fraction = totalRemaining > 0n ? Math.min(1, Number(sellAmt) / Number(totalRemaining)) : 1;
    const costSold = closeAfter ? costRem : Math.floor(costRem * fraction);

    const newProceeds = Number(p.proceedsLamports) + proceeds;
    const newTokensRemaining = totalRemaining - sellAmt;
    const newCostRemaining = Math.max(0, costRem - costSold);
    const totalCost = Number(p.costLamports);

    await db.insert(trades).values({
      positionId: p.id,
      telegramUserId: p.telegramUserId,
      side: 'sell',
      kind: reason,
      tokensRaw: sellAmt.toString(),
      solLamports: String(proceeds),
      txSig: sig,
    });

    if (closeAfter || newTokensRemaining <= 0n) {
      const realized = newProceeds - totalCost;
      await db
        .update(positions)
        .set({
          status: 'closed',
          exitReason: reason,
          tokensRemaining: '0',
          costRemainingLamports: '0',
          proceedsLamports: String(newProceeds),
          realizedPnlLamports: String(realized),
          peakMultiple: Math.max(p.peakMultiple, mult),
          closedAt: new Date(),
          lastCheckedAt: new Date(),
        })
        .where(eq(positions.id, p.id));
      const pnlSol = lamportsToSol(realized);
      const emoji = realized >= 0 ? '✅' : '🔴';
      const label = reason === 'sl' ? 'Stop-loss' : reason === 'trail' ? 'Trailing stop' : reason === 'tp' ? 'Take-profit' : 'Closed';
      await dm(
        bot,
        p.telegramUserId,
        `${emoji} *${label} — ${ticker}*\n` +
          `Sold at *${mult.toFixed(2)}x* · got *${lamportsToSol(proceeds).toFixed(4)} SOL*\n` +
          `Net P&L: *${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL*\n[tx](https://solscan.io/tx/${sig})`
      );
    } else {
      // Moon-bag partial at TP: bank the profit, let the rest ride with a trailing stop.
      await db
        .update(positions)
        .set({
          tpHit: true,
          tokensRemaining: newTokensRemaining.toString(),
          costRemainingLamports: String(newCostRemaining),
          proceedsLamports: String(newProceeds),
          realizedPnlLamports: String(newProceeds - (totalCost - newCostRemaining)),
          peakMultiple: mult, // anchor the trailing stop at the TP level
          lastCheckedAt: new Date(),
        })
        .where(eq(positions.id, p.id));
      await dm(
        bot,
        p.telegramUserId,
        `🎯 *Take-profit — ${ticker}* hit *${mult.toFixed(2)}x*\n` +
          `Sold *${cfg.tpSellPct}%* for *${lamportsToSol(proceeds).toFixed(4)} SOL* · letting the rest ride (trail ${cfg.trailPct}%).\n[tx](https://solscan.io/tx/${sig})`
      );
    }
    console.log(`[trade] ${p.telegramUserId} ${reason} ${ticker} at ${mult.toFixed(2)}x (${sig})`);
    return 1;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[trade] sell (${reason}) failed on position ${p.id}:`, msg);
    await db.update(positions).set({ lastCheckedAt: new Date(), lastError: msg.slice(0, 240) }).where(eq(positions.id, p.id));
    return 0;
  }
}

/** Mark a position closed without a new sell (e.g. already fully sold). */
async function closePosition(p: Position, reason: string) {
  await db
    .update(positions)
    .set({ status: 'closed', exitReason: reason, closedAt: new Date(), lastCheckedAt: new Date() })
    .where(eq(positions.id, p.id));
}
