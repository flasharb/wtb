// Dry run: discover + evaluate the funnel against live APIs. No DB writes, no alerts.
import { GeckoTerminalSource } from '../providers/launches/geckoterminal-source.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { config } from '../config/index.js';

const gecko = new GeckoTerminalSource();
const safety = new SolanaSafetyChecker();
const now = Date.now();
const minMs = config.SCAN_MIN_AGE_DAYS * 86400000;
const maxMs = config.SCAN_MAX_AGE_DAYS * 86400000;

const pools = await gecko.discover();
console.log(`discovered: ${pools.length} pools`);

const inWindow = pools.filter((p) => {
  if (!p.poolCreatedAt) return false;
  const age = now - p.poolCreatedAt.getTime();
  return (
    age >= minMs &&
    age <= maxMs &&
    p.liquidityUsd >= config.SCAN_MIN_LIQUIDITY_USD &&
    p.volume24hUsd >= config.SCAN_MIN_VOLUME_24H_USD
  );
});
console.log(`in window (${config.SCAN_MIN_AGE_DAYS}-${config.SCAN_MAX_AGE_DAYS}d, >=$${config.SCAN_MIN_LIQUIDITY_USD} liq, >=$${config.SCAN_MIN_VOLUME_24H_USD} vol): ${inWindow.length}\n`);

let passed = 0;
for (const p of inWindow.slice(0, 15)) {
  const s = await safety.check(p.mint, {
    minHolders: config.SCAN_MIN_HOLDERS,
    maxTop10Pct: config.SCAN_MAX_TOP10_PCT,
  });
  const ageD = Math.round((now - p.poolCreatedAt!.getTime()) / 86400000);
  console.log(
    `${(p.symbol || '?').padEnd(12)} ${ageD}d $${Math.round(p.liquidityUsd).toLocaleString()}liq ` +
      `h:${s.holderCount} top10:${s.top10Pct.toFixed(0)}% => ${s.passed ? 'PASS ✅' : 'fail: ' + s.reason}`
  );
  if (s.passed) passed++;
}
console.log(`\npassed strict safety: ${passed}/${Math.min(inWindow.length, 15)} checked`);
process.exit(0);
