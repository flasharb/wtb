import { Chain } from '../classify/types.js';

export interface BuyerSummary {
  walletId: number;
  walletAddress: string;
  label?: string;
  qualityScore: number;
  usdValue: number;
  blockTime: Date;
}

export interface EvaluatedSignal {
  shouldAlert: boolean;
  isUpdate: boolean; // True if an existing alert should be EDITED
  signalType: 'consensus' | 'high_conviction';
  chain: Chain;
  tokenId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  whaleCount: number;
  totalUsd: number;
  buyers: BuyerSummary[];
  signalReason: string;
  priceAtSignal: number;
  existingAlertMessageId?: number;
  existingSignalId?: number;
  suppressedReason?: string;
}
