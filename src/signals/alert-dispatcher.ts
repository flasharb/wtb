import { Bot } from 'grammy';
import { db } from '../db/index.js';
import { chats, signals, alertsSent } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { EvaluatedSignal } from './types.js';
import { TokenMarketData } from '../providers/market/types.js';
import { SafetyCheckResult } from '../providers/security/types.js';
import { formatAlertMessage } from '../bot/formatters.js';

export interface DispatchResult {
  chatId: number;
  telegramChatId: string;
  action: 'sent' | 'edited' | 'skipped' | 'failed';
  telegramMessageId?: number;
  reason?: string;
}

export class AlertDispatcher {
  async dispatchAlert(
    signal: EvaluatedSignal,
    bot: Bot,
    marketData: TokenMarketData | null,
    safety: SafetyCheckResult | null
  ): Promise<DispatchResult[]> {
    // 1. Hard safety check suppression
    if (safety && !safety.passed) {
      console.log(`[Dispatcher] Alert suppressed for token ${signal.tokenAddress}: ${safety.hardFailReason}`);
      return [];
    }

    // 2. Query all unmuted chats that track this chain
    const activeChats = await db
      .select()
      .from(chats)
      .where(eq(chats.muted, false));

    const eligibleChats = activeChats.filter((c) =>
      c.chains.toLowerCase().includes(signal.chain.toLowerCase())
    );

    if (eligibleChats.length === 0) {
      return [];
    }

    const { text, replyMarkup } = formatAlertMessage(signal, marketData, safety);
    const results: DispatchResult[] = [];

    // 3. Save or update signal in database
    let signalId = signal.existingSignalId;
    if (!signalId) {
      const insertedSignal = await db
        .insert(signals)
        .values({
          chain: signal.chain,
          tokenId: signal.tokenId,
          type: signal.signalType,
          whaleCount: signal.whaleCount,
          totalUsd: signal.totalUsd.toString(),
          priceAtSignal: (marketData?.priceUsd || signal.priceAtSignal || 0).toString(),
          createdAt: new Date(),
        })
        .returning({ id: signals.id });
      signalId = insertedSignal[0].id;
    } else {
      await db
        .update(signals)
        .set({
          whaleCount: signal.whaleCount,
          totalUsd: signal.totalUsd.toString(),
        })
        .where(eq(signals.id, signalId));
    }

    // 4. Send or Edit Message per Chat
    for (const chat of eligibleChats) {
      // Check chat threshold filters
      if (Number(chat.minLiquidityUsd) > (safety?.liquidityUsd || 0)) {
        results.push({
          chatId: chat.id,
          telegramChatId: chat.telegramChatId,
          action: 'skipped',
          reason: 'Token liquidity below chat preference',
        });
        continue;
      }

      // Check if an existing message was sent to this chat
      const existingAlert = await db
        .select({
          id: alertsSent.id,
          telegramMessageId: alertsSent.telegramMessageId,
        })
        .from(alertsSent)
        .where(and(eq(alertsSent.signalId, signalId), eq(alertsSent.chatId, chat.id)))
        .limit(1);

      if (existingAlert.length > 0 && signal.isUpdate) {
        // EDIT existing message
        const messageId = existingAlert[0].telegramMessageId;
        try {
          await bot.api.editMessageText(chat.telegramChatId, messageId, text, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
          });
          results.push({
            chatId: chat.id,
            telegramChatId: chat.telegramChatId,
            action: 'edited',
            telegramMessageId: messageId,
          });
        } catch (err: any) {
          // If message is identical or cannot be edited, fallback
          results.push({
            chatId: chat.id,
            telegramChatId: chat.telegramChatId,
            action: 'failed',
            reason: err.message,
          });
        }
      } else {
        // SEND new message
        try {
          const sent = await bot.api.sendMessage(chat.telegramChatId, text, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
          });

          await db.insert(alertsSent).values({
            signalId: signalId!,
            chatId: chat.id,
            telegramMessageId: sent.message_id,
            sentAt: new Date(),
          });

          results.push({
            chatId: chat.id,
            telegramChatId: chat.telegramChatId,
            action: 'sent',
            telegramMessageId: sent.message_id,
          });
        } catch (err: any) {
          results.push({
            chatId: chat.id,
            telegramChatId: chat.telegramChatId,
            action: 'failed',
            reason: err.message,
          });
        }
      }
    }

    return results;
  }
}
