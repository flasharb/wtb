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
  },
  (table) => [
    uniqueIndex('launch_candidates_chain_token_idx').on(table.chain, table.tokenAddress),
    index('launch_candidates_status_idx').on(table.status),
    index('launch_candidates_created_idx').on(table.poolCreatedAt),
  ]
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
