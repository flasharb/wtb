import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { connection, SOL_MINT } from './solana.js';

/**
 * Jupiter swap integration: quotes, swap execution, and (quote-only) position valuation.
 * All amounts are in base units (SOL lamports, token raw units) — exactly what Jupiter speaks.
 */

export interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string; // base units in
  outAmount: string; // base units out
  priceImpactPct?: string;
  [k: string]: unknown;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.JUPITER_API_KEY) h['x-api-key'] = config.JUPITER_API_KEY;
  return h;
}

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string | number; // base units of inputMint
  slippageBps: number;
}): Promise<JupQuote | null> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps),
    restrictIntermediateTokens: 'true',
  });
  try {
    const res = await fetch(`${config.JUPITER_API_URL}/quote?${qs}`, { headers: headers() });
    if (!res.ok) return null;
    const j = (await res.json()) as JupQuote;
    if (!j || !j.outAmount || Number(j.outAmount) <= 0) return null;
    return j;
  } catch {
    return null;
  }
}

/** Build, sign, send and confirm the swap for a given quote. Returns the tx signature. */
async function executeSwap(keypair: Keypair, quote: JupQuote): Promise<string> {
  const body = {
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: config.TRADE_PRIORITY_FEE_LAMPORTS,
        priorityLevel: 'high',
      },
    },
  };
  const res = await fetch(`${config.JUPITER_API_URL}/swap`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Jupiter swap build failed (${res.status}): ${txt.slice(0, 160)}`);
  }
  const { swapTransaction, lastValidBlockHeight } = (await res.json()) as {
    swapTransaction: string;
    lastValidBlockHeight: number;
  };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  const conn = connection();
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const blockhash = tx.message.recentBlockhash;
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  // Surface on-chain failures (confirmed but errored) as a thrown error.
  const status = await conn.getSignatureStatus(sig);
  if (status.value?.err) throw new Error(`Swap failed on-chain: ${JSON.stringify(status.value.err)}`);
  return sig;
}

/** Buy a token with SOL. Returns raw tokens received and lamports spent (quoted). */
export async function buyToken(
  keypair: Keypair,
  tokenMint: string,
  solLamports: number,
  slippageBps: number
): Promise<{ sig: string; tokensRaw: string; costLamports: string }> {
  const quote = await getQuote({ inputMint: SOL_MINT, outputMint: tokenMint, amount: solLamports, slippageBps });
  if (!quote) throw new Error('No route to buy this token (no liquidity / quote failed).');
  const sig = await executeSwap(keypair, quote);
  return { sig, tokensRaw: quote.outAmount, costLamports: quote.inAmount };
}

/** Sell a given raw token amount for SOL. Returns lamports received (quoted). */
export async function sellToken(
  keypair: Keypair,
  tokenMint: string,
  tokensRaw: string | number,
  slippageBps: number
): Promise<{ sig: string; solLamports: string; tokensRaw: string }> {
  const quote = await getQuote({ inputMint: tokenMint, outputMint: SOL_MINT, amount: tokensRaw, slippageBps });
  if (!quote) throw new Error('No route to sell this token (liquidity gone?).');
  const sig = await executeSwap(keypair, quote);
  return { sig, solLamports: quote.outAmount, tokensRaw: quote.inAmount };
}

/**
 * Value a holding without executing: what SOL (lamports) you'd get selling `tokensRaw` now.
 * Returns null if there is no route (treated as a rug/liquidity-death signal by the monitor).
 */
export async function quoteValueLamports(
  tokenMint: string,
  tokensRaw: string | number,
  slippageBps: number
): Promise<number | null> {
  const quote = await getQuote({ inputMint: tokenMint, outputMint: SOL_MINT, amount: tokensRaw, slippageBps });
  if (!quote) return null;
  return Number(quote.outAmount);
}
