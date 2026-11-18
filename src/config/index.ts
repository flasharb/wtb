import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  // Opt-in Telegram webhook mode (needs HTTPS). Default: long-polling everywhere,
  // which works on a bare-IP server where no TLS cert is available.
  TELEGRAM_USE_WEBHOOK: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default('')
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    ),

  // Service & Database
  PUBLIC_BASE_URL: z.string().default(''),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/whale_tracker'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Solana: Helius
  HELIUS_API_KEY: z.string().default(''),
  HELIUS_WEBHOOK_AUTH_HEADER: z.string().default(''),
  HELIUS_MONTHLY_CREDIT_BUDGET: z.coerce.number().default(1000000),

  // Ethereum: Alchemy
  ALCHEMY_API_KEY: z.string().default(''),
  ALCHEMY_AUTH_TOKEN: z.string().default(''),
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().default(''),

  // Dune (Optional)
  DUNE_API_KEY: z.string().default(''),

  // Birdeye (optional enrichment; free key lacks token_security)
  BIRD_EYE_KEY: z.string().default(''),

  // ---- New-Launch Scanner ----
  SCAN_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  SCAN_INTERVAL_MIN: z.coerce.number().default(10), // minutes between scans
  SCAN_MIN_AGE_DAYS: z.coerce.number().default(7), // survived the rug window
  SCAN_MAX_AGE_DAYS: z.coerce.number().default(30), // still a "new" launch
  SCAN_MIN_LIQUIDITY_USD: z.coerce.number().default(30000),
  SCAN_MIN_VOLUME_24H_USD: z.coerce.number().default(10000), // liveness
  SCAN_MAX_TOP10_PCT: z.coerce.number().default(60), // holder concentration ceiling
  SCAN_MIN_HOLDERS: z.coerce.number().default(100),
  SCAN_MAX_ALERTS_PER_CYCLE: z.coerce.number().default(5),

  // Wallet selection & budget filters
  MVP_WALLET_CAP: z.coerce.number().default(1000),
  MIN_WALLET_USD: z.coerce.number().default(100000),
  MIN_SWAPS_30D: z.coerce.number().default(10),
  MAX_SWAPS_PER_DAY: z.coerce.number().default(40),
  AUTO_TRIM: z
    .string()
    .default('true')
    .transform((val) => val === 'true' || val === '1'),

  // Signal & Alert rules
  MIN_BUY_USD: z.coerce.number().default(5000),
  MIN_WHALES: z.coerce.number().default(3),
  WINDOW_HOURS: z.coerce.number().default(6),
  HIGH_CONVICTION_USD: z.coerce.number().default(50000),
  MIN_LIQUIDITY_USD: z.coerce.number().default(50000),
  MIN_TOKEN_AGE_MIN: z.coerce.number().default(30),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
