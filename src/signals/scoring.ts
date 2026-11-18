import { db } from '../db/index.js';
import { wallets, buys, signals, signalOutcomes } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';

export interface EvaluatedTrade {
  return24h?: number;
  return7d?: number;
}

export interface ScoreComputationResult {
  qualityScore: number;
  winRate: number;
  medianReturn: number;
  sampleCount: number;
}

/**
 * Pure calculation function for wallet quality scoring with Bayesian shrinkage
 */
export function calculateQualityScore(
  trades: EvaluatedTrade[],
  shrinkageK: number = 10,
  prior: number = 50
): ScoreComputationResult {
  const n = trades.length;

  if (n === 0) {
    return {
      qualityScore: prior,
      winRate: 50,
      medianReturn: 0,
      sampleCount: 0,
    };
  }

  // 1. Calculate win rate across trades
  let wins = 0;
  const allReturns: number[] = [];

  for (const t of trades) {
    const r24 = t.return24h;
    const r7 = t.return7d;

    // Use available horizons
    const bestReturn = r7 !== undefined && r24 !== undefined
      ? 0.4 * r24 + 0.6 * r7
      : r24 !== undefined
      ? r24
      : r7 !== undefined
      ? r7
      : 0;

    allReturns.push(bestReturn);
    if (bestReturn > 0) {
      wins++;
    }
  }

  const winRate = (wins / n) * 100;

  // 2. Calculate median return
  allReturns.sort((a, b) => a - b);
  const mid = Math.floor(allReturns.length / 2);
  const medianReturn =
    allReturns.length % 2 !== 0
      ? allReturns[mid]
      : (allReturns[mid - 1] + allReturns[mid]) / 2;

  // 3. Normalized return factor (bounded to [-50%, +150%])
  const clampedReturn = Math.max(-50, Math.min(150, medianReturn));
  const returnScore = 50 + clampedReturn / 2; // Maps to [25, 125]

  // 4. Raw Composite Score
  const rawScore = 0.65 * winRate + 0.35 * returnScore;

  // 5. Bayesian Shrinkage toward neutral prior (50)
  const weightEmpirical = n / (n + shrinkageK);
  const weightPrior = shrinkageK / (n + shrinkageK);
  const qualityScore = Math.round(weightEmpirical * rawScore + weightPrior * prior);

  const boundedScore = Math.max(0, Math.min(100, qualityScore));

  return {
    qualityScore: boundedScore,
    winRate: Math.round(winRate * 10) / 10,
    medianReturn: Math.round(medianReturn * 10) / 10,
    sampleCount: n,
  };
}

/**
 * Recomputes and updates quality scores for all wallets with recorded buys
 */
export async function recomputeAllWalletScores(): Promise<Array<{ walletId: number; oldScore: number; newScore: number }>> {
  const allWallets = await db.select().from(wallets);
  const updates: Array<{ walletId: number; oldScore: number; newScore: number }> = [];

  for (const w of allWallets) {
    // Fetch all recorded buys for this wallet
    const walletBuys = await db.select().from(buys).where(eq(buys.walletId, w.id));

    if (walletBuys.length === 0) {
      continue;
    }

    const tokenIds = Array.from(new Set(walletBuys.map((b) => b.tokenId)));

    // Fetch outcomes for these tokens
    const outcomes = await db
      .select({
        tokenId: signals.tokenId,
        horizon: signalOutcomes.horizon,
        pctChange: signalOutcomes.pctChange,
      })
      .from(signals)
      .innerJoin(signalOutcomes, eq(signals.id, signalOutcomes.signalId))
      .where(inArray(signals.tokenId, tokenIds));

    // Map token outcomes
    const tokenOutcomeMap = new Map<number, { return24h?: number; return7d?: number }>();
    for (const o of outcomes) {
      if (!tokenOutcomeMap.has(o.tokenId)) {
        tokenOutcomeMap.set(o.tokenId, {});
      }
      const entry = tokenOutcomeMap.get(o.tokenId)!;
      if (o.horizon === '24h') entry.return24h = o.pctChange;
      if (o.horizon === '7d') entry.return7d = o.pctChange;
    }

    const trades: EvaluatedTrade[] = walletBuys.map((b) => tokenOutcomeMap.get(b.tokenId) || {});
    const { qualityScore } = calculateQualityScore(trades);

    if (qualityScore !== Math.round(w.qualityScore)) {
      await db
        .update(wallets)
        .set({ qualityScore, updatedAt: new Date() })
        .where(eq(wallets.id, w.id));

      updates.push({
        walletId: w.id,
        oldScore: Math.round(w.qualityScore),
        newScore: qualityScore,
      });
    }
  }

  return updates;
}
