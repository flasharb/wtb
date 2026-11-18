export type Chain = 'solana' | 'ethereum';

export interface DetectedBuy {
  chain: Chain;
  txId: string;
  logIndex: number;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  tokensBought: string;
  quoteAsset: string;
  quoteAmount: string;
  usdValue: number;
  blockTime: Date;
  rawRef?: string;
  isAddToPosition?: boolean;
}

export interface ClassificationResult {
  isBuy: boolean;
  ignoredReason?: string;
  buy?: DetectedBuy;
}
