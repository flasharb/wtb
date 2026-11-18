import { CsvWhaleSource } from '../providers/whale-sources/csv-source.js';
import { BigQueryWhaleSource } from '../providers/whale-sources/bigquery-source.js';
import { DuneWhaleSource } from '../providers/whale-sources/dune-source.js';
import { OnchainSolanaSource } from '../providers/whale-sources/onchain-solana-source.js';
import { selectTopWhales } from '../providers/whale-sources/filter-engine.js';
import { Chain, WhaleSource } from '../providers/whale-sources/types.js';
import { config } from '../config/index.js';
import { db, pool } from '../db/index.js';
import { wallets, walletLabels } from '../db/schema.js';
import { sql } from 'drizzle-orm';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chain: 'all' as 'sol' | 'eth' | 'all',
    source: 'csv' as 'csv' | 'bigquery' | 'dune' | 'onchain',
    filePath: undefined as string | undefined,
    dryRun: false,
    cap: config.MVP_WALLET_CAP,
    minUsd: config.MIN_WALLET_USD,
    maxSwaps: config.MAX_SWAPS_PER_DAY,
    maxUsd: undefined as number | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chain' && args[i + 1]) {
      options.chain = args[i + 1] as any;
      i++;
    } else if (args[i] === '--source' && args[i + 1]) {
      options.source = args[i + 1] as any;
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      options.filePath = args[i + 1];
      i++;
    } else if (args[i] === '--cap' && args[i + 1]) {
      options.cap = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--min-usd' && args[i + 1]) {
      options.minUsd = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--max-swaps' && args[i + 1]) {
      options.maxSwaps = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--max-usd' && args[i + 1]) {
      options.maxUsd = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function getSource(sourceName: string): WhaleSource {
  switch (sourceName) {
    case 'bigquery':
      return new BigQueryWhaleSource();
    case 'dune':
      return new DuneWhaleSource();
    case 'onchain':
      return new OnchainSolanaSource();
    case 'csv':
    default:
      return new CsvWhaleSource();
  }
}

async function seedChain(
  chain: Chain,
  source: WhaleSource,
  filePath?: string,
  cap?: number,
  dryRun: boolean = false,
  minUsd: number = config.MIN_WALLET_USD,
  maxSwaps: number = config.MAX_SWAPS_PER_DAY,
  maxUsd?: number
) {
  console.log(`\n======================================================`);
  console.log(`🚀 Seeding Whales for [${chain.toUpperCase()}] via source: ${source.name}`);
  console.log(`======================================================`);

  const candidates = await source.fetchCandidates(chain, filePath);
  console.log(`📥 Loaded ${candidates.length} raw candidates from ${source.name}`);

  const thresholds = {
    minWalletUsd: minUsd,
    minSwaps30d: config.MIN_SWAPS_30D,
    maxSwapsPerDay: maxSwaps,
    walletCap: cap || config.MVP_WALLET_CAP,
    maxWalletUsd: maxUsd,
  };

  const { selected, rejected } = selectTopWhales(candidates, thresholds);

  console.log(`\n📊 Filter Evaluation Results:`);
  console.log(`   - Raw Candidates Evaluated: ${candidates.length}`);
  console.log(`   - Rejected by Filters: ${rejected.length}`);
  console.log(`   - Selected Top Whales: ${selected.length} (Cap: ${thresholds.walletCap})`);

  if (rejected.length > 0) {
    console.log(`\n🚫 Rejection Samples:`);
    rejected.slice(0, 5).forEach((r) => {
      console.log(`   - ${r.wallet.address.slice(0, 16)}... : ${r.reason}`);
    });
  }

  if (selected.length > 0) {
    console.log(`\n⭐ Top 5 Selected Whales by Trader Score:`);
    selected.slice(0, 5).forEach((w, idx) => {
      console.log(
        `   ${idx + 1}. ${w.address.slice(0, 16)}... | Score: ${w.score} | Bal: $${w.estUsdBalance.toLocaleString()} | Swaps/Day: ${w.avgSwapsPerDay} | Label: ${w.label || 'None'}`
      );
    });
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Skipping database upsert.`);
    return selected.length;
  }

  // Database Upsert in Batches of 50
  console.log(`\n💾 Persisting ${selected.length} whales into PostgreSQL (in batches)...`);
  let upsertedCount = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < selected.length; i += BATCH_SIZE) {
    const batch = selected.slice(i, i + BATCH_SIZE);
    const walletValues = batch.map((item, idx) => ({
      chain,
      address: item.address,
      rank: i + idx + 1,
      tier: i + idx < 50 ? 'elite' : 'active',
      qualityScore: item.score,
      isExcluded: false,
      source: source.name,
      avgSwapsPerDay: item.avgSwapsPerDay,
      estUsdBalance: item.estUsdBalance.toString(),
      isBotFlagged: false,
      selectedAt: new Date(),
      updatedAt: new Date(),
    }));

    try {
      const insertedRows = await db
        .insert(wallets)
        .values(walletValues)
        .onConflictDoUpdate({
          target: [wallets.chain, wallets.address],
          set: {
            rank: sql`excluded.rank`,
            qualityScore: sql`excluded.quality_score`,
            avgSwapsPerDay: sql`excluded.avg_swaps_per_day`,
            estUsdBalance: sql`excluded.est_usd_balance`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: wallets.id, address: wallets.address });

      // Save labels
      const idMap = new Map(insertedRows.map((r) => [r.address, r.id]));
      for (const item of batch) {
        const walletId = idMap.get(item.address);
        if (walletId && item.label) {
          await db
            .insert(walletLabels)
            .values({
              walletId,
              label: item.label,
              category: item.category || 'whale',
              source: source.name,
            })
            .catch(() => {});
        }
      }

      upsertedCount += insertedRows.length;
      console.log(`   Saved batch: ${upsertedCount}/${selected.length}`);
    } catch (err: any) {
      console.error(`Error saving batch starting at index ${i}:`, err.message);
    }
  }

  console.log(`✅ Successfully saved ${upsertedCount} [${chain.toUpperCase()}] whales to PostgreSQL.`);
  return upsertedCount;
}

async function main() {
  const options = parseArgs();
  console.log(`Whale Seeder initiated with:`, options);

  const source = getSource(options.source);

  try {
    if (options.chain === 'sol' || options.chain === 'all') {
      await seedChain('solana', source, options.filePath, options.cap, options.dryRun, options.minUsd, options.maxSwaps, options.maxUsd);
    }
    if (options.chain === 'eth' || options.chain === 'all') {
      await seedChain('ethereum', source, options.filePath, options.cap, options.dryRun, options.minUsd, options.maxSwaps, options.maxUsd);
    }

    console.log(`\n🎉 Seeding pipeline completed successfully!`);
  } catch (err: any) {
    console.error(`\n❌ Seeding pipeline error:`, err.message || err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
