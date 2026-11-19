import { db, pool } from '../db/index.js';
import { launchCandidates } from '../db/schema.js';
import { eq, gte, lte, and, sql, desc } from 'drizzle-orm';
import { config } from '../config/index.js';

const since = (h: number) => new Date(Date.now() - h * 3600000);
const count = async (where: any) =>
  (await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(launchCandidates).where(where))[0].n;

const windowOldest = new Date(Date.now() - config.SCAN_MAX_AGE_DAYS * 86400000);
const windowNewest = new Date(Date.now() - config.SCAN_MIN_AGE_DAYS * 86400000);
const W = (extra: any[] = []) =>
  and(
    eq(launchCandidates.status, 'watching'),
    lte(launchCandidates.poolCreatedAt, windowNewest),
    gte(launchCandidates.poolCreatedAt, windowOldest),
    ...extra
  );

console.log('--- status counts ---');
console.log('alerted total:', await count(eq(launchCandidates.status, 'alerted')));
console.log('alerted 24h:', await count(and(eq(launchCandidates.status, 'alerted'), gte(launchCandidates.alertedAt, since(24)))));
console.log('watching:', await count(eq(launchCandidates.status, 'watching')));
console.log('rejected:', await count(eq(launchCandidates.status, 'rejected')));
console.log('closed:', await count(eq(launchCandidates.status, 'closed')));

console.log(`\n--- eligibility funnel (window ${config.SCAN_MIN_AGE_DAYS}-${config.SCAN_MAX_AGE_DAYS}d) ---`);
console.log('watching in age-window:', await count(W()));
console.log(`  + liq >= $${config.SCAN_MIN_LIQUIDITY_USD}:`, await count(W([gte(launchCandidates.liquidityUsd, config.SCAN_MIN_LIQUIDITY_USD.toString())])));
console.log(
  `  + vol >= $${config.SCAN_MIN_VOLUME_24H_USD} (fully eligible):`,
  await count(W([gte(launchCandidates.liquidityUsd, config.SCAN_MIN_LIQUIDITY_USD.toString()), gte(launchCandidates.volume24hUsd, config.SCAN_MIN_VOLUME_24H_USD.toString())]))
);

console.log('\n--- age distribution of all watching ---');
const buckets = await db
  .select({
    lt7: sql<number>`count(*) filter (where pool_created_at > ${windowNewest})`.mapWith(Number),
    inWin: sql<number>`count(*) filter (where pool_created_at <= ${windowNewest} and pool_created_at >= ${windowOldest})`.mapWith(Number),
    gt30: sql<number>`count(*) filter (where pool_created_at < ${windowOldest})`.mapWith(Number),
    noDate: sql<number>`count(*) filter (where pool_created_at is null)`.mapWith(Number),
  })
  .from(launchCandidates)
  .where(eq(launchCandidates.status, 'watching'));
console.log('<7d (too young):', buckets[0].lt7, '| in 7-30d window:', buckets[0].inWin, '| >30d:', buckets[0].gt30, '| no date:', buckets[0].noDate);

console.log('\n--- last-checked recency (in-window watching) ---');
const lastChecked = await db
  .select({ addr: launchCandidates.tokenAddress, sym: launchCandidates.symbol, liq: launchCandidates.liquidityUsd, vol: launchCandidates.volume24hUsd, lc: launchCandidates.lastCheckedAt })
  .from(launchCandidates)
  .where(W())
  .orderBy(desc(launchCandidates.liquidityUsd))
  .limit(8);
lastChecked.forEach((r) => console.log(`  ${(r.sym || '?').padEnd(10)} liq $${Math.round(Number(r.liq))} vol $${Math.round(Number(r.vol))} checked=${r.lc ? new Date(r.lc).toISOString() : 'never'}`));

await pool.end().catch(() => {});
