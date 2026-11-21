ALTER TABLE "trading_wallets" ADD COLUMN "encrypted_mnemonic" text;--> statement-breakpoint
ALTER TABLE "trading_wallets" ADD COLUMN "derivation" varchar(48);