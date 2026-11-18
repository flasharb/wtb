import { CandidateWallet, FilterResult } from './types.js';
import { config } from '../../config/index.js';

export interface FilterThresholds {
  minWalletUsd: number;
  minSwaps30d: number;
  maxSwapsPerDay: number;
  walletCap: number;
  /** Upper balance bound: wallets above this are likely CEX / market-maker / treasury, not traders. */
  maxWalletUsd?: number;
}

export function evaluateWallet(
  wallet: CandidateWallet,
  thresholds: FilterThresholds = {
    minWalletUsd: config.MIN_WALLET_USD,
    minSwaps30d: config.MIN_SWAPS_30D,
    maxSwapsPerDay: config.MAX_SWAPS_PER_DAY,
    walletCap: config.MVP_WALLET_CAP,
  }
): FilterResult {
  // 1. Balance Filter: Native + Stablecoin USD balance >= MIN_WALLET_USD ($100k)
  if (wallet.estUsdBalance < thresholds.minWalletUsd) {
    return {
      passed: false,
      failedReason: `Insufficient USD balance ($${wallet.estUsdBalance.toLocaleString()} < $${thresholds.minWalletUsd.toLocaleString()})`,
      score: 0,
    };
  }

  // 1b. Upper Balance Bound: exclude exchange / market-maker / treasury-scale holders.
  if (thresholds.maxWalletUsd && wallet.estUsdBalance > thresholds.maxWalletUsd) {
    return {
      passed: false,
      failedReason: `Balance too large — likely CEX/MM/treasury ($${wallet.estUsdBalance.toLocaleString()} > $${thresholds.maxWalletUsd.toLocaleString()})`,
      score: 0,
    };
  }

  // 2. Activity Floor: At least MIN_SWAPS_30D in last 30 days
  if (wallet.swaps30d < thresholds.minSwaps30d) {
    return {
      passed: false,
      failedReason: `Too few swaps in 30d (${wallet.swaps30d} < ${thresholds.minSwaps30d})`,
      score: 0,
    };
  }

  // 3. Activity Ceiling: No more than MAX_SWAPS_PER_DAY (credit budget & bot protection)
  if (wallet.avgSwapsPerDay > thresholds.maxSwapsPerDay) {
    return {
      passed: false,
      failedReason: `Exceeds max swaps/day (${wallet.avgSwapsPerDay} > ${thresholds.maxSwapsPerDay})`,
      score: 0,
    };
  }

  // 4. Exclude Non-Targets
  if (wallet.isExchangeOrBridge) {
    return {
      passed: false,
      failedReason: 'Excluded: Exchange / Bridge hot wallet',
      score: 0,
    };
  }

  if (wallet.chain === 'ethereum' && wallet.isContract) {
    return {
      passed: false,
      failedReason: 'Excluded: Ethereum smart contract account',
      score: 0,
    };
  }

  if (wallet.isBot) {
    return {
      passed: false,
      failedReason: 'Excluded: High-frequency / arbitrage bot pattern',
      score: 0,
    };
  }

  // 5. Ranking Real Traders
  // Score formula favoring:
  // - distinct tokens traded (diversity of bets)
  // - holding periods of hours to days (not second-level HFT)
  // - balance scaling
  const tokenDiversityScore = Math.min(wallet.distinctTokensCount * 5, 40); // max 40 pts
  const holdingPeriodScore =
    wallet.avgHoldingHours >= 1 && wallet.avgHoldingHours <= 720
      ? Math.min(wallet.avgHoldingHours * 2, 40) // max 40 pts
      : 10;
  const balanceFactor = Math.min((wallet.estUsdBalance / 100000) * 2, 20); // max 20 pts

  const score = Math.round(tokenDiversityScore + holdingPeriodScore + balanceFactor);

  return {
    passed: true,
    score,
  };
}

export function selectTopWhales(
  candidates: CandidateWallet[],
  thresholds: FilterThresholds = {
    minWalletUsd: config.MIN_WALLET_USD,
    minSwaps30d: config.MIN_SWAPS_30D,
    maxSwapsPerDay: config.MAX_SWAPS_PER_DAY,
    walletCap: config.MVP_WALLET_CAP,
  }
): { selected: Array<CandidateWallet & { score: number }>; rejected: Array<{ wallet: CandidateWallet; reason: string }> } {
  const passed: Array<CandidateWallet & { score: number }> = [];
  const rejected: Array<{ wallet: CandidateWallet; reason: string }> = [];

  for (const wallet of candidates) {
    const result = evaluateWallet(wallet, thresholds);
    if (result.passed) {
      passed.push({ ...wallet, score: result.score });
    } else {
      rejected.push({ wallet, reason: result.failedReason || 'Unknown rejection' });
    }
  }

  // Sort descending by trader quality score
  passed.sort((a, b) => b.score - a.score);

  // Take top MVP_WALLET_CAP
  const selected = passed.slice(0, thresholds.walletCap);

  return { selected, rejected };
}
