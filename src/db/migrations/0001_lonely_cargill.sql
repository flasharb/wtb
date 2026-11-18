CREATE TABLE "launch_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(16) DEFAULT 'solana' NOT NULL,
	"token_address" varchar(128) NOT NULL,
	"symbol" varchar(32),
	"name" varchar(128),
	"pool_address" varchar(128),
	"dex" varchar(64),
	"pool_created_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"liquidity_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"volume_24h_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"fdv_usd" numeric(24, 2) DEFAULT '0' NOT NULL,
	"price_usd" numeric(24, 12) DEFAULT '0' NOT NULL,
	"holder_count" integer DEFAULT 0 NOT NULL,
	"top10_pct" real DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'watching' NOT NULL,
	"reject_reason" text,
	"safety_json" jsonb,
	"alerted_at" timestamp with time zone,
	"price_at_alert" numeric(24, 12)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "launch_candidates_chain_token_idx" ON "launch_candidates" USING btree ("chain","token_address");--> statement-breakpoint
CREATE INDEX "launch_candidates_status_idx" ON "launch_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "launch_candidates_created_idx" ON "launch_candidates" USING btree ("pool_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_labels_wallet_label_idx" ON "wallet_labels" USING btree ("wallet_id","label");