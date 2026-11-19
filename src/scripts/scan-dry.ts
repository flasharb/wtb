// Dry run of the CURRENT strategy: discover + filter + safety + Birdeye holder gate. No DB/alerts.
import { GeckoTerminalSource } from '../providers/launches/geckoterminal-source.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { BirdeyeProvider } from '../providers/market/birdeye-provider.js';
import { config } from '../config/index.js';

const gecko = new GeckoTerminalSource();
const safety = new SolanaSafetyChecker();
const birdeye = new BirdeyeProvider();
const now = Date.now();
const maxMs = config.SCAN_MAX_AGE_DAYS * 86400000;
const minMs = config.SCAN_MIN_AGE_DAYS * 86400000;

const pools = await gecko.discover();
const inScope = pools.filter((p) => {
  if (!p.poolCreatedAt) return false;
  const age = now - p.poolCreatedAt.getTime();
  return age >= minMs && age <= maxMs && p.liquidityUsd >= config.SCAN_MIN_LIQUIDITY_USD && p.volume24hUsd >= config.SCAN_MIN_VOLUME_24H_USD;
});
console.log(`discovered ${pools.length} | in scope (age ${config.SCAN_MIN_AGE_DAYS}-${config.SCAN_MAX_AGE_DAYS}d, liq>=$${config.SCAN_MIN_LIQUIDITY_USD}, vol>=$${config.SCAN_MIN_VOLUME_24H_USD}): ${inScope.length}`);
console.log(`holder gate: >= ${config.SCAN_MIN_HOLDERS}\n`);

let calls = 0;
for (const p of inScope.slice(0, 20)) {
  const s = await safety.check(p.mint, { minHolders: 0, maxTop10Pct: config.SCAN_MAX_TOP10_PCT });
  const ageD = ((now - p.poolCreatedAt!.getTime()) / 86400000).toFixed(1);
  if (!s.passed) {
    console.log(`${(p.symbol || '?').padEnd(10)} ${ageD}d — SAFETY FAIL: ${s.reason}`);
    continue;
  }
  const ov = await birdeye.getOverview(p.mint);
  const holders = ov?.holder ?? 0;
  const pass = holders >= config.SCAN_MIN_HOLDERS;
  console.log(`${(p.symbol || '?').padEnd(10)} ${ageD}d liq $${Math.round(p.liquidityUsd)} holders ${holders.toLocaleString()} => ${pass ? 'CALL ✅' : 'safe but <' + config.SCAN_MIN_HOLDERS + ' holders'}`);
  if (pass) calls++;
}
console.log(`\nwould call: ${calls}`);
process.exit(0);
