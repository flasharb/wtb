/**
 * prune-synthetic — remove seed wallets that did NOT come from a given source.
 *
 * The initial repo shipped synthetic sample wallets (source 'csv', fabricated addresses).
 * Once a real source (e.g. 'onchain') has seeded a chain, run this to drop the placeholders so
 * only real wallets are synced to provider webhooks. wallet_labels and buys cascade on delete.
 *
 * Optionally also excludes kept-source wallets whose balance is CEX/MM/treasury-scale
 * (--exclude-above <usd>): they are marked is_excluded=true (kept in DB, dropped from the watch list).
 *
 * Usage:
 *   tsx src/scripts/prune-synthetic.ts --chain solana --keep onchain          # dry run (counts only)
 *   tsx src/scripts/prune-synthetic.ts --chain solana --keep onchain --exclude-above 25000000 --confirm
 */
import { db, pool } from '../db/index.js';
import { wallets } from '../db/schema.js';
import { and, eq, ne, gt, sql, desc } from 'drizzle-orm';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : def;
}

async function main() {
  const chain = arg('chain', 'solana')!;
  const keep = arg('keep', 'onchain')!;
  const excludeAbove = arg('exclude-above') ? Number(arg('exclude-above')) : undefined;
  const confirm = process.argv.includes('--confirm');

  const [keepRow] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)
    .where(and(eq(wallets.chain, chain), eq(wallets.source, keep)));
  const [dropRow] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)
    .where(and(eq(wallets.chain, chain), ne(wallets.source, keep)));

  console.log(`Chain '${chain}': keep source='${keep}' → ${keepRow.n} wallets; would delete ${dropRow.n} others.`);

  if (keepRow.n === 0) {
    console.error(`❌ Refusing to prune: 0 wallets from source '${keep}' exist. Seed real wallets first.`);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  if (excludeAbove) {
    const [cexRow] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(wallets)
      .where(and(eq(wallets.chain, chain), eq(wallets.source, keep), gt(wallets.estUsdBalance, String(excludeAbove))));
    console.log(`Would exclude ${cexRow.n} '${keep}' wallets over $${excludeAbove.toLocaleString()} (likely CEX/MM/treasury).`);
  }

  if (!confirm) {
    console.log('[DRY RUN] Pass --confirm to apply. No changes made.');
    await pool.end().catch(() => {});
    return;
  }

  if (excludeAbove) {
    const excluded = await db
      .update(wallets)
      .set({ isExcluded: true })
      .where(and(eq(wallets.chain, chain), eq(wallets.source, keep), gt(wallets.estUsdBalance, String(excludeAbove))))
      .returning({ id: wallets.id });
    console.log(`✅ Excluded ${excluded.length} CEX/MM/treasury-scale wallets from the watch list.`);
  }

  const deleted = await db
    .delete(wallets)
    .where(and(eq(wallets.chain, chain), ne(wallets.source, keep)))
    .returning({ id: wallets.id });
  console.log(`✅ Deleted ${deleted.length} non-'${keep}' ${chain} wallets (labels + buys cascaded).`);

  // Final watch list (active, non-excluded)
  const [activeRow] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(wallets)
    .where(and(eq(wallets.chain, chain), eq(wallets.isExcluded, false)));
  const top = await db
    .select({ address: wallets.address, bal: wallets.estUsdBalance, spd: wallets.avgSwapsPerDay, score: wallets.qualityScore })
    .from(wallets)
    .where(and(eq(wallets.chain, chain), eq(wallets.isExcluded, false)))
    .orderBy(desc(wallets.qualityScore))
    .limit(10);
  console.log(`\n🐋 Final ${chain} watch list: ${activeRow.n} active wallets. Top 10:`);
  top.forEach((w, i) =>
    console.log(`   ${i + 1}. ${w.address.slice(0, 12)}… | $${Number(w.bal).toLocaleString()} | ${w.spd}/day | score ${Math.round(w.score)}`)
  );

  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
