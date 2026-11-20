import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Wallets
export const wallets = pgTable(
  'wallets',
  {
    id: serial('id').primaryKey(),
    chain: varchar('chain', { length: 16 }).notNull(), // 'solana' | 'ethereum'
    address: varchar('address', { length: 128 }).notNull(),
    rank: integer('rank'),
    tier: varchar('tier', { length: 32 }), // 'elite' | 'active' | 'seed'
    qualityScore: real('quality_score').default(50).notNull(), // 0 to 100
    isExcluded: boolean('is_excluded').default(false).notNull(),
    source: varchar('source', { length: 64 }).notNull(), // 'csv' | 'bigquery' | 'dune' | 'manual'
    avgSwapsPerDay: real('avg_swaps_per_day').default(0).notNull(),
    estUsdBalance: numeric('est_usd_balance', { precision: 18, scale: 2 }).default('0').notNull(),
    isBotFlagged: boolean('is_bot_flagged').default(false).notNull(),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('wallets_chain_address_idx').on(table.chain, table.address),
    index('wallets_chain_active_idx').on(table.chain, table.isExcluded),
    index('wallets_quality_score_idx').on(table.qualityScore),
  ]
);

// 2. Wallet Labels
export const walletLabels = pgTable(
  'wallet_labels',
  {
    id: serial('id').primaryKey(),
    walletId: integer('wallet_id')
      .references(() => wallets.id, { onDelete: 'cascade' })
      .notNull(),
    label: varchar('label', { length: 128 }).notNull(),
    category: varchar('category', { length: 64 }), // 'fund' | 'insider' | 'smart_money' | 'kol'
    source: varchar('source', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('wallet_labels_wallet_id_idx').on(table.walletId),
    uniqueIndex('wallet_labels_wallet_label_idx').on(table.walletId, table.label),
  ]
);

// 3. Tokens
export const tokens = pgTable(
  'tokens',
  {
    id: serial('id').primaryKey(),
    chain: varchar('chain', { length: 16 }).notNull(),
    address: varchar('address', { length: 128 }).notNull(),
    symbol: varchar('symbol', { length: 32 }),
    name: varchar('name', { length: 128 }),
    decimals: integer('decimals'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    safetyJson: jsonb('safety_json'),
    safetyCheckedAt: timestamp('safety_checked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tokens_chain_address_idx').on(table.chain, table.address),
  ]
);

// 4. Buys
export const buys = pgTable(
  'buys',
  {
    id: serial('id').primaryKey(),
    chain: varchar('chain', { length: 16 }).notNull(),
    txId: varchar('tx_id', { length: 128 }).notNull(),
    logIndex: integer('log_index').default(0).notNull(),
    walletId: integer('wallet_id')
      .references(() => wallets.id, { onDelete: 'cascade' })
      .notNull(),
    tokenId: integer('token_id')
      .references(() => tokens.id, { onDelete: 'cascade' })
      .notNull(),
    usdValue: numeric('usd_value', { precision: 18, scale: 2 }).notNull(),
    quoteAsset: varchar('quote_asset', { length: 64 }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
    rawRef: text('raw_ref'),
  },
  (table) => [
    uniqueIndex('buys_chain_tx_wallet_token_idx').on(
      table.chain,
      table.txId,
      table.walletId,
      table.tokenId
    ),
    index('buys_token_block_time_idx').on(table.tokenId, table.blockTime),
    index('buys_wallet_block_time_idx').on(table.walletId, table.blockTime),
  ]
);

// 5. Signals
export const signals = pgTable(
  'signals',
  {
    id: serial('id').primaryKey(),
    chain: varchar('chain', { length: 16 }).notNull(),
    tokenId: integer('token_id')
      .references(() => tokens.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 64 }).notNull(), // 'consensus' | 'high_conviction'
    whaleCount: integer('whale_count').notNull(),
    totalUsd: numeric('total_usd', { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    priceAtSignal: numeric('price_at_signal', { precision: 24, scale: 10 }).notNull(),
  },
  (table) => [
    index('signals_token_created_idx').on(table.tokenId, table.createdAt),
  ]
);

// 6. Signal Outcomes
export const signalOutcomes = pgTable(
  'signal_outcomes',
  {
    id: serial('id').primaryKey(),
    signalId: integer('signal_id')
      .references(() => signals.id, { onDelete: 'cascade' })
      .notNull(),
    horizon: varchar('horizon', { length: 8 }).notNull(), // '1h' | '24h' | '7d'
    price: numeric('price', { precision: 24, scale: 10 }).notNull(),
    pctChange: real('pct_change').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('signal_outcomes_signal_horizon_idx').on(table.signalId, table.horizon),
  ]
);

// 7. Telegram Chats
export const chats = pgTable(
  'chats',
  {
    id: serial('id').primaryKey(),
    telegramChatId: varchar('telegram_chat_id', { length: 64 }).unique().notNull(),
    chains: varchar('chains', { length: 64 }).default('solana,ethereum').notNull(),
    minBuyUsd: numeric('min_buy_usd', { precision: 18, scale: 2 }).default('5000').notNull(),
    minWhales: integer('min_whales').default(3).notNull(),
    windowHours: integer('window_hours').default(6).notNull(),
    minLiquidityUsd: numeric('min_liquidity_usd', { precision: 18, scale: 2 }).default('50000').notNull(),
    showOnlyFirstTime: boolean('show_only_first_time').default(false).notNull(),
    muted: boolean('muted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

// 8. Alerts Sent
export const alertsSent = pgTable(
  'alerts_sent',
  {
    id: serial('id').primaryKey(),
    signalId: integer('signal_id')
      .references(() => signals.id, { onDelete: 'cascade' })
      .notNull(),
    chatId: integer('chat_id')
      .references(() => chats.id, { onDelete: 'cascade' })
      .notNull(),
    telegramMessageId: integer('telegram_message_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('alerts_sent_signal_chat_idx').on(table.signalId, table.chatId),
  ]
);

// 9. Webhook Events (Idempotency)
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: serial('id').primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(), // 'helius' | 'alchemy'
    eventKey: varchar('event_key', { length: 256 }).unique().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('webhook_events_provider_received_idx').on(table.provider, table.receivedAt),
  ]
);

// 10. Usage Daily (Credit Budget Guard)
export const usageDaily = pgTable(
  'usage_daily',
  {
    id: serial('id').primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(), // 'helius' | 'alchemy'
    day: date('day').notNull(),
    events: integer('events').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('usage_daily_provider_day_idx').on(table.provider, table.day),
  ]
);

// 11. Launch Candidates (New-Launch Scanner)
export const launchCandidates = pgTable(
  'launch_candidates',
  {
    id: serial('id').primaryKey(),
    chain: varchar('chain', { length: 16 }).default('solana').notNull(),
    tokenAddress: varchar('token_address', { length: 128 }).notNull(), // mint
    symbol: varchar('symbol', { length: 32 }),
    name: varchar('name', { length: 128 }),
    poolAddress: varchar('pool_address', { length: 128 }),
    dex: varchar('dex', { length: 64 }),
    poolCreatedAt: timestamp('pool_created_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    liquidityUsd: numeric('liquidity_usd', { precision: 18, scale: 2 }).default('0').notNull(),
    volume24hUsd: numeric('volume_24h_usd', { precision: 18, scale: 2 }).default('0').notNull(),
    fdvUsd: numeric('fdv_usd', { precision: 24, scale: 2 }).default('0').notNull(),
    priceUsd: numeric('price_usd', { precision: 24, scale: 12 }).default('0').notNull(),
    holderCount: integer('holder_count').default(0).notNull(),
    top10Pct: real('top10_pct').default(0).notNull(),
    status: varchar('status', { length: 16 }).default('watching').notNull(), // watching | alerted | rejected
    rejectReason: text('reject_reason'),
    safetyJson: jsonb('safety_json'),
    alertedAt: timestamp('alerted_at', { withTimezone: true }),
    priceAtAlert: numeric('price_at_alert', { precision: 24, scale: 12 }),
    // Pump follow-up tracking
    channelMessageId: integer('channel_message_id'), // channel post id (for threaded follow-ups)
    reportedMultiple: real('reported_multiple').default(1).notNull(), // highest milestone already posted
    peakMultiple: real('peak_multiple').default(1).notNull(), // highest multiple seen since the call
    reportedFade: boolean('reported_fade').default(false).notNull(), // posted a "faded" follow-up?
  },
  (table) => [
    uniqueIndex('launch_candidates_chain_token_idx').on(table.chain, table.tokenAddress),
    index('launch_candidates_status_idx').on(table.status),
    index('launch_candidates_created_idx').on(table.poolCreatedAt),
  ]
);

// 12. Subscriptions (paid VIP access via Telegram Stars)
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }).notNull(),
    username: varchar('username', { length: 64 }),
    status: varchar('status', { length: 16 }).default('active').notNull(), // active | expired
    plan: varchar('plan', { length: 32 }).default('monthly').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastPaymentAt: timestamp('last_payment_at', { withTimezone: true }),
    totalStars: integer('total_stars').default(0).notNull(),
    lastChargeId: varchar('last_charge_id', { length: 128 }),
    inviteLink: text('invite_link'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('subscriptions_user_idx').on(table.telegramUserId),
    index('subscriptions_status_expires_idx').on(table.status, table.expiresAt),
  ]
);

// 13. Trading wallets (per-VIP custodial Solana wallet; secret encrypted at rest)
export const tradingWallets = pgTable(
  'trading_wallets',
  {
    id: serial('id').primaryKey(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }).notNull(),
    publicKey: varchar('public_key', { length: 64 }).notNull(),
    // AES-256-GCM payload: ivHex:authTagHex:cipherHex of the 64-byte secret key.
    encryptedSecret: text('encrypted_secret').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('trading_wallets_user_idx').on(table.telegramUserId)]
);

// 14. Trading config (per-VIP autopilot parameters)
export const tradingConfigs = pgTable(
  'trading_configs',
  {
    id: serial('id').primaryKey(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }).notNull(),
    enabled: boolean('enabled').default(false).notNull(), // autopilot on/off
    buySol: numeric('buy_sol', { precision: 18, scale: 9 }).default('0.1').notNull(),
    tpPct: real('tp_pct').default(100).notNull(), // take-profit trigger %
    slPct: real('sl_pct').default(40).notNull(), // stop-loss %
    trailPct: real('trail_pct').default(25).notNull(), // trailing stop: % drop from peak (post-TP)
    tpSellPct: real('tp_sell_pct').default(50).notNull(), // % of position sold at TP (moon-bag)
    slippageBps: integer('slippage_bps').default(1500).notNull(),
    maxConcurrent: integer('max_concurrent').default(5).notNull(),
    maxDailyBuys: integer('max_daily_buys').default(20).notNull(),
    dailyBuys: integer('daily_buys').default(0).notNull(),
    dailyResetAt: timestamp('daily_reset_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('trading_configs_user_idx').on(table.telegramUserId)]
);

// 15. Positions (one open/closed trade on a token for a user)
export const positions = pgTable(
  'positions',
  {
    id: serial('id').primaryKey(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }).notNull(),
    candidateId: integer('candidate_id'), // launch_candidates.id that triggered the buy
    tokenAddress: varchar('token_address', { length: 128 }).notNull(),
    symbol: varchar('symbol', { length: 32 }),
    status: varchar('status', { length: 16 }).default('open').notNull(), // open | closed | failed
    // Entry (amounts in base units: SOL lamports, token raw units)
    buySol: numeric('buy_sol', { precision: 18, scale: 9 }).default('0').notNull(), // SOL spent (display)
    costLamports: numeric('cost_lamports', { precision: 30, scale: 0 }).default('0').notNull(), // lamports in
    tokensBought: numeric('tokens_bought', { precision: 40, scale: 0 }).default('0').notNull(), // raw units
    tokensRemaining: numeric('tokens_remaining', { precision: 40, scale: 0 }).default('0').notNull(),
    // Cost basis attributed to the still-held tokens (lamports) — shrinks on partial sells.
    costRemainingLamports: numeric('cost_remaining_lamports', { precision: 30, scale: 0 }).default('0').notNull(),
    buyTxSig: varchar('buy_tx_sig', { length: 128 }),
    // Exit tracking
    peakMultiple: real('peak_multiple').default(1).notNull(),
    tpHit: boolean('tp_hit').default(false).notNull(), // took the moon-bag partial already?
    proceedsLamports: numeric('proceeds_lamports', { precision: 30, scale: 0 }).default('0').notNull(), // SOL out
    realizedPnlLamports: numeric('realized_pnl_lamports', { precision: 30, scale: 0 }).default('0').notNull(),
    exitReason: varchar('exit_reason', { length: 16 }), // tp | sl | trail | rug | manual
    lastError: text('last_error'),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('positions_user_status_idx').on(table.telegramUserId, table.status),
    index('positions_status_idx').on(table.status),
    uniqueIndex('positions_user_candidate_idx').on(table.telegramUserId, table.candidateId),
  ]
);

// 16. Trades (individual fills: the buy and each sell leg of a position)
export const trades = pgTable(
  'trades',
  {
    id: serial('id').primaryKey(),
    positionId: integer('position_id').notNull(),
    telegramUserId: varchar('telegram_user_id', { length: 64 }).notNull(),
    side: varchar('side', { length: 8 }).notNull(), // buy | sell
    kind: varchar('kind', { length: 16 }).notNull(), // entry | tp | sl | trail | rug | manual
    tokensRaw: numeric('tokens_raw', { precision: 40, scale: 0 }).default('0').notNull(),
    solLamports: numeric('sol_lamports', { precision: 30, scale: 0 }).default('0').notNull(),
    txSig: varchar('tx_sig', { length: 128 }),
    success: boolean('success').default(true).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('trades_position_idx').on(table.positionId)]
);

// Relations
export const walletsRelations = relations(wallets, ({ many }) => ({
  labels: many(walletLabels),
  buys: many(buys),
}));

export const walletLabelsRelations = relations(walletLabels, ({ one }) => ({
  wallet: one(wallets, {
    fields: [walletLabels.walletId],
    references: [wallets.id],
  }),
}));

export const tokensRelations = relations(tokens, ({ many }) => ({
  buys: many(buys),
  signals: many(signals),
}));

export const buysRelations = relations(buys, ({ one }) => ({
  wallet: one(wallets, {
    fields: [buys.walletId],
    references: [wallets.id],
  }),
  token: one(tokens, {
    fields: [buys.tokenId],
    references: [tokens.id],
  }),
}));

export const signalsRelations = relations(signals, ({ one, many }) => ({
  token: one(tokens, {
    fields: [signals.tokenId],
    references: [tokens.id],
  }),
  outcomes: many(signalOutcomes),
  alerts: many(alertsSent),
}));
