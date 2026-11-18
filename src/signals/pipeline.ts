import { Bot } from 'grammy';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tokens } from '../db/schema.js';
import { DetectedBuy } from '../classify/types.js';
import { SignalEngine } from './engine.js';
import { AlertDispatcher } from './alert-dispatcher.js';
import { DexScreenerMarketProvider } from '../providers/market/market-data-provider.js';
import { TokenSecurityChecker } from '../providers/security/safety-checker.js';

/**
 * AlertPipeline: the live buy -> signal -> alert path.
 *
 * Given a buy that has already been persisted by the IngestionProcessor, it:
 *   1. resolves the token id,
 *   2. enriches with market data (price/liquidity/FDV, free DexScreener API),
 *   3. evaluates consensus / high-conviction signal rules,
 *   4. runs safety checks (hard-fail suppresses the alert),
 *   5. dispatches / edits the Telegram alert for every eligible chat.
 *
 * Mirrors the Phase-3 acceptance test (tests/telegram-burst-alert.test.ts) so the
 * runtime behaves identically to the verified flow. Errors are swallowed and logged
 * so a single bad event can never take down ingestion.
 */
export class AlertPipeline {
  constructor(
    private readonly bot: Bot,
    private readonly engine: SignalEngine = new SignalEngine(),
    private readonly dispatcher: AlertDispatcher = new AlertDispatcher(),
    private readonly market: DexScreenerMarketProvider = new DexScreenerMarketProvider(),
    private readonly security: TokenSecurityChecker = new TokenSecurityChecker()
  ) {}

  async handleBuy(buy: DetectedBuy): Promise<void> {
    try {
      const rows = await db
        .select({ id: tokens.id })
        .from(tokens)
        .where(and(eq(tokens.chain, buy.chain), eq(tokens.address, buy.tokenAddress)))
        .limit(1);
      if (rows.length === 0) return;
      const tokenId = rows[0].id;

      const marketData = await this.market.getTokenMarketData(buy.chain, buy.tokenAddress);

      const signal = await this.engine.evaluateTokenBuys(tokenId, marketData?.priceUsd ?? 0);
      if (!signal || !signal.shouldAlert) return;

      const safety = await this.security.evaluateToken(buy.chain, buy.tokenAddress, {
        liquidityUsd: marketData?.liquidityUsd ?? 0,
        pairCreatedAt: marketData?.pairCreatedAt,
        fdvUsd: marketData?.fdvUsd ?? 0,
      });

      const results = await this.dispatcher.dispatchAlert(signal, this.bot, marketData, safety);
      const sent = results.filter((r) => r.action === 'sent' || r.action === 'edited').length;
      if (sent > 0) {
        console.log(
          `[Pipeline] ${signal.signalType} alert on ${buy.chain}:${buy.tokenAddress} ` +
            `(${signal.whaleCount} whales) -> ${sent} chat(s)`
        );
      }
    } catch (err: any) {
      console.error('[Pipeline] handleBuy error:', err?.message ?? err);
    }
  }
}
