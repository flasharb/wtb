import { Bot, Context } from 'grammy';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { chats, wallets, walletLabels, buys, tokens, signals, signalOutcomes, usageDaily, webhookEvents } from '../db/schema.js';
import { eq, desc, and, sql, gte } from 'drizzle-orm';
import { buildSettingsMenu } from './menus.js';
import { formatShortAddress, formatUsd, formatTimeAgo, tokenTicker } from './formatters.js';

export function createBot(token: string = config.TELEGRAM_BOT_TOKEN): Bot {
  const bot = new Bot(token || 'dummy_token_for_init');

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

  // 1. /start
  bot.command('start', async (ctx) => {
    await getOrCreateChat(ctx);
    const welcome =
      `🐋 *Whale Buy Tracker*\n\n` +
      `I watch active Solana whale wallets and ping you the moment several of them buy the same token — so you can take a look early.\n\n` +
      `*Popular commands*\n` +
      `• /top — hottest tokens whales are buying now\n` +
      `• /recent — latest whale buys\n` +
      `• /settings — tune alert sensitivity\n` +
      `• /performance — how past alerts did\n` +
      `• /mute · /unmute — pause or resume alerts\n\n` +
      `You're all set — I'll message you when whales move. 🔔\n\n` +
      `_Not financial advice. Whale buys can be bait. Verify before acting._`;

    await ctx.reply(welcome, { parse_mode: 'Markdown' });
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

    const rows = await db
      .select({
        txId: buys.txId,
        chain: buys.chain,
        usdValue: buys.usdValue,
        quoteAsset: buys.quoteAsset,
        blockTime: buys.blockTime,
        walletAddress: wallets.address,
        walletLabel: walletLabels.label,
        tokenAddress: tokens.address,
        tokenSymbol: tokens.symbol,
      })
      .from(buys)
      .innerJoin(wallets, eq(buys.walletId, wallets.id))
      .innerJoin(tokens, eq(buys.tokenId, tokens.id))
      .leftJoin(walletLabels, eq(wallets.id, walletLabels.walletId))
      .orderBy(desc(buys.blockTime))
      .limit(limit);

    if (rows.length === 0) {
      await ctx.reply('No whale buys recorded yet — I’ll notify you as soon as one lands. 🔔');
      return;
    }

    let msg = `🕒 *Recent whale buys*\n`;
    rows.forEach((r) => {
      const buyer = r.walletLabel || formatShortAddress(r.walletAddress);
      const ticker = tokenTicker(r.tokenSymbol, r.tokenAddress);
      msg += `\n*${ticker}* · ${formatUsd(parseFloat(r.usdValue))}\n`;
      msg += `   ${buyer} · ${formatTimeAgo(r.blockTime)}\n`;
    });

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // 5. /top
  bot.command('top', async (ctx) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const topTokens = await db
      .select({
        tokenAddress: tokens.address,
        tokenSymbol: tokens.symbol,
        tokenName: tokens.name,
        chain: tokens.chain,
        whaleCount: sql<number>`count(distinct ${buys.walletId})`.mapWith(Number),
        totalVolume: sql<number>`sum(${buys.usdValue}::numeric)`.mapWith(Number),
      })
      .from(buys)
      .innerJoin(tokens, eq(buys.tokenId, tokens.id))
      .where(gte(buys.blockTime, since))
      .groupBy(tokens.id, tokens.address, tokens.symbol, tokens.name, tokens.chain)
      .orderBy(desc(sql`count(distinct ${buys.walletId})`))
      .limit(5);

    if (topTokens.length === 0) {
      await ctx.reply('No whale activity in the last 24h yet. 🔕');
      return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    let msg = `🏆 *Top tokens — last 24h*\n_(by number of distinct whale buyers)_\n`;
    topTokens.forEach((t, idx) => {
      const ticker = tokenTicker(t.tokenSymbol, t.tokenAddress);
      msg += `\n${medals[idx] || `${idx + 1}.`} *${ticker}* — ${t.whaleCount} whales · ${formatUsd(t.totalVolume)}\n`;
      msg += `   \`${t.tokenAddress}\`\n`;
    });

    await ctx.reply(msg, { parse_mode: 'Markdown' });
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

  // 7. /performance
  bot.command('performance', async (ctx) => {
    const outcomes = await db.select().from(signalOutcomes);

    if (outcomes.length === 0) {
      await ctx.reply(
        '📊 *Signal Performance Report:*\n\n_No outcome horizons have been measured yet. Price re-checks occur automatically at +1h, +24h, and +7d after each alert._',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const horizons = ['1h', '24h', '7d'] as const;
    let msg = `📊 *Whale Alert Performance Report:*\n\n`;

    for (const h of horizons) {
      const hOutcomes = outcomes.filter((o) => o.horizon === h);
      if (hOutcomes.length === 0) {
        msg += `*Horizon +${h.toUpperCase()}:* _Pending (no signals reached +${h})_\n\n`;
        continue;
      }

      const count = hOutcomes.length;
      const wins = hOutcomes.filter((o) => o.pctChange > 0).length;
      const winRate = ((wins / count) * 100).toFixed(1);

      const changes = hOutcomes.map((o) => o.pctChange).sort((a, b) => a - b);
      const sum = changes.reduce((acc, v) => acc + v, 0);
      const mean = (sum / count).toFixed(1);

      const mid = Math.floor(changes.length / 2);
      const median = (
        changes.length % 2 !== 0 ? changes[mid] : (changes[mid - 1] + changes[mid]) / 2
      ).toFixed(1);

      const maxGain = changes[changes.length - 1].toFixed(1);

      msg +=
        `🕒 *Horizon +${h.toUpperCase()}* (${count} alerts):\n` +
        `   • Win Rate: *${winRate}%* (${wins}/${count})\n` +
        `   • Median Change: *${Number(median) > 0 ? '+' : ''}${median}%*\n` +
        `   • Mean Change: *${Number(mean) > 0 ? '+' : ''}${mean}%*\n` +
        `   • Top Gain: *+${maxGain}%*\n\n`;
    }

    msg += `_Signals are evaluated against real-time DEX liquidity pools._`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

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

  // 8. /status (Admin status report)
  bot.command('status', async (ctx) => {
    const [solWallets] = await db
      .select({ count: sql`count(*)` })
      .from(wallets)
      .where(and(eq(wallets.chain, 'solana'), eq(wallets.isExcluded, false)));

    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const [eventsLastHour] = await db
      .select({ count: sql`count(*)` })
      .from(webhookEvents)
      .where(gte(webhookEvents.receivedAt, oneHourAgo));

    const [lastEvent] = await db
      .select({ at: webhookEvents.receivedAt })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(1);

    const today = new Date().toISOString().split('T')[0];
    const usageRows = await db.select().from(usageDaily).where(eq(usageDaily.day, today));
    const heliusUsage = usageRows.find((u) => u.provider === 'helius')?.events || 0;
    const projectedHelius = Math.round(heliusUsage * 30);
    const budgetPct = ((projectedHelius / config.HELIUS_MONTHLY_CREDIT_BUDGET) * 100).toFixed(1);

    const lastSeen = lastEvent?.at ? formatTimeAgo(lastEvent.at) : 'none yet';

    const msg =
      `📊 *Status — all systems live* 🟢\n\n` +
      `🐋 Watching *${solWallets.count}* Solana whales\n` +
      `📡 Whale buys seen (last hour): *${eventsLastHour.count}*\n` +
      `🕒 Last activity: *${lastSeen}*\n\n` +
      `_Usage: ${heliusUsage.toLocaleString()} events today · on track for ${budgetPct}% of the monthly budget._`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // Callback Query Handlers for Settings Menus
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
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

  return bot;
}
