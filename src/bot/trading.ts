import { Bot, Context, InlineKeyboard } from 'grammy';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { positions } from '../db/schema.js';
import { config } from '../config/index.js';
import { tokenTicker } from './formatters.js';
import { isSubscriber } from './billing.js';
import { tradingLive } from '../trading/engine.js';
import { getOrCreateWallet, getPublicKey, getBalanceSol, withdrawSol } from '../trading/wallet.js';
import { lamportsToSol } from '../trading/solana.js';
import { getOrCreateConfig, updateConfig, TradingConfig } from '../trading/store.js';

const uidOf = (ctx: Context) => String(ctx.from?.id);

// Tap-to-cycle presets for every autopilot setting (button taps, no typing).
const PRESETS = {
  buy: [0.05, 0.1, 0.25, 0.5, 1, 2],
  tp: [50, 100, 150, 200, 300, 500],
  sl: [20, 30, 40, 50, 60],
  trail: [15, 20, 25, 30, 40],
  moon: [0, 25, 50, 75, 100],
  slip: [5, 10, 15, 20, 30], // percent
  max: [1, 2, 3, 5, 10],
  daily: [5, 10, 20, 50, 100],
};
const nextCycle = (cur: number, arr: number[]) => arr.find((v) => v > cur + 1e-9) ?? arr[0];
const numStr = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

async function canTrade(ctx: Context): Promise<boolean> {
  const uid = uidOf(ctx);
  if (config.ADMIN_TELEGRAM_IDS.includes(uid)) return true;
  return isSubscriber(uid);
}

function dashKeyboard(cfg: TradingConfig) {
  const slip = cfg.slippageBps / 100;
  return new InlineKeyboard()
    .text(cfg.enabled ? '🔴 Disable autopilot' : '🟢 Enable autopilot', 'at_toggle')
    .row()
    .text(`💰 Buy ${numStr(Number(cfg.buySol))} SOL`, 'at_cyc_buy')
    .text(`🎯 TP +${cfg.tpPct}%`, 'at_cyc_tp')
    .row()
    .text(`🛑 SL -${cfg.slPct}%`, 'at_cyc_sl')
    .text(`📉 Trail ${cfg.trailPct}%`, 'at_cyc_trail')
    .row()
    .text(`🌙 Moon-bag ${cfg.tpSellPct}%`, 'at_cyc_moon')
    .text(`↔️ Slip ${numStr(slip)}%`, 'at_cyc_slip')
    .row()
    .text(`🔢 Max ${cfg.maxConcurrent}`, 'at_cyc_max')
    .text(`📆 Daily ${cfg.maxDailyBuys}`, 'at_cyc_daily')
    .row()
    .text('💰 Wallet', 'at_wallet')
    .text('📈 Positions', 'at_positions')
    .row()
    .text('🧾 Portfolio', 'at_portfolio')
    .text('🔄 Refresh', 'at_refresh');
}

async function dashboardText(uid: string): Promise<string> {
  const cfg = await getOrCreateConfig(uid);
  const pubkey = await getPublicKey(uid);
  let bal = 0;
  if (pubkey) {
    try {
      bal = await getBalanceSol(pubkey);
    } catch {
      /* rpc hiccup */
    }
  }
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(positions)
    .where(and(eq(positions.telegramUserId, uid), eq(positions.status, 'open')));

  const buySol = Math.min(Number(cfg.buySol), config.TRADE_MAX_BUY_SOL);
  return (
    `🤖 *Autopilot Sniper*\n\n` +
    `Status: ${cfg.enabled ? '🟢 *ON*' : '🔴 *OFF*'}\n` +
    `Wallet balance: *${bal.toFixed(4)} SOL*\n` +
    `Open positions: *${open}* / ${cfg.maxConcurrent}\n\n` +
    `*Trade plan*\n` +
    `• Buy size: *${buySol} SOL* per call\n` +
    `• Take-profit: *+${cfg.tpPct}%* → sell *${cfg.tpSellPct}%* (moon-bag)\n` +
    `• Stop-loss: *-${cfg.slPct}%*\n` +
    `• Trailing stop: *${cfg.trailPct}%* off peak\n` +
    `• Slippage: *${(cfg.slippageBps / 100).toFixed(1)}%*\n` +
    `• Daily cap: *${cfg.maxDailyBuys}* buys\n\n` +
    `_Tap any button below to change a setting._ Fund with 💰 Wallet, then Enable.`
  );
}

async function sendDashboard(ctx: Context) {
  const uid = uidOf(ctx);
  if (!tradingLive()) {
    await ctx.reply('🛠 Autopilot trading is not switched on yet. Check back shortly.');
    return;
  }
  // Ensure a wallet exists so the deposit address is ready.
  try {
    await getOrCreateWallet(uid);
  } catch {
    /* will surface in /wallet */
  }
  const cfg = await getOrCreateConfig(uid);
  await ctx.reply(await dashboardText(uid), { parse_mode: 'Markdown', reply_markup: dashKeyboard(cfg) });
}

async function sendWallet(ctx: Context) {
  const uid = uidOf(ctx);
  if (!tradingLive()) {
    await ctx.reply('🛠 Trading wallets are not available yet.');
    return;
  }
  const { publicKey } = await getOrCreateWallet(uid);
  let bal = 0;
  try {
    bal = await getBalanceSol(publicKey);
  } catch {
    /* ignore */
  }
  await ctx.reply(
    `💰 *Your trading wallet*\n\n` +
      `Balance: *${bal.toFixed(4)} SOL*\n\n` +
      `Deposit SOL to:\n\`${publicKey}\`\n\n` +
      `_(Tap the address to copy.)_ Only send SOL on Solana. ` +
      `Withdraw anytime:\n\`/withdraw <your_address> <amount>\``,
    { parse_mode: 'Markdown' }
  );
}

async function sendPositions(ctx: Context) {
  const uid = uidOf(ctx);
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.telegramUserId, uid), eq(positions.status, 'open')))
    .orderBy(desc(positions.openedAt))
    .limit(25);
  if (rows.length === 0) {
    await ctx.reply('No open positions right now. Autopilot opens one on each qualifying call.');
    return;
  }
  let msg = `📈 *Open positions (${rows.length})*\n\n`;
  for (const p of rows) {
    const spent = lamportsToSol(Number(p.costLamports));
    const peak = p.peakMultiple;
    msg += `• ${tokenTicker(p.symbol, p.tokenAddress)} — in *${spent.toFixed(3)} SOL*` +
      `${p.tpHit ? ' · 🎯 TP taken' : ''} · peak *${peak.toFixed(2)}x*\n`;
  }
  msg += `\n_Exits run automatically on TP / SL / trailing stop._`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

async function sendPortfolio(ctx: Context) {
  const uid = uidOf(ctx);
  const [agg] = await db
    .select({
      closed: sql<number>`count(*) filter (where ${positions.status} = 'closed')::int`,
      open: sql<number>`count(*) filter (where ${positions.status} = 'open')::int`,
      realized: sql<string>`coalesce(sum(${positions.realizedPnlLamports}) filter (where ${positions.status} = 'closed'), 0)`,
      wins: sql<number>`count(*) filter (where ${positions.status} = 'closed' and ${positions.realizedPnlLamports} > 0)::int`,
    })
    .from(positions)
    .where(eq(positions.telegramUserId, uid));

  const realizedSol = lamportsToSol(Number(agg?.realized ?? 0));
  const closed = agg?.closed ?? 0;
  const wins = agg?.wins ?? 0;
  const winRate = closed > 0 ? Math.round((wins / closed) * 100) : 0;
  const pubkey = await getPublicKey(uid);
  let bal = 0;
  if (pubkey) {
    try {
      bal = await getBalanceSol(pubkey);
    } catch {
      /* ignore */
    }
  }

  await ctx.reply(
    `🧾 *Your portfolio*\n\n` +
      `Wallet balance: *${bal.toFixed(4)} SOL*\n` +
      `Open positions: *${agg?.open ?? 0}*\n` +
      `Closed trades: *${closed}* · win rate *${winRate}%*\n` +
      `Realized P&L: *${realizedSol >= 0 ? '+' : ''}${realizedSol.toFixed(4)} SOL*`,
    { parse_mode: 'Markdown' }
  );
}

// --- Parameter setters ---------------------------------------------------
function num(ctx: Context): number | null {
  const raw = (ctx.match as string | undefined)?.trim();
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

async function applySetter(ctx: Context, label: string, v: number | null, ok: boolean, patch: any, hint: string) {
  if (v === null || !ok) {
    await ctx.reply(`Usage: ${hint}`);
    return;
  }
  await getOrCreateConfig(uidOf(ctx));
  const updated = await updateConfig(uidOf(ctx), patch);
  await ctx.reply(`✅ ${label} updated.`, { reply_markup: dashKeyboard(updated) });
}

export function registerTrading(bot: Bot) {
  bot.command(['autotrade', 'sniper', 'trade'], (ctx) => sendDashboard(ctx));
  bot.command('wallet', (ctx) => sendWallet(ctx));
  bot.command('positions', (ctx) => sendPositions(ctx));
  bot.command('portfolio', (ctx) => sendPortfolio(ctx));

  bot.command('withdraw', async (ctx) => {
    if (!tradingLive()) return ctx.reply('🛠 Trading is not available yet.');
    const parts = (ctx.match as string).trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return ctx.reply('Usage: `/withdraw <solana_address> <amount>`\nExample: `/withdraw 7xKX...9fA 0.5`', {
        parse_mode: 'Markdown',
      });
    }
    const [to, amtRaw] = parts;
    const amt = Number(amtRaw);
    if (!Number.isFinite(amt) || amt <= 0) return ctx.reply('Amount must be a positive number of SOL.');
    try {
      const { sig } = await withdrawSol(uidOf(ctx), to, amt);
      await ctx.reply(`✅ Sent *${amt} SOL*.\n[tx](https://solscan.io/tx/${sig})`, { parse_mode: 'Markdown' });
    } catch (e: any) {
      await ctx.reply(`⚠️ Withdraw failed: ${e?.message ?? e}`);
    }
  });

  // Parameter setters
  bot.command('setbuy', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Buy size', v, v !== null && v >= 0.001 && v <= config.TRADE_MAX_BUY_SOL,
      { buySol: String(v) }, `\`/setbuy <SOL>\` (0.001–${config.TRADE_MAX_BUY_SOL})`);
  });
  bot.command('settp', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Take-profit', v, v !== null && v >= 10 && v <= 10000, { tpPct: v }, '`/settp <percent>` (e.g. 150 = +150%)');
  });
  bot.command('setsl', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Stop-loss', v, v !== null && v >= 1 && v <= 95, { slPct: v }, '`/setsl <percent>` (1–95)');
  });
  bot.command('settrail', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Trailing stop', v, v !== null && v >= 1 && v <= 90, { trailPct: v }, '`/settrail <percent>` (1–90)');
  });
  bot.command('setmoonbag', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Moon-bag (sell % at TP)', v, v !== null && v >= 0 && v <= 100, { tpSellPct: v }, '`/setmoonbag <percent>` (0–100; 100 = full exit at TP)');
  });
  bot.command('setslippage', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Slippage', v, v !== null && v >= 0.5 && v <= 50, { slippageBps: Math.round((v ?? 0) * 100) }, '`/setslippage <percent>` (0.5–50)');
  });
  bot.command('setmax', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Max concurrent', v, v !== null && v >= 1 && v <= 50 && Number.isInteger(v), { maxConcurrent: v }, '`/setmax <n>` (1–50)');
  });
  bot.command('setdaily', (ctx) => {
    const v = num(ctx);
    return applySetter(ctx, 'Daily buy cap', v, v !== null && v >= 1 && v <= 200 && Number.isInteger(v), { maxDailyBuys: v }, '`/setdaily <n>` (1–200)');
  });

  // Callback routing for autopilot buttons; pass everything else through.
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('at_')) return next();
    const uid = uidOf(ctx);

    if (data === 'at_toggle') {
      const cfg = await getOrCreateConfig(uid);
      if (!cfg.enabled) {
        if (!(await canTrade(ctx))) {
          await ctx.answerCallbackQuery({ text: 'Autopilot is a VIP feature — subscribe first.', show_alert: true });
          return;
        }
        const pubkey = await getPublicKey(uid);
        let bal = 0;
        if (pubkey) {
          try {
            bal = await getBalanceSol(pubkey);
          } catch {
            /* ignore */
          }
        }
        if (bal < Number(cfg.buySol) + config.TRADE_FEE_RESERVE_SOL) {
          await ctx.answerCallbackQuery({ text: `Fund your wallet first (needs ≥ ${(Number(cfg.buySol) + config.TRADE_FEE_RESERVE_SOL).toFixed(3)} SOL). Use /wallet.`, show_alert: true });
          return;
        }
      }
      const updated = await updateConfig(uid, { enabled: !cfg.enabled });
      await ctx.answerCallbackQuery({ text: updated.enabled ? '🟢 Autopilot ON' : '🔴 Autopilot OFF' });
      try {
        await ctx.editMessageText(await dashboardText(uid), { parse_mode: 'Markdown', reply_markup: dashKeyboard(updated) });
      } catch {
        /* message unchanged */
      }
      return;
    }

    // Tap-to-cycle a setting → update + re-render the dashboard in place.
    if (data.startsWith('at_cyc_')) {
      const key = data.slice('at_cyc_'.length);
      const cfg = await getOrCreateConfig(uid);
      let patch: Partial<TradingConfig> = {};
      let label = '';
      if (key === 'buy') {
        const nv = nextCycle(Number(cfg.buySol), PRESETS.buy.filter((v) => v <= config.TRADE_MAX_BUY_SOL));
        patch = { buySol: String(nv) }; label = `Buy ${numStr(nv)} SOL`;
      } else if (key === 'tp') {
        const nv = nextCycle(cfg.tpPct, PRESETS.tp); patch = { tpPct: nv }; label = `Take-profit +${nv}%`;
      } else if (key === 'sl') {
        const nv = nextCycle(cfg.slPct, PRESETS.sl); patch = { slPct: nv }; label = `Stop-loss -${nv}%`;
      } else if (key === 'trail') {
        const nv = nextCycle(cfg.trailPct, PRESETS.trail); patch = { trailPct: nv }; label = `Trailing ${nv}%`;
      } else if (key === 'moon') {
        const nv = nextCycle(cfg.tpSellPct, PRESETS.moon); patch = { tpSellPct: nv }; label = `Moon-bag sell ${nv}% at TP`;
      } else if (key === 'slip') {
        const nv = nextCycle(cfg.slippageBps / 100, PRESETS.slip); patch = { slippageBps: Math.round(nv * 100) }; label = `Slippage ${nv}%`;
      } else if (key === 'max') {
        const nv = nextCycle(cfg.maxConcurrent, PRESETS.max); patch = { maxConcurrent: nv }; label = `Max concurrent ${nv}`;
      } else if (key === 'daily') {
        const nv = nextCycle(cfg.maxDailyBuys, PRESETS.daily); patch = { maxDailyBuys: nv }; label = `Daily cap ${nv}`;
      } else {
        await ctx.answerCallbackQuery();
        return;
      }
      const updated = await updateConfig(uid, patch);
      await ctx.answerCallbackQuery({ text: `✅ ${label}` });
      try {
        await ctx.editMessageText(await dashboardText(uid), { parse_mode: 'Markdown', reply_markup: dashKeyboard(updated) });
      } catch {
        /* unchanged */
      }
      return;
    }
    if (data === 'at_wallet') {
      await sendWallet(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'at_positions') {
      await sendPositions(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'at_portfolio') {
      await sendPortfolio(ctx);
      await ctx.answerCallbackQuery();
      return;
    }
    if (data === 'at_refresh') {
      const cfg = await getOrCreateConfig(uid);
      try {
        await ctx.editMessageText(await dashboardText(uid), { parse_mode: 'Markdown', reply_markup: dashKeyboard(cfg) });
      } catch {
        /* unchanged */
      }
      await ctx.answerCallbackQuery({ text: 'Refreshed' });
      return;
    }
    await ctx.answerCallbackQuery();
  });
}
