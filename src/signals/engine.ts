import { db } from '../db/index.js';
import { buys, tokens, wallets, walletLabels, signals, alertsSent, chats } from '../db/schema.js';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { BuyerSummary, EvaluatedSignal } from './types.js';
import { config } from '../config/index.js';

export interface SignalEvaluationOptions {
  windowHours?: number;
  minWhales?: number;
  highConvictionUsd?: number;
  minBuyUsd?: number;
  chatId?: number;
}

export class SignalEngine {
  async evaluateTokenBuys(
    tokenId: number,
    currentPrice: number = 0,
    options: SignalEvaluationOptions = {}
  ): Promise<EvaluatedSignal | null> {
    const windowHours = options.windowHours ?? config.WINDOW_HOURS;
    const minWhales = options.minWhales ?? config.MIN_WHALES;
    const highConvictionUsd = options.highConvictionUsd ?? config.HIGH_CONVICTION_USD;

    const windowStart = new Date(Date.now() - windowHours * 3600 * 1000);

    // 1. Fetch token details
    const tokenRows = await db.select().from(tokens).where(eq(tokens.id, tokenId));
    if (tokenRows.length === 0) return null;
    const token = tokenRows[0];

    // 2. Query recent buys for this token within the time window
    const recentBuys = await db
      .select({
        buyId: buys.id,
        walletId: buys.walletId,
        walletAddress: wallets.address,
        qualityScore: wallets.qualityScore,
        usdValue: buys.usdValue,
        blockTime: buys.blockTime,
        label: walletLabels.label,
      })
      .from(buys)
      .innerJoin(wallets, eq(buys.walletId, wallets.id))
      .leftJoin(walletLabels, eq(wallets.id, walletLabels.walletId))
      .where(and(eq(buys.tokenId, tokenId), gte(buys.blockTime, windowStart)))
      .orderBy(desc(buys.usdValue));

    if (recentBuys.length === 0) return null;

    // 3. Aggregate by distinct wallet
    const buyerMap = new Map<number, BuyerSummary>();
    let totalUsd = 0;

    for (const row of recentBuys) {
      const usd = parseFloat(row.usdValue);
      totalUsd += usd;

      if (!buyerMap.has(row.walletId)) {
        buyerMap.set(row.walletId, {
          walletId: row.walletId,
          walletAddress: row.walletAddress,
          label: row.label || undefined,
          qualityScore: row.qualityScore,
          usdValue: usd,
          blockTime: row.blockTime,
        });
      } else {
        // Increment aggregate USD for this wallet
        const existing = buyerMap.get(row.walletId)!;
        existing.usdValue += usd;
      }
    }

    const distinctBuyers = Array.from(buyerMap.values()).sort((a, b) => b.usdValue - a.usdValue);
    const whaleCount = distinctBuyers.length;

    // 4. Check Signal Conditions
    let signalType: 'consensus' | 'high_conviction' | null = null;
    let signalReason = '';

    // Condition A: Consensus (e.g. 3+ whales in window)
    if (whaleCount >= minWhales) {
      signalType = 'consensus';
      signalReason = `${whaleCount} whales bought in ${windowHours}h`;
    }

    // Condition B: High-Conviction Single Whale (Score >= 80, Buy >= $50,000)
    const highConvictionBuyer = distinctBuyers.find(
      (b) => b.qualityScore >= 80 && b.usdValue >= highConvictionUsd
    );

    if (highConvictionBuyer) {
      // High-conviction takes priority or overrides if single whale
      if (!signalType) {
        signalType = 'high_conviction';
        signalReason = `1 high-score whale (${highConvictionBuyer.label || 'Whale'}, $${Math.round(
          highConvictionBuyer.usdValue
        ).toLocaleString()}), high conviction buy`;
      }
    }

    if (!signalType) {
      // No signal fired
      return null;
    }

    // 5. Cooldown & Alert Editing Check (12-hour per-token cooldown)
    const cooldownStart = new Date(Date.now() - 12 * 3600 * 1000);
    const existingAlerts = await db
      .select({
        alertId: alertsSent.id,
        telegramMessageId: alertsSent.telegramMessageId,
        signalId: alertsSent.signalId,
        previousWhaleCount: signals.whaleCount,
        previousCreatedAt: signals.createdAt,
      })
      .from(alertsSent)
      .innerJoin(signals, eq(alertsSent.signalId, signals.id))
      .where(and(eq(signals.tokenId, tokenId), gte(alertsSent.sentAt, cooldownStart)))
      .orderBy(desc(alertsSent.sentAt))
      .limit(1);

    let isUpdate = false;
    let shouldAlert = true;
    let existingAlertMessageId: number | undefined;
    let existingSignalId: number | undefined;
    let suppressedReason: string | undefined;

    if (existingAlerts.length > 0) {
      const prev = existingAlerts[0];
      existingAlertMessageId = prev.telegramMessageId;
      existingSignalId = prev.signalId;

      if (whaleCount > prev.previousWhaleCount) {
        // More whales joined! EDIT the existing message
        isUpdate = true;
        shouldAlert = true;
        signalReason = `${whaleCount} whales bought in ${windowHours}h (Updated)`;
      } else {
        // Cooldown active, whale count has not grown
        shouldAlert = false;
        suppressedReason = `Cooldown: already alerted within 12h (${prev.previousWhaleCount} whales)`;
      }
    }

    return {
      shouldAlert,
      isUpdate,
      signalType,
      chain: token.chain as any,
      tokenId,
      tokenAddress: token.address,
      tokenSymbol: token.symbol || 'UNKNOWN',
      tokenName: token.name || 'Unknown Token',
      whaleCount,
      totalUsd,
      buyers: distinctBuyers,
      signalReason,
      priceAtSignal: currentPrice,
      existingAlertMessageId,
      existingSignalId,
      suppressedReason,
    };
  }
}
