CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"username" varchar(64),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"plan" varchar(32) DEFAULT 'monthly' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_payment_at" timestamp with time zone,
	"total_stars" integer DEFAULT 0 NOT NULL,
	"last_charge_id" varchar(128),
	"invite_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_expires_idx" ON "subscriptions" USING btree ("status","expires_at");