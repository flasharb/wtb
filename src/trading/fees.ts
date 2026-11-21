import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fees } from '../db/schema.js';
import { config } from '../config/index.js';
import { getKeypair } from './wallet.js';
import { connection, lamportsToSol } from './solana.js';

/**
 * Performance fee: on a position that closes in net profit, take PERF_FEE_BPS (1%) of the profit
 * from the user's trading wallet and send it to the treasury. Never on losses, never on principal.
 * Idempotent per position (unique index). Safe no-op if no treasury is configured.
 */
export async function collectPerformanceFee(
  uid: string,
  positionId: number,
  realizedLamports: number
): Promise<void> {
  const feeBps = config.PERF_FEE_BPS;
  const treasury = config.FEE_TREASURY_ADDRESS;
  if (!treasury || feeBps <= 0 || realizedLamports <= 0) return;

  // Already charged? (idempotency)
  const [existing] = await db.select({ id: fees.id }).from(fees).where(eq(fees.positionId, positionId));
  if (existing) return;

  const feeLamports = Math.floor((realizedLamports * feeBps) / 10_000);
  if (feeLamports < config.FEE_MIN_LAMPORTS) {
    await recordFee(uid, positionId, realizedLamports, feeBps, 0, 'skipped', null, 'below minimum');
    return;
  }

  try {
    const kp = await getKeypair(uid);
    const conn = connection();
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(treasury), lamports: feeLamports })
    );
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    await recordFee(uid, positionId, realizedLamports, feeBps, feeLamports, 'swept', sig, null);
    console.log(`[fee] ${uid} paid ${lamportsToSol(feeLamports).toFixed(5)} SOL (1% of profit) on position ${positionId} (${sig})`);
  } catch (e: any) {
    // Record as accrued so it can be retried/swept later; don't lose the obligation.
    await recordFee(uid, positionId, realizedLamports, feeBps, feeLamports, 'accrued', null, (e?.message ?? '').slice(0, 240));
    console.error(`[fee] transfer failed for position ${positionId}:`, e?.message ?? e);
  }
}

async function recordFee(
  uid: string, positionId: number, profit: number, feeBps: number, feeLamports: number,
  status: 'swept' | 'accrued' | 'skipped', txSig: string | null, error: string | null
) {
  await db
    .insert(fees)
    .values({
      telegramUserId: uid, positionId,
      profitLamports: String(Math.max(0, Math.floor(profit))),
      feeBps, feeLamports: String(feeLamports), status,
      txSig: txSig ?? undefined, error: error ?? undefined,
    })
    .onConflictDoNothing({ target: fees.positionId });
}
