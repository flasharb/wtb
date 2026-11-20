import { db, pool } from '../db/index.js';
import { launchCandidates } from '../db/schema.js';
import { inArray, desc } from 'drizzle-orm';

// Look at every token we've called (or rejected as rugged) and its safety profile,
// to find what separates the duds/rugs from the performers.
const rows = await db
  .select()
  .from(launchCandidates)
  .where(inArray(launchCandidates.status, ['alerted', 'closed']))
  .orderBy(desc(launchCandidates.alertedAt));

console.log(`calls+closed: ${rows.length}\n`);
console.log('symbol      status   peak   holders  top10%  liq$      dex          fade  reject');
for (const r of rows) {
  const sj: any = r.safetyJson || {};
  console.log(
    `${(r.symbol || '?').padEnd(11)} ${(r.status || '').padEnd(8)} ${Number(r.peakMultiple).toFixed(2).padStart(5)} ` +
      `${String(r.holderCount).padStart(7)} ${Number(r.top10Pct).toFixed(1).padStart(6)} ` +
      `${String(Math.round(Number(r.liquidityUsd))).padStart(8)} ${(r.dex || '').padEnd(12)} ` +
      `${r.reportedFade ? 'Y' : '-'}    ${r.rejectReason || ''}`
  );
}

// Aggregate: performers (peak>=1.5x) vs duds (peak<1.1x or faded/closed)
const perf = rows.filter((r) => Number(r.peakMultiple) >= 1.5);
const duds = rows.filter((r) => Number(r.peakMultiple) < 1.1 || r.reportedFade || r.status === 'closed');
const avg = (a: any[], f: (x: any) => number) => (a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(1) : 'n/a');
console.log(`\nPERFORMERS (${perf.length}): avg top10 ${avg(perf, (r) => Number(r.top10Pct))}% · avg holders ${avg(perf, (r) => r.holderCount)} · avg liq $${avg(perf, (r) => Number(r.liquidityUsd))}`);
console.log(`DUDS/RUGS (${duds.length}):  avg top10 ${avg(duds, (r) => Number(r.top10Pct))}% · avg holders ${avg(duds, (r) => r.holderCount)} · avg liq $${avg(duds, (r) => Number(r.liquidityUsd))}`);
await pool.end().catch(() => {});
