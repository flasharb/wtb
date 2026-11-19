// Prove persistence + send a live preview alert (exact-price format) to a DM.
//   tsx src/scripts/send-preview.ts [SYMBOL] [chatId]
import { Bot } from 'grammy';
import { eq, desc, ilike } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db, pool } from '../db/index.js';
import { launchCandidates } from '../db/schema.js';
import { DexScreenerMarketProvider } from '../providers/market/market-data-provider.js';
import { SolanaSafetyChecker } from '../providers/security/solana-safety.js';
import { formatLaunchAlert } from '../bot/launch-formatter.js';

const sym = process.argv[2];
const chatId = process.argv[3] || '8112043421';

// (a) Persistence proof — every call is stored in launch_candidates with its outcome fields.
const calls = await db
  .select()
  .from(launchCandidates)
  .where(eq(launchCandidates.status, 'alerted'))
  .orderBy(desc(launchCandidates.alertedAt));
console.log(`PERSISTED CALLS: ${calls.length}`);
for (const c of calls) {
  console.log(
    `  ${(c.symbol || '?').padEnd(10)} entry=${c.priceAtAlert} peak=${c.peakMultiple}x reported=${c.reportedMultiple}x ` +
      `alertedAt=${c.alertedAt?.toISOString()} msgId=${c.channelMessageId ?? '-'}`
  );
}

// (b) Render a fresh alert for one call and DM it so you can see the exact price.
const cand = sym
  ? (await db.select().from(launchCandidates).where(ilike(launchCandidates.symbol, sym)).limit(1))[0]
  : calls[0];
if (!cand) {
  console.log('no candidate to preview');
  await pool.end();
  process.exit(0);
}

const md = await new DexScreenerMarketProvider().getTokenMarketData('solana', cand.tokenAddress);
const safety = await new SolanaSafetyChecker().check(cand.tokenAddress, {
  minHolders: config.SCAN_MIN_HOLDERS,
  maxTop10Pct: config.SCAN_MAX_TOP10_PCT,
});
const { text, replyMarkup } = formatLaunchAlert(
  {
    tokenAddress: cand.tokenAddress,
    symbol: cand.symbol,
    name: cand.name,
    dex: cand.dex,
    poolCreatedAt: cand.poolCreatedAt,
    liquidityUsd: md?.liquidityUsd ?? Number(cand.liquidityUsd),
    volume24hUsd: md?.volume24hUsd ?? Number(cand.volume24hUsd),
    fdvUsd: md?.fdvUsd ?? Number(cand.fdvUsd),
    priceUsd: md?.priceUsd ?? cand.priceUsd ?? 0,
  },
  safety
);

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
const sent = await bot.api.sendMessage(chatId, `🔎 PREVIEW (not a live call)\n\n${text}`, {
  parse_mode: 'Markdown',
  reply_markup: replyMarkup,
});
console.log(`PREVIEW SENT: ${cand.symbol} -> chat ${chatId} msg ${sent.message_id} | price shown from ${md ? 'live' : 'stored'} = ${md?.priceUsd ?? cand.priceUsd}`);
await pool.end().catch(() => {});
process.exit(0);
