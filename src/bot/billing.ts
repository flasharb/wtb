import { Bot, Context, InlineKeyboard } from 'grammy';
import { and, eq, lt } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';

type Sub = typeof subscriptions.$inferSelect;

export function isActive(sub?: Sub | null): boolean {
  return !!sub && sub.status === 'active' && sub.expiresAt > new Date();
}

async function getSub(uid: string): Promise<Sub | undefined> {
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.telegramUserId, uid));
  return s;
}

/** Is this Telegram user an active paying subscriber? */
export async function isSubscriber(uid: string): Promise<boolean> {
  return isActive(await getSub(uid));
}

/** /subscribe, /renew, /vip — send a Telegram Stars invoice. */
export async function sendSubscribeInvoice(ctx: Context) {
  if (!config.VIP_CHANNEL_ID) {
    await ctx.reply('VIP is not available yet — hang tight. 🔧');
    return;
  }
  const title = `Stack Alpha VIP — ${config.SUB_DAYS} days`;
  const description =
    `Full real-time launch calls in the private VIP channel for ${config.SUB_DAYS} days. ` +
    `Only tokens that pass every safety check with 1,000+ holders — plus pump/fade follow-ups.`;
  const payload = `vip:${ctx.from?.id}:${Date.now()}`;
  // Telegram Stars: currency XTR, empty provider token, amount = number of Stars.
  await ctx.replyWithInvoice(title, description, payload, 'XTR', [
    { label: `${config.SUB_DAYS} days of VIP access`, amount: config.SUB_PRICE_STARS },
  ]);
}

/** /membership — show current subscription status. */
async function showMembership(ctx: Context) {
  const sub = await getSub(String(ctx.from?.id));
  if (isActive(sub)) {
    const kb = sub!.inviteLink ? new InlineKeyboard().url('🔓 VIP channel', sub!.inviteLink) : undefined;
    await ctx.reply(
      `⭐ *You're a VIP member.*\nAccess until *${sub!.expiresAt.toUTCString()}*.\n\nUse /renew to add another ${config.SUB_DAYS} days.`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  } else {
    await ctx.reply(
      `You're not a VIP yet.\n\n⭐ *VIP — ${config.SUB_PRICE_STARS} Stars / ${config.SUB_DAYS} days*\nFull real-time calls + follow-ups in the private channel.\n\nTap /subscribe to join.`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function handlePayment(ctx: Context) {
  const sp = ctx.message?.successful_payment;
  if (!sp || !ctx.from) return;
  const uid = String(ctx.from.id);
  const now = new Date();
  const existing = await getSub(uid);
  const base = existing && existing.expiresAt > now ? existing.expiresAt : now;
  const expiresAt = new Date(base.getTime() + config.SUB_DAYS * 86400000);

  // Fresh one-time invite link (prior links may be used/expired).
  let inviteLink = '';
  try {
    const link = await ctx.api.createChatInviteLink(config.VIP_CHANNEL_ID, {
      member_limit: 1,
      name: `vip-${uid}`.slice(0, 32),
    });
    inviteLink = link.invite_link;
  } catch (e: any) {
    console.error('[billing] createChatInviteLink failed:', e?.message ?? e);
  }

  const totalStars = (existing?.totalStars || 0) + (sp.total_amount || 0);
  await db
    .insert(subscriptions)
    .values({
      telegramUserId: uid,
      username: ctx.from.username || null,
      status: 'active',
      plan: 'monthly',
      expiresAt,
      lastPaymentAt: now,
      totalStars,
      lastChargeId: sp.telegram_payment_charge_id,
      inviteLink,
    })
    .onConflictDoUpdate({
      target: subscriptions.telegramUserId,
      set: {
        status: 'active',
        username: ctx.from.username || null,
        expiresAt,
        lastPaymentAt: now,
        totalStars,
        lastChargeId: sp.telegram_payment_charge_id,
        inviteLink,
      },
    });

  const kb = inviteLink ? new InlineKeyboard().url('🔓 Join VIP channel', inviteLink) : undefined;
  await ctx.reply(
    `✅ *Payment received — welcome to VIP!* ⭐\n\nYour access runs until *${expiresAt.toUTCString()}*.\n\n` +
      `Tap below to join the private channel (one-time link, just for you).`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
  console.log(`[billing] VIP payment ${sp.total_amount}⭐ from ${uid} → until ${expiresAt.toISOString()}`);
}

export function registerBilling(bot: Bot) {
  // Setup helper: forward any message from the VIP channel to the bot in DM and it replies
  // with the channel's numeric ID (reliable — forwarded messages are normal DM updates).
  bot.on('message:forward_origin', async (ctx) => {
    const fo: any = ctx.message?.forward_origin;
    if (fo?.type === 'channel' && fo.chat) {
      console.log(`[chatinfo] forwarded from channel ${fo.chat.id} (${fo.chat.title || ''})`);
      try {
        await ctx.reply(`📡 Channel ID: \`${fo.chat.id}\`\n(${fo.chat.title || ''})`, { parse_mode: 'Markdown' });
      } catch {
        /* ignore */
      }
    }
  });
  if (!config.VIP_CHANNEL_ID) {
    bot.on('channel_post', (ctx) => {
      const title = 'title' in ctx.chat ? ctx.chat.title : '';
      console.log(`[chatinfo] channel_post from chat ${ctx.chat.id} (${title})`);
    });
  }

  bot.command(['subscribe', 'renew', 'vip'], (ctx) => sendSubscribeInvoice(ctx));
  bot.command('membership', (ctx) => showMembership(ctx));
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch {
      /* ignore */
    }
  });
  bot.on('message:successful_payment', (ctx) => handlePayment(ctx));
}

/** Remove expired members from the VIP channel. Call periodically. */
export async function expireSubscriptions(bot: Bot): Promise<number> {
  if (!config.VIP_CHANNEL_ID) return 0;
  const now = new Date();
  const expired = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'active'), lt(subscriptions.expiresAt, now)));

  for (const s of expired) {
    const id = Number(s.telegramUserId);
    try {
      // Kick (ban then unban) so they're removed but can rejoin later on renewal.
      await bot.api.banChatMember(config.VIP_CHANNEL_ID, id);
      await bot.api.unbanChatMember(config.VIP_CHANNEL_ID, id, { only_if_banned: true });
    } catch (e: any) {
      console.error(`[billing] remove ${id} failed:`, e?.message ?? e);
    }
    await db.update(subscriptions).set({ status: 'expired' }).where(eq(subscriptions.id, s.id));
    try {
      await bot.api.sendMessage(
        s.telegramUserId,
        '⌛ Your Stack Alpha VIP has expired and you’ve been removed from the channel.\n\nTap /renew for another 30 days and a fresh invite.'
      );
    } catch {
      /* user may have blocked the bot */
    }
  }
  if (expired.length) console.log(`[billing] expired ${expired.length} subscription(s)`);
  return expired.length;
}
