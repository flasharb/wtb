import { InlineKeyboard } from 'grammy';

export function buildSettingsMenu(chatSettings: {
  minBuyUsd: string | number;
  minWhales: number;
  windowHours: number;
  minLiquidityUsd: string | number;
  showOnlyFirstTime: boolean;
  muted: boolean;
  chains: string;
}): { text: string; replyMarkup: InlineKeyboard } {
  const text =
    `⚙️ *Alert settings*\n\n` +
    `Alert me when at least *${chatSettings.minWhales} whales* buy the same token within *${chatSettings.windowHours}h*, each buying *$${Number(
      chatSettings.minBuyUsd
    ).toLocaleString()}+*, with at least *$${Number(chatSettings.minLiquidityUsd).toLocaleString()}* liquidity.\n\n` +
    `🆕 First-time buys only: *${chatSettings.showOnlyFirstTime ? 'on' : 'off'}*\n` +
    `🔔 Notifications: *${chatSettings.muted ? 'muted' : 'on'}*\n\n` +
    `_Tap below to adjust._`;

  const keyboard = new InlineKeyboard()
    .text(`💰 Min Buy ($${Number(chatSettings.minBuyUsd) / 1000}k)`, 'set_min_buy')
    .text(`👥 Consensus (${chatSettings.minWhales} Whales)`, 'set_min_whales')
    .row()
    .text(`⏳ Window (${chatSettings.windowHours}h)`, 'set_window')
    .text(`💧 Min Liq ($${Number(chatSettings.minLiquidityUsd) / 1000}k)`, 'set_min_liq')
    .row()
    .text(
      chatSettings.showOnlyFirstTime ? '🆕 First-time: ON' : '🆕 First-time: OFF',
      'toggle_first_time'
    )
    .text(chatSettings.muted ? '🔔 Unmute' : '🔕 Mute', 'toggle_mute')
    .row()
    .text('🔄 Refresh', 'refresh_settings');

  return { text, replyMarkup: keyboard };
}
