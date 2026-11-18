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
    `⚙️ *Alert Settings & Preferences*\n\n` +
    `• *Chains:* ${chatSettings.chains.toUpperCase()}\n` +
    `• *Min Buy Size:* $${Number(chatSettings.minBuyUsd).toLocaleString()}\n` +
    `• *Consensus Whales:* ${chatSettings.minWhales} distinct buyers\n` +
    `• *Time Window:* ${chatSettings.windowHours} hours\n` +
    `• *Min Liquidity:* $${Number(chatSettings.minLiquidityUsd).toLocaleString()}\n` +
    `• *First-Time Only:* ${chatSettings.showOnlyFirstTime ? 'Enabled ✅' : 'Disabled ❌'}\n` +
    `• *Notifications:* ${chatSettings.muted ? 'Muted 🔕' : 'Active 🔔'}\n\n` +
    `_Select an option below to adjust:_`;

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
