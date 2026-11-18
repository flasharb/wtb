import { ClassificationResult, DetectedBuy } from './types.js';
import { ERC20_TRANSFER_EVENT_TOPIC, isQuoteAsset } from './constants.js';
import { computeQuoteUsdValue, QuotePriceContext } from './quote-pricing.js';
import { config } from '../config/index.js';

export interface EthereumLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

export interface EthereumTxPayload {
  hash: string;
  from: string;
  to: string | null;
  value: string | bigint; // Wei (hex string or bigint)
  status?: number; // 1 = success, 0 = failed
  blockNumber: number;
  blockTimestamp: number;
  logs: EthereumLog[];
  internalTransfers?: Array<{
    from: string;
    to: string;
    value: string | bigint;
  }>;
}

export function classifyEthereumTx(
  tx: EthereumTxPayload,
  watchedWallet: string,
  options: {
    minBuyUsd?: number;
    priceContext?: QuotePriceContext;
    existingPositionUsd?: number;
  } = {}
): ClassificationResult {
  const minBuyUsd = options.minBuyUsd ?? config.MIN_BUY_USD;
  const targetWallet = watchedWallet.trim().toLowerCase();

  // 1. Transaction status check (0 = reverted/failed)
  if (tx.status === 0) {
    return { isBuy: false, ignoredReason: 'Transaction failed (reverted on-chain)' };
  }

  // 2. Net asset flow accumulator: address (or 'ETH') -> net balance delta
  const netFlows = new Map<string, bigint>();

  const adjustFlow = (asset: string, delta: bigint) => {
    const key = asset.toLowerCase();
    const current = netFlows.get(key) || 0n;
    netFlows.set(key, current + delta);
  };

  // Process Native ETH flow
  const rawNativeValue = typeof tx.value === 'string'
    ? (tx.value.startsWith('0x') ? BigInt(tx.value) : BigInt(tx.value || '0'))
    : BigInt(tx.value || 0n);

  if (rawNativeValue > 0n) {
    if (tx.from.toLowerCase() === targetWallet) {
      adjustFlow('0x0000000000000000000000000000000000000000', -rawNativeValue);
    }
    if (tx.to && tx.to.toLowerCase() === targetWallet) {
      adjustFlow('0x0000000000000000000000000000000000000000', rawNativeValue);
    }
  }

  // Process Internal transfers if available
  if (tx.internalTransfers) {
    for (const it of tx.internalTransfers) {
      const itVal = typeof it.value === 'string'
        ? (it.value.startsWith('0x') ? BigInt(it.value) : BigInt(it.value || '0'))
        : BigInt(it.value || 0n);
      if (it.from.toLowerCase() === targetWallet) {
        adjustFlow('0x0000000000000000000000000000000000000000', -itVal);
      }
      if (it.to.toLowerCase() === targetWallet) {
        adjustFlow('0x0000000000000000000000000000000000000000', itVal);
      }
    }
  }

  // Process ERC-20 Transfer logs
  let latestLogIndex = 0;
  for (const log of tx.logs) {
    latestLogIndex = Math.max(latestLogIndex, log.logIndex);

    if (
      log.topics[0]?.toLowerCase() === ERC20_TRANSFER_EVENT_TOPIC.toLowerCase() &&
      log.topics.length >= 3
    ) {
      const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
      const tokenContract = log.address.toLowerCase();

      let transferAmount = 0n;
      try {
        transferAmount = BigInt(log.data && log.data !== '0x' ? log.data : '0x0');
      } catch {
        transferAmount = 0n;
      }

      if (fromAddr === targetWallet) {
        adjustFlow(tokenContract, -transferAmount);
      }
      if (toAddr === targetWallet) {
        adjustFlow(tokenContract, transferAmount);
      }
    }
  }

  // 3. Classify flows
  let quoteOutflowAddress = '';
  let quoteOutflowAmount = 0n;
  let boughtTokenAddress = '';
  let boughtTokenAmount = 0n;

  for (const [asset, delta] of netFlows.entries()) {
    if (delta < 0n && isQuoteAsset('ethereum', asset)) {
      // Wallet spent quote asset
      const outflow = -delta;
      if (outflow > quoteOutflowAmount) {
        quoteOutflowAmount = outflow;
        quoteOutflowAddress = asset;
      }
    } else if (delta > 0n && !isQuoteAsset('ethereum', asset)) {
      // Wallet received non-quote token
      if (delta > boughtTokenAmount) {
        boughtTokenAmount = delta;
        boughtTokenAddress = asset;
      }
    }
  }

  // 4. Verification rules
  if (!boughtTokenAddress) {
    return {
      isBuy: false,
      ignoredReason: 'No non-quote target token received by wallet (plain transfer, sell, or stable swap)',
    };
  }

  if (quoteOutflowAmount <= 0n) {
    return {
      isBuy: false,
      ignoredReason: 'No quote asset outflow detected (airdrop, mint, or wallet-to-wallet transfer)',
    };
  }

  // 5. Compute USD Value from quote asset side
  const { usdValue, quoteSymbol, formattedAmount } = computeQuoteUsdValue(
    'ethereum',
    quoteOutflowAddress,
    quoteOutflowAmount,
    options.priceContext
  );

  // 6. Minimum buy USD threshold check
  if (usdValue < minBuyUsd) {
    return {
      isBuy: false,
      ignoredReason: `Buy size below threshold ($${usdValue.toLocaleString()} < $${minBuyUsd.toLocaleString()})`,
    };
  }

  const isAddToPosition =
    options.existingPositionUsd != null && options.existingPositionUsd >= 5000;

  const buy: DetectedBuy = {
    chain: 'ethereum',
    txId: tx.hash,
    logIndex: latestLogIndex,
    walletAddress: targetWallet,
    tokenAddress: boughtTokenAddress,
    tokensBought: boughtTokenAmount.toString(),
    quoteAsset: quoteSymbol,
    quoteAmount: formattedAmount,
    usdValue,
    blockTime: new Date(tx.blockTimestamp * 1000),
    rawRef: tx.hash,
    isAddToPosition,
  };

  return { isBuy: true, buy };
}
