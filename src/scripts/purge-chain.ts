/**
 * purge-chain — remove all wallets (and, via cascade, their buys) for a chain.
 * Used to drop Ethereum test data for the Solana-only MVP.
 *
 *   tsx src/scripts/purge-chain.ts --chain ethereum            # dry run
 *   tsx src/scripts/purge-chain.ts --chain ethereum --confirm  # delete
 */
import { db, pool } from '../db/index.js';
import { wallets } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const chain = process.argv[process.argv.indexOf('--chain') + 1];
const confirm = process.argv.includes('--confirm');

if (!chain || chain.startsWith('--')) {
  console.error('Usage: purge-chain --chain <solana|ethereum> [--confirm]');
  process.exit(1);
}

const [row] = await db
  .select({ n: sql<number>`count(*)`.mapWith(Number) })
  .from(wallets)
  .where(eq(wallets.chain, chain));
console.log(`${chain}: ${row.n} wallets (buys cascade on delete).`);

if (!confirm) {
  console.log('[DRY RUN] Pass --confirm to delete.');
} else {
  const del = await db.delete(wallets).where(eq(wallets.chain, chain)).returning({ id: wallets.id });
  console.log(`✅ Deleted ${del.length} ${chain} wallets and their buys.`);
}

await pool.end().catch(() => {});
