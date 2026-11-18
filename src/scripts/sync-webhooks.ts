import { HeliusWebhookManager } from '../providers/helius/webhook-manager.js';
import { AlchemyWebhookManager } from '../providers/alchemy/webhook-manager.js';
import { CsvWhaleSource } from '../providers/whale-sources/csv-source.js';
import { selectTopWhales } from '../providers/whale-sources/filter-engine.js';
import { db, pool } from '../db/index.js';
import { wallets } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../config/index.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chain: 'all' as 'sol' | 'eth' | 'all',
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain' && args[i + 1]) {
      options.chain = args[i + 1] as any;
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

async function getActiveAddresses(chain: 'solana' | 'ethereum'): Promise<string[]> {
  try {
    // Try reading active non-excluded wallets from DB
    const rows = await db
      .select({ address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.chain, chain), eq(wallets.isExcluded, false)));

    if (rows.length > 0) {
      return rows.map((r) => r.address);
    }
  } catch (err: any) {
    console.log(`[DB Warning] Could not query database (${err.message}). Falling back to seed CSV files...`);
  }

  // Fallback to reading and filtering seed CSV
  const source = new CsvWhaleSource();
  const candidates = await source.fetchCandidates(chain);
  const { selected } = selectTopWhales(candidates, {
    minWalletUsd: config.MIN_WALLET_USD,
    minSwaps30d: config.MIN_SWAPS_30D,
    maxSwapsPerDay: config.MAX_SWAPS_PER_DAY,
    walletCap: config.MVP_WALLET_CAP,
  });

  return selected.map((s) => s.address);
}

async function main() {
  const { chain, dryRun } = parseArgs();
  console.log(`\n======================================================`);
  console.log(`🔄 Webhook Address List Synchronization`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (Preview Only)' : 'LIVE EXECUTION'}`);
  console.log(`======================================================`);

  if (chain === 'sol' || chain === 'all') {
    console.log(`\n[Solana / Helius] Syncing whale addresses...`);
    const solAddresses = await getActiveAddresses('solana');
    console.log(`Target Address Count: ${solAddresses.length} addresses`);

    if (dryRun) {
      console.log(`[DRY RUN] Would sync ${solAddresses.length} addresses to Helius enhanced webhook.`);
      console.log(`Target Webhook URL: ${config.PUBLIC_BASE_URL || 'http://localhost:3000'}/hooks/helius`);
      console.log(`Estimated API Credit Cost: 100 credits (if address list changed, 0 if unchanged).`);
    } else {
      if (!config.HELIUS_API_KEY) {
        console.warn(`⚠️ HELIUS_API_KEY not configured. Skipping live Helius sync.`);
      } else {
        const heliusManager = new HeliusWebhookManager();
        const result = await heliusManager.syncWebhook(solAddresses);
        console.log(`✅ Helius Sync Result: Action=${result.action}, WebhookId=${result.webhookId}, Addresses=${result.addressCount}`);
      }
    }
  }

  if (chain === 'eth' || chain === 'all') {
    console.log(`\n[Ethereum / Alchemy] Syncing whale addresses...`);
    const ethAddresses = await getActiveAddresses('ethereum');
    console.log(`Target Address Count: ${ethAddresses.length} addresses`);

    if (dryRun) {
      console.log(`[DRY RUN] Would sync ${ethAddresses.length} addresses to Alchemy address activity webhook.`);
      console.log(`Target Webhook URL: ${config.PUBLIC_BASE_URL || 'http://localhost:3000'}/hooks/alchemy`);
    } else {
      if (!config.ALCHEMY_AUTH_TOKEN) {
        console.warn(`⚠️ ALCHEMY_AUTH_TOKEN not configured. Skipping live Alchemy sync.`);
      } else {
        const alchemyManager = new AlchemyWebhookManager();
        const result = await alchemyManager.syncWebhook(ethAddresses);
        console.log(`✅ Alchemy Sync Result: Action=${result.action}, WebhookId=${result.webhookId}, Addresses=${result.addressCount}`);
      }
    }
  }

  console.log(`\n🎉 Webhook sync process finished.`);
  await pool.end().catch(() => {});
}

main();
