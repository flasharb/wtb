CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"candidate_id" integer,
	"token_address" varchar(128) NOT NULL,
	"symbol" varchar(32),
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"buy_sol" numeric(18, 9) DEFAULT '0' NOT NULL,
	"cost_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"tokens_bought" numeric(40, 0) DEFAULT '0' NOT NULL,
	"tokens_remaining" numeric(40, 0) DEFAULT '0' NOT NULL,
	"cost_remaining_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"buy_tx_sig" varchar(128),
	"peak_multiple" real DEFAULT 1 NOT NULL,
	"tp_hit" boolean DEFAULT false NOT NULL,
	"proceeds_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"realized_pnl_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"exit_reason" varchar(16),
	"last_error" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" integer NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"side" varchar(8) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"tokens_raw" numeric(40, 0) DEFAULT '0' NOT NULL,
	"sol_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"tx_sig" varchar(128),
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"buy_sol" numeric(18, 9) DEFAULT '0.1' NOT NULL,
	"tp_pct" real DEFAULT 100 NOT NULL,
	"sl_pct" real DEFAULT 40 NOT NULL,
	"trail_pct" real DEFAULT 25 NOT NULL,
	"tp_sell_pct" real DEFAULT 50 NOT NULL,
	"slippage_bps" integer DEFAULT 1500 NOT NULL,
	"max_concurrent" integer DEFAULT 5 NOT NULL,
	"max_daily_buys" integer DEFAULT 20 NOT NULL,
	"daily_buys" integer DEFAULT 0 NOT NULL,
	"daily_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"public_key" varchar(64) NOT NULL,
	"encrypted_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "positions_user_status_idx" ON "positions" USING btree ("telegram_user_id","status");--> statement-breakpoint
CREATE INDEX "positions_status_idx" ON "positions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_user_candidate_idx" ON "positions" USING btree ("telegram_user_id","candidate_id");--> statement-breakpoint
CREATE INDEX "trades_position_idx" ON "trades" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_configs_user_idx" ON "trading_configs" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_wallets_user_idx" ON "trading_wallets" USING btree ("telegram_user_id");