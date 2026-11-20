import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tradingWallets } from '../db/schema.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { connection, lamportsToSol } from './solana.js';

/** Get the user's custodial wallet, creating (and encrypting) one on first use. */
export async function getOrCreateWallet(uid: string): Promise<{ publicKey: string; created: boolean }> {
  const [existing] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  if (existing) return { publicKey: existing.publicKey, created: false };

  const kp = Keypair.generate();
  const encryptedSecret = encryptSecret(kp.secretKey);
  const publicKey = kp.publicKey.toBase58();
  try {
    await db.insert(tradingWallets).values({ telegramUserId: uid, publicKey, encryptedSecret });
  } catch {
    // Race: another insert won — return the stored one.
    const [row] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
    if (row) return { publicKey: row.publicKey, created: false };
    throw new Error('Failed to create wallet.');
  }
  return { publicKey, created: true };
}

/** Load and decrypt the user's signing keypair. Throws if none exists. */
export async function getKeypair(uid: string): Promise<Keypair> {
  const [row] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  if (!row) throw new Error('No trading wallet for user.');
  return Keypair.fromSecretKey(decryptSecret(row.encryptedSecret));
}

export async function getPublicKey(uid: string): Promise<string | null> {
  const [row] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  return row?.publicKey ?? null;
}

export async function getBalanceSol(pubkey: string): Promise<number> {
  const lamports = await connection().getBalance(new PublicKey(pubkey));
  return lamportsToSol(lamports);
}

/** Sweep/withdraw SOL to an external address. amountSol is gross; a small fee buffer is kept. */
export async function withdrawSol(
  uid: string,
  toAddress: string,
  amountSol: number
): Promise<{ sig: string }> {
  const kp = await getKeypair(uid);
  let to: PublicKey;
  try {
    to = new PublicKey(toAddress);
  } catch {
    throw new Error('That does not look like a valid Solana address.');
  }
  const conn = connection();
  const balance = await conn.getBalance(kp.publicKey);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const FEE_BUFFER = 5000; // ~tx fee
  if (lamports <= 0) throw new Error('Amount must be greater than zero.');
  if (lamports + FEE_BUFFER > balance) {
    throw new Error(`Insufficient balance. Available ≈ ${lamportsToSol(Math.max(0, balance - FEE_BUFFER)).toFixed(4)} SOL.`);
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports })
  );
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return { sig };
}
