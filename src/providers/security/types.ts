import { Chain } from '../../classify/types.js';

export interface CheckItem {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SafetyCheckResult {
  passed: boolean; // false if hard fail (suppresses alert)
  hardFailReason?: string;
  items: CheckItem[];
  buyTaxPct?: number;
  sellTaxPct?: number;
  isHoneypot?: boolean;
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  top10ConcentrationPct?: number;
  liquidityUsd: number;
  tokenAgeMinutes: number;
}

export interface SecurityChecker {
  evaluateToken(
    chain: Chain,
    tokenAddress: string,
    marketData: {
      liquidityUsd: number;
      pairCreatedAt?: Date;
      fdvUsd: number;
    },
    options?: {
      minLiquidityUsd?: number;
      minTokenAgeMin?: number;
      allowNewTokens?: boolean;
    }
  ): Promise<SafetyCheckResult>;
}
