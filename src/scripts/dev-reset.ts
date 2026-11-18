/**
 * dev-reset — show counts, and optionally wipe pre-production activity
 * (buys / signals / outcomes / alerts) for a clean slate. Wallets & chats are kept.
 *
 *   tsx src/scripts/dev-reset.ts              # counts only
 *   tsx src/scripts/dev-reset.ts --confirm    # wipe activity tables
 */
import { db, pool } from '../db/index.js';
import { buys, signals, signalOutcomes, alertsSent, wallets, tokens } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const confirm = process.argv.includes('--confirm');

const [sol] = await db
  .select({ n: sql<number>`count(*)`.mapWith(Number) })
  .from(wallets)
  .where(and(eq(wallets.chain, 'solana'), eq(wallets.isExcluded, false)));
const [b] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(buys);
const [tk] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(tokens);
console.log(`Solana active wallets: ${sol.n}`);
console.log(`Buys: ${b.n} · Tokens: ${tk.n}`);

if (confirm) {
  await db.delete(alertsSent);
  await db.delete(signalOutcomes);
  await db.delete(signals);
  await db.delete(buys);
  console.log('✅ Wiped buys, signals, outcomes, alerts. Wallets & chats kept.');
} else {
  console.log('[DRY RUN] Pass --confirm to wipe activity tables.');
}

await pool.end().catch(() => {});
