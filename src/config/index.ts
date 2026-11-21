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

  // Broadcast channel for alerts (e.g. "@stackalphacalls" or a "-100..." id).
  // The bot must be an admin of the channel with permission to post.
  ALERT_CHANNEL_ID: z.string().default(''),

  // ---- Paid VIP subscriptions (Telegram Stars) ----
  // Private channel where full real-time calls go; bot must be admin (invite + ban rights).
  VIP_CHANNEL_ID: z.string().default(''),
  SUB_PRICE_STARS: z.coerce.number().default(1000), // monthly price in Telegram Stars
  SUB_DAYS: z.coerce.number().default(30), // days of access per payment
  // Post teasers (no contract) to the public ALERT_CHANNEL_ID to drive subscriptions.
  TEASER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

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
  // Follow-up: report a fade when a call drops to this multiple of entry (0.5 = -50%),
  // and mark a call dead/rugged when liquidity falls below this.
  SCAN_FADE_MULT: z.coerce.number().default(0.5),
  SCAN_RUG_LIQUIDITY_USD: z.coerce.number().default(5000),
  // DEXes to exclude — their pools let the dev pull liquidity (rug). pump.fun/PumpSwap burn LP.
  SCAN_DEX_DENYLIST: z
    .string()
    .default('meteora-damm-v2,raydium-launchlab')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  // Follow-ups: ignore a price move above this multiple as a data glitch (false 100x reports).
  FOLLOWUP_MAX_MULT: z.coerce.number().default(100),

  // ---- Auto-trading (VIP sniper) ----
  // Master kill-switch. When false, no buys/sells execute regardless of per-user settings.
  TRADING_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // 32-byte key (hex or base64) used to AES-256-GCM encrypt each user's wallet secret at rest.
  // REQUIRED to enable trading. Never commit this. Rotating it orphans existing wallets.
  WALLET_ENCRYPTION_KEY: z.string().default(''),
  // Solana RPC for signing/sending (defaults to Helius if HELIUS_API_KEY is set, else public).
  SOLANA_RPC_URL: z.string().default(''),
  // Jupiter swap API base (lite = free/no-key). Paid: https://api.jup.ag/swap/v1 + JUPITER_API_KEY.
  JUPITER_API_URL: z.string().default('https://lite-api.jup.ag/swap/v1'),
  JUPITER_API_KEY: z.string().default(''),
  // Per-trade priority fee (lamports) to land swaps during congestion.
  TRADE_PRIORITY_FEE_LAMPORTS: z.coerce.number().default(300000),
  // Keep this much SOL unspent in every wallet to cover fees/rent.
  TRADE_FEE_RESERVE_SOL: z.coerce.number().default(0.03),
  // Hard ceiling on per-trade buy size (SOL) — a guard rail over whatever the user sets.
  TRADE_MAX_BUY_SOL: z.coerce.number().default(5),
  // How often the exit monitor re-prices open positions (seconds).
  TRADE_MONITOR_INTERVAL_SEC: z.coerce.number().default(20),
  // ---- Default per-user trade parameters (user-editable via the bot) ----
  TRADE_DEFAULT_BUY_SOL: z.coerce.number().default(0.1),
  TRADE_DEFAULT_TP_PCT: z.coerce.number().default(100), // take-profit trigger: +100% = 2x
  TRADE_DEFAULT_SL_PCT: z.coerce.number().default(40), // stop-loss: -40%
  TRADE_DEFAULT_TRAIL_PCT: z.coerce.number().default(25), // trailing stop: exit on 25% drop from peak
  TRADE_DEFAULT_TP_SELL_PCT: z.coerce.number().default(50), // sell 50% at TP, let the rest ride (moon-bag)
  TRADE_DEFAULT_SLIPPAGE_BPS: z.coerce.number().default(1500), // 15% — memecoins need room
  // Exits use a wider floor so a stop-loss/rug sell on a dumping token actually lands.
  TRADE_EXIT_SLIPPAGE_BPS: z.coerce.number().default(2500), // 25% floor for all sells
  TRADE_DEFAULT_MAX_CONCURRENT: z.coerce.number().default(5),
  TRADE_DEFAULT_MAX_DAILY_BUYS: z.coerce.number().default(20),

  // ---- Fees ----
  // Transaction fee on every trade (buy + each sell), charged on the SOL moved. 30 = 0.3%.
  TXN_FEE_BPS: z.coerce.number().default(30),
  // Performance fee on realized profit at a profitable close (never on losses). 100 = 1%.
  PERF_FEE_BPS: z.coerce.number().default(100),
  // Treasury that receives fees. Empty = fee collection disabled (safe no-op).
  FEE_TREASURY_ADDRESS: z.string().default(''),
  // Skip a user's sweep when their total accrued is below this (dust not worth the gas), lamports.
  FEE_MIN_LAMPORTS: z.coerce.number().default(50000),
  // How often the fee sweeper settles accrued fees to the treasury (minutes).
  FEE_SWEEP_INTERVAL_MIN: z.coerce.number().default(15),

  // ---- Web auth (Sign-In With Solana) ----
  // HMAC secret for session JWTs. Empty = web auth endpoints return 503 (disabled).
  AUTH_JWT_SECRET: z.string().default(''),
  AUTH_JWT_TTL_DAYS: z.coerce.number().default(30),
  SIWS_DOMAIN: z.string().default('stackalpha.xyz'),

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
