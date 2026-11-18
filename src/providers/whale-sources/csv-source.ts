import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { CandidateWallet, Chain, WhaleSource } from './types.js';

export class CsvWhaleSource implements WhaleSource {
  name = 'csv';

  async fetchCandidates(chain: Chain, filePath?: string): Promise<CandidateWallet[]> {
    const targetPath =
      filePath ||
      path.join(
        process.cwd(),
        'data',
        'seeds',
        chain === 'solana' ? 'sol_wallets.csv' : 'eth_wallets.csv'
      );

    if (!fs.existsSync(targetPath)) {
      throw new Error(`CSV file not found at: ${targetPath}`);
    }

    const content = fs.readFileSync(targetPath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const candidates: CandidateWallet[] = records.map((row: any) => {
      const swaps30d = Number(row.swaps_30d || row.swaps30d || 0);
      const avgSwapsPerDay = Number(
        row.avg_swaps_per_day || row.avgSwapsPerDay || (swaps30d / 30).toFixed(2)
      );

      return {
        chain,
        address: (row.address || '').trim(),
        estUsdBalance: Number(row.est_usd_balance || row.estUsdBalance || 0),
        swaps30d,
        avgSwapsPerDay,
        distinctTokensCount: Number(row.distinct_tokens || row.distinctTokensCount || 1),
        avgHoldingHours: Number(row.avg_holding_hours || row.avgHoldingHours || 24),
        label: row.label || undefined,
        category: row.category || 'whale',
        isContract: row.is_contract === 'true' || row.is_contract === '1',
        isExchangeOrBridge:
          row.is_exchange_or_bridge === 'true' || row.is_exchange_or_bridge === '1',
        isBot: row.is_bot === 'true' || row.is_bot === '1',
      };
    });

    return candidates.filter((c) => c.address.length > 0);
  }
}
