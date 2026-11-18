CREATE TABLE "alerts_sent" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"chat_id" integer NOT NULL,
	"telegram_message_id" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buys" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(16) NOT NULL,
	"tx_id" varchar(128) NOT NULL,
	"log_index" integer DEFAULT 0 NOT NULL,
	"wallet_id" integer NOT NULL,
	"token_id" integer NOT NULL,
	"usd_value" numeric(18, 2) NOT NULL,
	"quote_asset" varchar(64) NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"raw_ref" text
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_chat_id" varchar(64) NOT NULL,
	"chains" varchar(64) DEFAULT 'solana,ethereum' NOT NULL,
	"min_buy_usd" numeric(18, 2) DEFAULT '5000' NOT NULL,
	"min_whales" integer DEFAULT 3 NOT NULL,
	"window_hours" integer DEFAULT 6 NOT NULL,
	"min_liquidity_usd" numeric(18, 2) DEFAULT '50000' NOT NULL,
	"show_only_first_time" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chats_telegram_chat_id_unique" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"horizon" varchar(8) NOT NULL,
	"price" numeric(24, 10) NOT NULL,
	"pct_change" real NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(16) NOT NULL,
	"token_id" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"whale_count" integer NOT NULL,
	"total_usd" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_at_signal" numeric(24, 10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(16) NOT NULL,
	"address" varchar(128) NOT NULL,
	"symbol" varchar(32),
	"name" varchar(128),
	"decimals" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"safety_json" jsonb,
	"safety_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"day" date NOT NULL,
	"events" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"label" varchar(128) NOT NULL,
	"category" varchar(64),
	"source" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(16) NOT NULL,
	"address" varchar(128) NOT NULL,
	"rank" integer,
	"tier" varchar(32),
	"quality_score" real DEFAULT 50 NOT NULL,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"source" varchar(64) NOT NULL,
	"avg_swaps_per_day" real DEFAULT 0 NOT NULL,
	"est_usd_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_bot_flagged" boolean DEFAULT false NOT NULL,
	"selected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_key" varchar(256) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "alerts_sent" ADD CONSTRAINT "alerts_sent_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts_sent" ADD CONSTRAINT "alerts_sent_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buys" ADD CONSTRAINT "buys_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buys" ADD CONSTRAINT "buys_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD CONSTRAINT "signal_outcomes_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_labels" ADD CONSTRAINT "wallet_labels_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_sent_signal_chat_idx" ON "alerts_sent" USING btree ("signal_id","chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buys_chain_tx_wallet_token_idx" ON "buys" USING btree ("chain","tx_id","wallet_id","token_id");--> statement-breakpoint
CREATE INDEX "buys_token_block_time_idx" ON "buys" USING btree ("token_id","block_time");--> statement-breakpoint
CREATE INDEX "buys_wallet_block_time_idx" ON "buys" USING btree ("wallet_id","block_time");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_outcomes_signal_horizon_idx" ON "signal_outcomes" USING btree ("signal_id","horizon");--> statement-breakpoint
CREATE INDEX "signals_token_created_idx" ON "signals" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_chain_address_idx" ON "tokens" USING btree ("chain","address");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_provider_day_idx" ON "usage_daily" USING btree ("provider","day");--> statement-breakpoint
CREATE INDEX "wallet_labels_wallet_id_idx" ON "wallet_labels" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_chain_address_idx" ON "wallets" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "wallets_chain_active_idx" ON "wallets" USING btree ("chain","is_excluded");--> statement-breakpoint
CREATE INDEX "wallets_quality_score_idx" ON "wallets" USING btree ("quality_score");--> statement-breakpoint
CREATE INDEX "webhook_events_provider_received_idx" ON "webhook_events" USING btree ("provider","received_at");