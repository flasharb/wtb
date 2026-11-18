import { CandidateWallet, Chain, WhaleSource } from './types.js';
import { config } from '../../config/index.js';

/**
 * Dune Whale Source (Optional / Pluggable)
 * Kept behind the same WhaleSource interface if a paid Dune API key is provided.
 */
export class DuneWhaleSource implements WhaleSource {
  name = 'dune';

  async fetchCandidates(chain: Chain): Promise<CandidateWallet[]> {
    if (!config.DUNE_API_KEY) {
      console.warn('[DuneWhaleSource] No DUNE_API_KEY found in configuration.');
      return [];
    }

    console.log(`[DuneWhaleSource] Querying Dune API for ${chain} whales...`);
    // Query Dune execution API endpoint: https://api.dune.com/api/v1/query/{query_id}/results
    return [];
  }
}
