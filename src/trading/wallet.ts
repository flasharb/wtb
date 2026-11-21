import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';
import { db } from '../db/index.js';
import { tradingWallets } from '../db/schema.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { connection, lamportsToSol } from './solana.js';

// Phantom's default Solana account path — so a generated seed imports as the same wallet.
const PHANTOM_PATH = "m/44'/501'/0'/0'";
const DERIVATION = `bip39:${PHANTOM_PATH}`;

function keypairFromMnemonic(mnemonic: string): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic, '');
  const derived = derivePath(PHANTOM_PATH, seed.toString('hex')).key;
  return Keypair.fromSeed(derived);
}

/** Generate a fresh BIP39 wallet and store it (encrypted). Returns the row-shaped values. */
function newWalletValues(uid: string) {
  const mnemonic = bip39.generateMnemonic(128); // 12 words
  const kp = keypairFromMnemonic(mnemonic);
  return {
    values: {
      telegramUserId: uid,
      publicKey: kp.publicKey.toBase58(),
      encryptedSecret: encryptSecret(kp.secretKey),
      encryptedMnemonic: encryptSecret(new TextEncoder().encode(mnemonic)),
      derivation: DERIVATION,
    },
    mnemonic,
    secretKeyB58: bs58.encode(kp.secretKey),
    address: kp.publicKey.toBase58(),
  };
}

/** Get the user's wallet, creating (BIP39, encrypted) one on first use. No secrets returned. */
export async function getOrCreateWallet(uid: string): Promise<{ publicKey: string; created: boolean }> {
  const [existing] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  if (existing) return { publicKey: existing.publicKey, created: false };

  const w = newWalletValues(uid);
  try {
    await db.insert(tradingWallets).values(w.values);
  } catch {
    const [row] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
    if (row) return { publicKey: row.publicKey, created: false };
    throw new Error('Failed to create wallet.');
  }
  return { publicKey: w.address, created: true };
}

/** Explicitly create a wallet and return its seed + key ONCE (for the user to save). */
export async function createWallet(uid: string): Promise<{ address: string; mnemonic: string; secretKey: string }> {
  const [existing] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  if (existing) throw new Error('A wallet already exists. Use export to reveal its keys.');
  const w = newWalletValues(uid);
  await db.insert(tradingWallets).values(w.values);
  return { address: w.address, mnemonic: w.mnemonic, secretKey: w.secretKeyB58 };
}

/** Reveal an existing wallet's seed phrase (if BIP39) + private key. Sensitive — audit/guard upstream. */
export async function exportWallet(uid: string): Promise<{ mnemonic: string | null; secretKey: string }> {
  const [row] = await db.select().from(tradingWallets).where(eq(tradingWallets.telegramUserId, uid));
  if (!row) throw new Error('No wallet to export.');
  const secretKey = bs58.encode(decryptSecret(row.encryptedSecret));
  const mnemonic = row.encryptedMnemonic ? new TextDecoder().decode(decryptSecret(row.encryptedMnemonic)) : null;
  return { mnemonic, secretKey };
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

/** Live on-chain balance (raw base units) of `mint` held by `owner`. Source of truth for sells. */
export async function getTokenBalanceRaw(owner: PublicKey | string, mint: string): Promise<bigint> {
  const ownerPk = typeof owner === 'string' ? new PublicKey(owner) : owner;
  const res = await connection().getParsedTokenAccountsByOwner(ownerPk, { mint: new PublicKey(mint) });
  let sum = 0n;
  for (const { account } of res.value) {
    const amt = (account.data as any)?.parsed?.info?.tokenAmount?.amount;
    if (amt) sum += BigInt(amt);
  }
  return sum;
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
