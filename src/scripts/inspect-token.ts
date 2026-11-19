import { db, pool } from '../db/index.js';
import { launchCandidates } from '../db/schema.js';
import { and, ilike, eq } from 'drizzle-orm';

const sym = process.argv[2] || 'VTC';
const onlyAlerted = process.argv.includes('--alerted');
const where = onlyAlerted ? and(ilike(launchCandidates.symbol, sym), eq(launchCandidates.status, 'alerted')) : ilike(launchCandidates.symbol, sym);
const rows = await db.select().from(launchCandidates).where(where).limit(5);
for (const r of rows) {
  console.log(`\n${r.symbol} (${r.tokenAddress}) [${r.status}]`);
  console.log(`  our pool_created_at: ${r.poolCreatedAt?.toISOString()} -> age ${r.poolCreatedAt ? ((Date.now() - r.poolCreatedAt.getTime()) / 86400000).toFixed(1) : '?'}d`);
  console.log(`  dex: ${r.dex} | pool: ${r.poolAddress}`);
  // All DexScreener pairs for this mint, earliest pairCreatedAt = true token age
  try {
    const j: any = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${r.tokenAddress}`)).json();
    const pairs = (j.pairs || []).filter((p: any) => p.chainId === 'solana');
    const created = pairs.map((p: any) => p.pairCreatedAt).filter(Boolean).sort((a: number, b: number) => a - b);
    if (created.length) {
      console.log(`  DexScreener pairs: ${pairs.length}, earliest pairCreatedAt: ${new Date(created[0]).toISOString()} -> age ${((Date.now() - created[0]) / 86400000).toFixed(1)}d`);
      pairs.forEach((p: any) => console.log(`    - ${p.dexId} ${p.pairAddress?.slice(0, 8)} created ${p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : 'n/a'} liq $${Math.round(p.liquidity?.usd || 0)}`));
    }
  } catch (e: any) {
    console.log('  dexscreener err', e.message);
  }
}
await pool.end().catch(() => {});
