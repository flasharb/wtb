CREATE TABLE "fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"position_id" integer NOT NULL,
	"profit_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"fee_lamports" numeric(30, 0) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'swept' NOT NULL,
	"tx_sig" varchar(128),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fees_user_idx" ON "fees" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fees_position_idx" ON "fees" USING btree ("position_id");