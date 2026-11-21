import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fees } from '../db/schema.js';
import { config } from '../config/index.js';
import { getKeypair } from './wallet.js';
import { connection, lamportsToSol } from './solana.js';

/**
 * Two fees, accrued per event then swept to the treasury in one transfer per user:
 *   - transaction fee: TXN_FEE_BPS (0.3%) of the SOL moved on every buy and every sell.
 *   - performance fee: PERF_FEE_BPS (1%) of realized profit on a profitable close.
 * Accruing (just a ledger row) keeps the trade path fast; the sweeper does the on-chain transfers.
 */

/** 0.3% of the SOL moved on a trade (buy in, or sell out). */
export async function accrueTransactionFee(uid: string, positionId: number, solLamports: number): Promise<void> {
  const bps = config.TXN_FEE_BPS;
  if (bps <= 0 || solLamports <= 0) return;
  const fee = Math.floor((solLamports * bps) / 10_000);
  if (fee <= 0) return;
  try {
    await db.insert(fees).values({
      telegramUserId: uid, positionId, kind: 'transaction',
      basisLamports: String(Math.floor(solLamports)), feeBps: bps, feeLamports: String(fee), status: 'accrued',
    });
  } catch (e: any) {
    console.error(`[fee] accrue txn failed (pos ${positionId}):`, e?.message ?? e);
  }
}

/** 1% of realized profit at a profitable close. Idempotent per position. */
export async function accruePerformanceFee(uid: string, positionId: number, profitLamports: number): Promise<void> {
  const bps = config.PERF_FEE_BPS;
  if (bps <= 0 || profitLamports <= 0) return;
  const [existing] = await db
    .select({ id: fees.id }).from(fees)
    .where(and(eq(fees.positionId, positionId), eq(fees.kind, 'performance')));
  if (existing) return;
  const fee = Math.floor((profitLamports * bps) / 10_000);
  if (fee <= 0) return;
  try {
    await db.insert(fees).values({
      telegramUserId: uid, positionId, kind: 'performance',
      basisLamports: String(Math.floor(profitLamports)), profitLamports: String(Math.floor(profitLamports)),
      feeBps: bps, feeLamports: String(fee), status: 'accrued',
    });
  } catch (e: any) {
    console.error(`[fee] accrue perf failed (pos ${positionId}):`, e?.message ?? e);
  }
}

/** Settle each user's accrued fees to the treasury in one transfer. Call on an interval. */
export async function sweepAccruedFees(): Promise<number> {
  const treasury = config.FEE_TREASURY_ADDRESS;
  if (!treasury) return 0;
  let treasuryPk: PublicKey;
  try {
    treasuryPk = new PublicKey(treasury);
  } catch {
    console.error('[fee] invalid FEE_TREASURY_ADDRESS');
    return 0;
  }

  const users = await db
    .select({ uid: fees.telegramUserId }).from(fees)
    .where(eq(fees.status, 'accrued')).groupBy(fees.telegramUserId);

  let settled = 0;
  for (const { uid } of users) {
    const rows = await db
      .select({ id: fees.id, fee: fees.feeLamports }).from(fees)
      .where(and(eq(fees.telegramUserId, uid), eq(fees.status, 'accrued')));
    const total = rows.reduce((a, r) => a + Number(r.fee), 0);
    if (total < config.FEE_MIN_LAMPORTS) continue;

    try {
      const kp = await getKeypair(uid);
      const conn = connection();
      const bal = await conn.getBalance(kp.publicKey);
      if (bal < total + 10_000) continue; // can't cover fee + gas yet — retry next sweep

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: treasuryPk, lamports: total })
      );
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      await db.update(fees).set({ status: 'settled', txSig: sig, settledAt: new Date() }).where(inArray(fees.id, rows.map((r) => r.id)));
      settled += rows.length;
      console.log(`[fee] swept ${lamportsToSol(total).toFixed(5)} SOL from ${uid} (${rows.length} fees) → treasury (${sig})`);
    } catch (e: any) {
      console.error(`[fee] sweep failed for ${uid}:`, e?.message ?? e);
    }
  }
  return settled;
}
