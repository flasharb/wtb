import { db } from '../db/index.js';
import { signals, signalOutcomes, tokens } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { MarketDataProvider } from '../providers/market/types.js';
import { DexScreenerMarketProvider } from '../providers/market/market-data-provider.js';
import { Queue, Worker } from 'bullmq';
import { config } from '../config/index.js';

export interface HorizonDef {
  horizon: '1h' | '24h' | '7d';
  ms: number;
}

export const HORIZONS: HorizonDef[] = [
  { horizon: '1h', ms: 1 * 3600 * 1000 },
  { horizon: '24h', ms: 24 * 3600 * 1000 },
  { horizon: '7d', ms: 7 * 24 * 3600 * 1000 },
];

export interface MeasuredOutcome {
  signalId: number;
  tokenId: number;
  tokenAddress: string;
  horizon: '1h' | '24h' | '7d';
  priceAtSignal: number;
  currentPrice: number;
  pctChange: number;
}

/**
 * Scans all historical signals and measures token price performance
 * for any due horizons (+1h, +24h, +7d) that have not yet been recorded.
 */
export async function measureSignalOutcomes(
  marketProvider: MarketDataProvider = new DexScreenerMarketProvider(),
  referenceTime: Date = new Date()
): Promise<MeasuredOutcome[]> {
  const nowMs = referenceTime.getTime();
  const recordedOutcomes: MeasuredOutcome[] = [];

  // 1. Fetch all signals with token details
  const allSignals = await db
    .select({
      signalId: signals.id,
      chain: signals.chain,
      tokenId: signals.tokenId,
      tokenAddress: tokens.address,
      tokenSymbol: tokens.symbol,
      priceAtSignal: signals.priceAtSignal,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .innerJoin(tokens, eq(signals.tokenId, tokens.id));

  for (const sig of allSignals) {
    const signalAgeMs = nowMs - sig.createdAt.getTime();
    const priceAtSignal = parseFloat(sig.priceAtSignal);
    if (priceAtSignal <= 0) continue;

    for (const h of HORIZONS) {
      // Check if horizon is due
      if (signalAgeMs >= h.ms) {
        // Check if outcome already recorded for this horizon
        const existing = await db
          .select({ id: signalOutcomes.id })
          .from(signalOutcomes)
          .where(and(eq(signalOutcomes.signalId, sig.signalId), eq(signalOutcomes.horizon, h.horizon)))
          .limit(1);

        if (existing.length === 0) {
          // Fetch current price
          const marketData = await marketProvider.getTokenMarketData(sig.chain as any, sig.tokenAddress);
          const currentPrice = marketData?.priceUsd || priceAtSignal;

          // Calculate percentage change
          const pctChange = ((currentPrice - priceAtSignal) / priceAtSignal) * 100;

          try {
            await db.insert(signalOutcomes).values({
              signalId: sig.signalId,
              horizon: h.horizon,
              price: currentPrice.toString(),
              pctChange: Math.round(pctChange * 100) / 100,
              measuredAt: new Date(nowMs),
            });

            recordedOutcomes.push({
              signalId: sig.signalId,
              tokenId: sig.tokenId,
              tokenAddress: sig.tokenAddress,
              horizon: h.horizon,
              priceAtSignal,
              currentPrice,
              pctChange: Math.round(pctChange * 100) / 100,
            });
          } catch (err: any) {
            console.error(`[Outcomes] Error recording outcome for signal ${sig.signalId} (${h.horizon}):`, err.message);
          }
        }
      }
    }
  }

  return recordedOutcomes;
}

// BullMQ Queue & Worker initialization
export function setupOutcomesQueue() {
  const queue = new Queue('measure-outcomes', {
    connection: { url: config.REDIS_URL },
  });

  const worker = new Worker(
    'measure-outcomes',
    async () => {
      console.log('🔄 [Worker] Executing measureSignalOutcomes job...');
      const results = await measureSignalOutcomes();
      console.log(`✅ [Worker] Measured and saved ${results.length} new outcome(s).`);
      return { measured: results.length };
    },
    { connection: { url: config.REDIS_URL } }
  );

  return { queue, worker };
}
