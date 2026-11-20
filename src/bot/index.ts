import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { chats, wallets, walletLabels, buys, tokens, signals, usageDaily, webhookEvents, launchCandidates } from '../db/schema.js';
import { eq, desc, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { buildSettingsMenu } from './menus.js';
import { formatShortAddress, formatUsd, formatTimeAgo, tokenTicker, formatAge } from './formatters.js';
import { registerBilling, sendSubscribeInvoice } from './billing.js';
import { registerTrading } from './trading.js';

export function createBot(token: string = config.TELEGRAM_BOT_TOKEN): Bot {
  const bot = new Bot(token || 'dummy_token_for_init');

  // Auto-trading (sniper) commands + callbacks. Registered first so its `at_` callback
  // middleware runs before the generic callback handler and passes everything else through.
  registerTrading(bot);

  // Helper: Get or create chat record in PostgreSQL
  async function getOrCreateChat(ctx: Context) {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) throw new Error('Missing chat id');

    const existing = await db.select().from(chats).where(eq(chats.telegramChatId, chatId));
    if (existing.length > 0) return existing[0];

    const inserted = await db
      .insert(chats)
      .values({
        telegramChatId: chatId,
        chains: 'solana',
        minBuyUsd: config.MIN_BUY_USD.toString(),
        minWhales: config.MIN_WHALES,
        windowHours: config.WINDOW_HOURS,
        minLiquidityUsd: config.MIN_LIQUIDITY_USD.toString(),
        showOnlyFirstTime: false,
        muted: false,
      })
      .returning();

    return inserted[0];
  }

  // Quick-nav buttons shown under replies so users tap instead of typing commands.
  function navKeyboard() {
    return new InlineKeyboard()
      .text('🚀 Recent', 'cmd_recent')
      .text('🔭 Radar', 'cmd_top')
      .row()
      .text('🏆 Track record', 'cmd_performance')
      .text('📊 Status', 'cmd_status');
  }

  async function replyRecent(ctx: Context, limit = 10) {
    const rows = await db
      .select()
      .from(launchCandidates)
      .where(eq(launchCandidates.status, 'alerted'))
      .orderBy(desc(launchCandidates.alertedAt))
      .limit(limit);

    if (rows.length === 0) {
      await ctx.reply('No launches have passed the checks yet — I’ll ping you the moment one does. 🔔', {
        reply_markup: navKeyboard(),
      });
      return;
    }

    let msg = `🚀 *Recent launches that passed*\n`;
    rows.forEach((r) => {
      const ticker = tokenTicker(r.symbol, r.tokenAddress);
      const nm = r.name && r.name !== r.symbol ? ` · ${r.name}` : '';
      msg += `\n*${ticker}*${nm}\n`;
      msg += `   💧 ${formatUsd(Number(r.liquidityUsd))} liq · ${formatAge(r.poolCreatedAt ?? undefined)} old · alerted ${formatTimeAgo(r.alertedAt ?? new Date())}\n`;
    });
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: navKeyboard() });
  }

  async function replyTop(ctx: Context) {
    const windowOldest = new Date(Date.now() - config.SCAN_MAX_AGE_DAYS * 86400000);
    const rows = await db
      .select()
      .from(launchCandidates)
      .where(
        and(
          gte(launchCandidates.poolCreatedAt, windowOldest),
          gte(launchCandidates.liquidityUsd, config.SCAN_MIN_LIQUIDITY_USD.toString())
        )
      )
      .orderBy(desc(launchCandidates.liquidityUsd))
      .limit(6);

    if (rows.length === 0) {
      await ctx.reply('Nothing on the radar in the launch window yet. 🔭', { reply_markup: navKeyboard() });
      return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.', '6.'];
    let msg = `🔭 *On the radar*\n_(biggest launches in the ${config.SCAN_MIN_AGE_DAYS}–${config.SCAN_MAX_AGE_DAYS}d window)_\n`;
    rows.forEach((t, idx) => {
      const ticker = tokenTicker(t.symbol, t.tokenAddress);
      const flag = t.status === 'alerted' ? ' ✅' : '';
      msg += `\n${medals[idx] || `${idx + 1}.`} *${ticker}*${flag} — 💧 ${formatUsd(Number(t.liquidityUsd))} · ${formatAge(t.poolCreatedAt ?? undefined)}\n`;
    });
    msg += `\n_✅ = already passed all safety checks_`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: navKeyboard() });
  }

  async function replyStatus(ctx: Context) {
    const windowOldest = new Date(Date.now() - config.SCAN_MAX_AGE_DAYS * 86400000);
    const windowNewest = new Date(Date.now() - config.SCAN_MIN_AGE_DAYS * 86400000);

    const [tracked] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(launchCandidates)
      .where(sql`${launchCandidates.status} <> 'rejected'`);
    const [inWindow] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(launchCandidates)
      .where(
        and(
          eq(launchCandidates.status, 'watching'),
          lte(launchCandidates.poolCreatedAt, windowNewest),
          gte(launchCandidates.poolCreatedAt, windowOldest),
          gte(launchCandidates.liquidityUsd, config.SCAN_MIN_LIQUIDITY_USD.toString())
        )
      );
    const [alertsSentCount] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(launchCandidates)
      .where(eq(launchCandidates.status, 'alerted'));
    const [lastScan] = await db
      .select({ at: launchCandidates.lastCheckedAt })
      .from(launchCandidates)
      .orderBy(desc(launchCandidates.lastCheckedAt))
      .limit(1);

    const lastScanTxt = lastScan?.at ? formatTimeAgo(lastScan.at) : 'warming up…';
    const msg =
      `📊 *Scanner status* 🟢\n\n` +
      `🔭 Tracking *${tracked.n.toLocaleString()}* launches\n` +
      `🎯 In the ${config.SCAN_MIN_AGE_DAYS}–${config.SCAN_MAX_AGE_DAYS}d window: *${inWindow.n}*\n` +
      `🚀 Alerts sent: *${alertsSentCount.n}*\n` +
      `🕒 Last scan: *${lastScanTxt}*\n\n` +
      `_Filters: ≥$${config.SCAN_MIN_LIQUIDITY_USD.toLocaleString()} liquidity · authorities revoked · no honeypot · healthy holders._`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: navKeyboard() });
  }

  // 1. /start
  bot.command('start', async (ctx) => {
    await getOrCreateChat(ctx);
    // Deep link from the teaser's "Unlock VIP" button (t.me/bot?start=subscribe) → go straight to payment.
    if (ctx.match?.trim() === 'subscribe') {
      await sendSubscribeInvoice(ctx);
      return;
    }
    const welcome =
      `🚀 *Solana Launch Scanner*\n\n` +
      `I scan every new Solana token across Pump.fun, Raydium, Meteora & more — and only alert you on the rare ones that *survive the first week* and pass strict safety:\n\n` +
      `✅ 7–30 days old (made it past the rug window)\n` +
      `✅ ≥ $30k liquidity · real volume\n` +
      `✅ Mint & freeze authority revoked\n` +
      `✅ No honeypot traits · healthy holder spread\n\n` +
      `*Commands*\n` +
      `• /recent — latest launches that passed\n` +
      `• /top — biggest launches on the radar\n` +
      `• /status — scanner health\n` +
      `• /mute · /unmute — pause or resume alerts\n` +
      `• /performance — the track record\n` +
      `🤖 /autotrade — *VIP autopilot sniper* (auto-buy calls, auto-exit on your TP/SL)\n\n` +
      `You're all set — I'll ping you when a clean launch shows up. 🔔\n\n` +
      `_Not financial advice. Whale buys can be bait. Verify before acting._`;

    await ctx.reply(welcome, { parse_mode: 'Markdown', reply_markup: navKeyboard() });
  });

  // 2. /chains
  bot.command('chains', async (ctx) => {
    await getOrCreateChat(ctx);
    await ctx.reply(
      `🟣 *Tracking: Solana*\n\nEthereum support is coming soon — for now all alerts are Solana whale buys.`,
      { parse_mode: 'Markdown' }
    );
  });

  // 3. /settings
  bot.command('settings', async (ctx) => {
    const chat = await getOrCreateChat(ctx);
    const menu = buildSettingsMenu(chat);
    await ctx.reply(menu.text, {
      parse_mode: 'Markdown',
      reply_markup: menu.replyMarkup,
    });
  });

  // 4. /recent
  bot.command('recent', async (ctx) => {
    const limit = Math.min(Math.max(parseInt(ctx.match || '10', 10) || 10, 1), 25);
    await replyRecent(ctx, limit);
  });

  // 5. /top
  bot.command('top', async (ctx) => {
    await replyTop(ctx);
  });

  // 6. /wallet <address>
  bot.command('wallet', async (ctx) => {
    const address = ctx.match?.trim();
    if (!address) {
      await ctx.reply('Usage: `/wallet <address>`', { parse_mode: 'Markdown' });
      return;
    }

    const walletRows = await db
      .select({
        id: wallets.id,
        chain: wallets.chain,
        address: wallets.address,
        qualityScore: wallets.qualityScore,
        estUsdBalance: wallets.estUsdBalance,
        avgSwapsPerDay: wallets.avgSwapsPerDay,
        label: walletLabels.label,
        category: walletLabels.category,
      })
      .from(wallets)
      .leftJoin(walletLabels, eq(wallets.id, walletLabels.walletId))
      .where(eq(wallets.address, address))
      .limit(1);

    if (walletRows.length === 0) {
      await ctx.reply(`Wallet \`${address}\` not found in tracked registry.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    const w = walletRows[0];
    const recentWalletBuys = await db
      .select({
        tokenSymbol: tokens.symbol,
        usdValue: buys.usdValue,
        blockTime: buys.blockTime,
      })
      .from(buys)
      .innerJoin(tokens, eq(buys.tokenId, tokens.id))
      .where(eq(buys.walletId, w.id))
      .orderBy(desc(buys.blockTime))
      .limit(5);

    let msg =
      `🐋 *Whale Profile:*\n` +
      `• Address: \`${w.address}\`\n` +
      `• Chain: *${w.chain.toUpperCase()}*\n` +
      `• Label: *${w.label || 'None'}* (${w.category || 'whale'})\n` +
      `• Quality Score: *${Math.round(w.qualityScore)}/100*\n` +
      `• Est. Balance: *${formatUsd(parseFloat(w.estUsdBalance))}*\n` +
      `• Swaps/Day: *${w.avgSwapsPerDay}*\n\n`;

    if (recentWalletBuys.length > 0) {
      msg += `📈 *Recent Recorded Buys:*\n`;
      recentWalletBuys.forEach((b) => {
        msg += `   • ${b.tokenSymbol}: ${formatUsd(parseFloat(b.usdValue))}\n`;
      });
    } else {
      msg += `_No recent DEX buys recorded yet for this wallet._`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // 7. /performance — real track record of the launch calls
  async function replyPerformance(ctx: Context) {
    const rows = await db
      .select()
      .from(launchCandidates)
      .where(inArray(launchCandidates.status, ['alerted', 'closed']));

    const total = rows.length;
    if (total === 0) {
      await ctx.reply('📊 No calls to score yet — the scoreboard fills in as soon as calls go out.', {
        reply_markup: navKeyboard(),
      });
      return;
    }

    const peaks = rows.map((r) => Number(r.peakMultiple) || 1);
    const hit = (x: number) => peaks.filter((p) => p >= x).length;
    const pct = (n: number) => Math.round((n / total) * 100);
    const rugged = rows.filter((r) => r.status === 'closed').length;
    const faded = rows.filter((r) => r.reportedFade).length;
    const avgPeak = peaks.reduce((a, b) => a + b, 0) / total;
    const sorted = [...peaks].sort((a, b) => a - b);
    const median = sorted[Math.floor((total - 1) / 2)];
    const top = [...rows]
      .sort((a, b) => Number(b.peakMultiple) - Number(a.peakMultiple))
      .slice(0, 5)
      .filter((r) => Number(r.peakMultiple) > 1.05);

    let msg = `📊 *Stack Alpha — Track Record*\n\n`;
    msg += `🎯 Calls scored: *${total}*\n`;
    msg += `🏆 Hit *2x+*: *${hit(2)}* (${pct(hit(2))}%)\n`;
    msg += `🚀 *3x+*: *${hit(3)}*  ·  *5x+*: *${hit(5)}*  ·  *10x+*: *${hit(10)}*\n`;
    msg += `📈 Avg peak *${avgPeak.toFixed(2)}x*  ·  median *${median.toFixed(2)}x*\n`;
    msg += `💀 Rugged: *${rugged}*  ·  📉 Faded: *${faded}*\n`;

    if (top.length > 0) {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      msg += `\n*Best calls*\n`;
      top.forEach((r, i) => {
        msg += `${medals[i]} ${tokenTicker(r.symbol, r.tokenAddress)} — *${Number(r.peakMultiple).toFixed(2)}x*\n`;
      });
    }

    msg += `\n_“Peak” = best multiple reached from the call price, tracked live. Not financial advice._`;
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: navKeyboard() });
  }

  bot.command('performance', (ctx) => replyPerformance(ctx));

  // 8. /mute & /unmute
  bot.command('mute', async (ctx) => {
    const chat = await getOrCreateChat(ctx);
    await db.update(chats).set({ muted: true }).where(eq(chats.id, chat.id));
    await ctx.reply('🔕 Alerts muted. Send /unmute to resume.');
  });

  bot.command('unmute', async (ctx) => {
    const chat = await getOrCreateChat(ctx);
    await db.update(chats).set({ muted: false }).where(eq(chats.id, chat.id));
    await ctx.reply('🔔 Alerts unmuted. You will receive real-time whale notifications.');
  });

  // 8. /status
  bot.command('status', async (ctx) => {
    await replyStatus(ctx);
  });

  // Callback Query Handlers
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Quick-nav buttons: send the requested view as a new message.
    if (data === 'cmd_recent') {
      await replyRecent(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'cmd_top') {
      await replyTop(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'cmd_status') {
      await replyStatus(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'cmd_performance') {
      await replyPerformance(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    const chat = await getOrCreateChat(ctx);

    if (data === 'toggle_mute') {
      await db.update(chats).set({ muted: !chat.muted }).where(eq(chats.id, chat.id));
    } else if (data === 'toggle_first_time') {
      await db
        .update(chats)
        .set({ showOnlyFirstTime: !chat.showOnlyFirstTime })
        .where(eq(chats.id, chat.id));
    } else if (data === 'set_min_buy') {
      // Cycle: 5000 -> 10000 -> 25000 -> 1000 -> 5000
      const current = Number(chat.minBuyUsd);
      const next = current === 5000 ? 10000 : current === 10000 ? 25000 : current === 25000 ? 1000 : 5000;
      await db.update(chats).set({ minBuyUsd: next.toString() }).where(eq(chats.id, chat.id));
    } else if (data === 'set_min_whales') {
      // Cycle: 3 -> 4 -> 5 -> 2 -> 3
      const next = chat.minWhales === 3 ? 4 : chat.minWhales === 4 ? 5 : chat.minWhales === 5 ? 2 : 3;
      await db.update(chats).set({ minWhales: next }).where(eq(chats.id, chat.id));
    } else if (data === 'set_window') {
      // Cycle: 6 -> 12 -> 24 -> 1 -> 3 -> 6
      const next = chat.windowHours === 6 ? 12 : chat.windowHours === 12 ? 24 : chat.windowHours === 24 ? 3 : 6;
      await db.update(chats).set({ windowHours: next }).where(eq(chats.id, chat.id));
    } else if (data === 'set_min_liq') {
      // Cycle: 50000 -> 100000 -> 200000 -> 25000 -> 50000
      const current = Number(chat.minLiquidityUsd);
      const next = current === 50000 ? 100000 : current === 100000 ? 200000 : 25000;
      await db.update(chats).set({ minLiquidityUsd: next.toString() }).where(eq(chats.id, chat.id));
    }

    const updated = await getOrCreateChat(ctx);
    const menu = buildSettingsMenu(updated);

    try {
      await ctx.editMessageText(menu.text, {
        parse_mode: 'Markdown',
        reply_markup: menu.replyMarkup,
      });
    } catch {
      // Message content identical
    }
    await ctx.answerCallbackQuery();
  });

  // Paid VIP subscriptions (Telegram Stars): /subscribe, /renew, /membership, payments.
  registerBilling(bot);

  return bot;
}
