import { ClassificationResult, DetectedBuy } from './types.js';
import { isQuoteAsset } from './constants.js';
import { computeQuoteUsdValue, QuotePriceContext } from './quote-pricing.js';
import { config } from '../config/index.js';

export interface HeliusSwapPayload {
  description?: string;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
  signature: string;
  slot?: number;
  timestamp: number;
  transactionError?: any;
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string | number } | null;
      nativeOutput?: { account: string; amount: string | number } | null;
      tokenInputs?: Array<{
        userAccount: string;
        tokenAccount?: string;
        mint: string;
        rawTokenAmount: { tokenAmount: string; decimals: number };
      }>;
      tokenOutputs?: Array<{
        userAccount: string;
        tokenAccount?: string;
        mint: string;
        rawTokenAmount: { tokenAmount: string; decimals: number };
      }>;
      innerSwaps?: any[];
    };
  };
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    fromTokenAccount?: string;
    toTokenAccount?: string;
    tokenAmount: number;
    mint: string;
    tokenStandard?: string;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      userAccount?: string;
      mint: string;
      rawTokenAmount: { tokenAmount: string; decimals: number };
    }>;
  }>;
}

export function classifySolanaSwap(
  tx: HeliusSwapPayload,
  watchedWallet: string,
  options: {
    minBuyUsd?: number;
    priceContext?: QuotePriceContext;
    existingPositionUsd?: number;
  } = {}
): ClassificationResult {
  const minBuyUsd = options.minBuyUsd ?? config.MIN_BUY_USD;
  const targetWallet = watchedWallet.trim();

  // 1. Transaction error check
  if (tx.transactionError != null) {
    return { isBuy: false, ignoredReason: 'Transaction failed (transactionError)' };
  }

  // 2. Track net flows for target wallet
  let quoteAssetMint = '';
  let quoteOutflowRaw = 0; // Lamports or smallest unit
  let boughtTokenMint = '';
  let boughtTokenAmount = '0';
  let tokenDecimals = 9;

  // Check Helius parsed swap event first (enhanced webhook)
  const swapEvent = tx.events?.swap;

  if (swapEvent) {
    // Check if target wallet provided native input (SOL)
    if (swapEvent.nativeInput && swapEvent.nativeInput.account === targetWallet) {
      quoteAssetMint = 'So11111111111111111111111111111111111111112';
      quoteOutflowRaw += Number(swapEvent.nativeInput.amount);
    }

    // Check if target wallet provided token inputs (e.g. USDC / USDT)
    if (swapEvent.tokenInputs && swapEvent.tokenInputs.length > 0) {
      for (const input of swapEvent.tokenInputs) {
        if (input.userAccount === targetWallet && isQuoteAsset('solana', input.mint)) {
          quoteAssetMint = input.mint;
          quoteOutflowRaw += Number(input.rawTokenAmount.tokenAmount);
        }
      }
    }

    // Check tokens received by target wallet
    if (swapEvent.tokenOutputs && swapEvent.tokenOutputs.length > 0) {
      for (const output of swapEvent.tokenOutputs) {
        if (output.userAccount === targetWallet && !isQuoteAsset('solana', output.mint)) {
          boughtTokenMint = output.mint;
          boughtTokenAmount = output.rawTokenAmount.tokenAmount;
          tokenDecimals = output.rawTokenAmount.decimals;
        }
      }
    }
  }

  // 3. Fallback / verification using tokenTransfers & nativeTransfers
  if (!boughtTokenMint || quoteOutflowRaw === 0) {
    if (tx.nativeTransfers) {
      for (const nt of tx.nativeTransfers) {
        if (nt.fromUserAccount === targetWallet) {
          quoteAssetMint = 'So11111111111111111111111111111111111111112';
          quoteOutflowRaw += nt.amount;
        }
      }
    }

    if (tx.tokenTransfers) {
      for (const tt of tx.tokenTransfers) {
        // Quote asset outflow
        if (tt.fromUserAccount === targetWallet && isQuoteAsset('solana', tt.mint)) {
          quoteAssetMint = tt.mint;
          quoteOutflowRaw += Math.round(tt.tokenAmount * 1e6); // Standard SPL stable decimal
        }
        // Token inflow (non-quote)
        if (tt.toUserAccount === targetWallet && !isQuoteAsset('solana', tt.mint)) {
          boughtTokenMint = tt.mint;
          boughtTokenAmount = tt.tokenAmount.toString();
        }
      }
    }
  }

  // 4. Verification rules
  if (!boughtTokenMint) {
    return {
      isBuy: false,
      ignoredReason: 'No non-quote target token received by wallet (plain transfer, sell, or stable swap)',
    };
  }

  if (quoteOutflowRaw <= 0) {
    return {
      isBuy: false,
      ignoredReason: 'No quote asset outflow detected (airdrop, mint, or wallet-to-wallet transfer)',
    };
  }

  // 5. USD Value computation from quote asset outflow
  const { usdValue, quoteSymbol, formattedAmount } = computeQuoteUsdValue(
    'solana',
    quoteAssetMint,
    quoteOutflowRaw,
    options.priceContext
  );

  // 6. Minimum buy threshold check
  if (usdValue < minBuyUsd) {
    return {
      isBuy: false,
      ignoredReason: `Buy size below threshold ($${usdValue.toLocaleString()} < $${minBuyUsd.toLocaleString()})`,
    };
  }

  // Check if adding to existing position
  const isAddToPosition =
    options.existingPositionUsd != null && options.existingPositionUsd >= 5000;

  const buy: DetectedBuy = {
    chain: 'solana',
    txId: tx.signature,
    logIndex: 0,
    walletAddress: targetWallet,
    tokenAddress: boughtTokenMint,
    tokensBought: boughtTokenAmount,
    tokenDecimals,
    quoteAsset: quoteSymbol,
    quoteAmount: formattedAmount,
    usdValue,
    blockTime: new Date(tx.timestamp * 1000),
    rawRef: tx.signature,
    isAddToPosition,
  };

  return { isBuy: true, buy };
}
