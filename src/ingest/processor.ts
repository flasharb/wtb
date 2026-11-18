import { db } from '../db/index.js';
import { webhookEvents, usageDaily, wallets, tokens, buys } from '../db/schema.js';
import { DetectedBuy } from '../classify/types.js';
import { eq, and, sql } from 'drizzle-orm';

export interface IngestionResult {
  isDuplicate: boolean;
  eventStored: boolean;
}

export class IngestionProcessor {
  /**
   * Idempotency Check & Event Storage:
   * Safely attempts to record the incoming webhook event key.
   * If key already exists, returns isDuplicate: true.
   */
  async checkAndStoreEvent(
    provider: 'helius' | 'alchemy',
    eventKey: string
  ): Promise<IngestionResult> {
    try {
      await db.insert(webhookEvents).values({
        provider,
        eventKey,
        receivedAt: new Date(),
      });
      return { isDuplicate: false, eventStored: true };
    } catch (err: any) {
      // Postgres unique constraint violation code is '23505'
      if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('unique')) {
        return { isDuplicate: true, eventStored: false };
      }
      throw err;
    }
  }

  /**
   * Credit Budget Guard:
   * Increments daily event counter in usage_daily table.
   */
  async recordDailyUsage(provider: 'helius' | 'alchemy', count: number = 1): Promise<number> {
    const today = new Date().toISOString().split('T')[0];

    try {
      const res = await db
        .insert(usageDaily)
        .values({
          provider,
          day: today,
          events: count,
        })
        .onConflictDoUpdate({
          target: [usageDaily.provider, usageDaily.day],
          set: {
            events: sql`${usageDaily.events} + ${count}`,
          },
        })
        .returning({ total: usageDaily.events });

      return res[0]?.total ?? count;
    } catch (err: any) {
      console.error(`[UsageGuard] Error updating daily usage for ${provider}:`, err.message);
      return count;
    }
  }

  /**
   * Persists a detected buy into the PostgreSQL database.
   * Idempotently ignores duplicates via unique constraint on (chain, tx_id, wallet_id, token_id).
   */
  async persistDetectedBuy(buy: DetectedBuy): Promise<{ recorded: boolean; buyId?: number }> {
    // 1. Ensure wallet exists in DB (or find it)
    const walletRows = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.chain, buy.chain), eq(wallets.address, buy.walletAddress)));

    let walletId: number;
    if (walletRows.length === 0) {
      // Wallet wasn't in seed list (e.g. ad-hoc transaction)
      const newWallet = await db
        .insert(wallets)
        .values({
          chain: buy.chain,
          address: buy.walletAddress,
          source: 'detected_activity',
          tier: 'active',
          qualityScore: 50,
          avgSwapsPerDay: 1,
          estUsdBalance: '100000',
        })
        .onConflictDoUpdate({
          target: [wallets.chain, wallets.address],
          set: { updatedAt: new Date() },
        })
        .returning({ id: wallets.id });
      walletId = newWallet[0].id;
    } else {
      walletId = walletRows[0].id;
    }

    // 2. Ensure token exists in tokens table
    const tokenRows = await db
      .select({ id: tokens.id })
      .from(tokens)
      .where(and(eq(tokens.chain, buy.chain), eq(tokens.address, buy.tokenAddress)));

    let tokenId: number;
    if (tokenRows.length === 0) {
      const newToken = await db
        .insert(tokens)
        .values({
          chain: buy.chain,
          address: buy.tokenAddress,
          symbol: buy.tokenSymbol,
          name: buy.tokenName,
          decimals: buy.tokenDecimals ?? 18,
          firstSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tokens.chain, tokens.address],
          set: {
            symbol: buy.tokenSymbol ?? sql`${tokens.symbol}`,
          },
        })
        .returning({ id: tokens.id });
      tokenId = newToken[0].id;
    } else {
      tokenId = tokenRows[0].id;
    }

    // 3. Insert into buys table
    try {
      const inserted = await db
        .insert(buys)
        .values({
          chain: buy.chain,
          txId: buy.txId,
          logIndex: buy.logIndex,
          walletId,
          tokenId,
          usdValue: buy.usdValue.toString(),
          quoteAsset: buy.quoteAsset,
          blockTime: buy.blockTime,
          rawRef: buy.rawRef,
        })
        .onConflictDoNothing({
          target: [buys.chain, buys.txId, buys.walletId, buys.tokenId],
        })
        .returning({ id: buys.id });

      if (inserted.length > 0) {
        return { recorded: true, buyId: inserted[0].id };
      }
      // Conflict ignored - duplicate buy
      return { recorded: false };
    } catch (err: any) {
      console.error(`[Processor] Error saving buy (${buy.txId}):`, err.message);
      return { recorded: false };
    }
  }
}
