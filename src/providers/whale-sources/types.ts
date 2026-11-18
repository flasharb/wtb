export type Chain = 'solana' | 'ethereum';

export interface CandidateWallet {
  chain: Chain;
  address: string;
  estUsdBalance: number;
  swaps30d: number;
  avgSwapsPerDay: number;
  distinctTokensCount: number;
  avgHoldingHours: number;
  label?: string;
  category?: string; // 'fund' | 'smart_money' | 'kol' | 'whale'
  isContract?: boolean;
  isExchangeOrBridge?: boolean;
  isBot?: boolean;
}

export interface FilterResult {
  passed: boolean;
  failedReason?: string;
  score: number;
}

export interface WhaleSource {
  name: string;
  fetchCandidates(chain: Chain, filePath?: string): Promise<CandidateWallet[]>;
}
