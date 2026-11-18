import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { IngestionProcessor } from './processor.js';
import { classifySolanaSwap } from '../classify/solana.js';
import { classifyEthereumTx, EthereumTxPayload } from '../classify/ethereum.js';
import { DetectedBuy } from '../classify/types.js';

/** Optional callback invoked after a buy is persisted (signal evaluation + alerting). */
export type OnBuyRecorded = (buy: DetectedBuy) => Promise<void> | void;

export function verifyAlchemySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  signingKey: string = config.ALCHEMY_WEBHOOK_SIGNING_KEY
): boolean {
  if (!signingKey) {
    // If not configured (dev mode), permit request
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function buildServer(
  processor: IngestionProcessor = new IngestionProcessor(),
  onBuy?: OnBuyRecorded
): FastifyInstance {
  const server = Fastify({
    logger: false,
  });

  // Preserve raw body for HMAC signature verification
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done: (err: Error | null, parsed?: any) => void) => {
      try {
        (req as any).rawBody = body;
        const json = JSON.parse(body.toString('utf-8'));
        done(null, json);
      } catch (err: any) {
        done(err, undefined);
      }
    }
  );

  // Health endpoint
  server.get('/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // 1. Helius Webhook Endpoint
  server.post('/hooks/helius', async (req: FastifyRequest, reply: FastifyReply) => {
    // Verify Helius Auth Header if configured
    if (config.HELIUS_WEBHOOK_AUTH_HEADER) {
      const authHeader = req.headers['authorization'];
      if (authHeader !== config.HELIUS_WEBHOOK_AUTH_HEADER) {
        return reply.status(401).send({ error: 'Unauthorized: Invalid Helius auth header' });
      }
    }

    const payload = req.body as any;
    const events: any[] = Array.isArray(payload) ? payload : [payload];

    // Credit budget guard: 1 credit per event delivered
    if (events.length > 0) {
      await processor.recordDailyUsage('helius', events.length);
    }

    const results = [];
    for (const event of events) {
      const sig = event.signature || event.transaction?.signatures?.[0] || 'unknown-sig';
      const eventKey = `helius:${sig}`;

      // Idempotency check
      const { isDuplicate } = await processor.checkAndStoreEvent('helius', eventKey);
      if (isDuplicate) {
        results.push({ sig, status: 'duplicate_skipped' });
        continue;
      }

      // Check participants / feePayer
      const feePayer = event.feePayer || '';
      const classification = classifySolanaSwap(event, feePayer);

      if (classification.isBuy && classification.buy) {
        const { recorded } = await processor.persistDetectedBuy(classification.buy);
        if (recorded && onBuy) {
          await onBuy(classification.buy);
        }
        results.push({ sig, status: 'buy_recorded', buy: classification.buy });
      } else {
        results.push({ sig, status: 'ignored', reason: classification.ignoredReason });
      }
    }

    return reply.status(200).send({ ok: true, processed: results });
  });

  // 2. Alchemy Address Activity Webhook Endpoint
  server.post('/hooks/alchemy', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (req as any).rawBody as Buffer;
    const signature = req.headers['x-alchemy-signature'] as string | undefined;

    // Verify HMAC-SHA256 signature
    if (!verifyAlchemySignature(rawBody, signature)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid Alchemy webhook signature' });
    }

    const payload = req.body as any;
    const activities = payload?.event?.activity || (Array.isArray(payload) ? payload : [payload]);

    await processor.recordDailyUsage('alchemy', activities.length || 1);

    const results = [];
    for (const activity of activities) {
      const txHash = activity.hash || activity.transactionHash || 'unknown-hash';
      const logIndex = activity.logIndex || 0;
      const eventKey = `alchemy:${txHash}:${logIndex}`;

      const { isDuplicate } = await processor.checkAndStoreEvent('alchemy', eventKey);
      if (isDuplicate) {
        results.push({ txHash, status: 'duplicate_skipped' });
        continue;
      }

      // If full transaction payload is attached
      if (activity.logs) {
        const fromWallet = activity.from || '';
        const classification = classifyEthereumTx(activity as EthereumTxPayload, fromWallet);
        if (classification.isBuy && classification.buy) {
          const { recorded } = await processor.persistDetectedBuy(classification.buy);
          if (recorded && onBuy) {
            await onBuy(classification.buy);
          }
          results.push({ txHash, status: 'buy_recorded', buy: classification.buy });
          continue;
        }
      }

      results.push({ txHash, status: 'processed' });
    }

    return reply.status(200).send({ ok: true, processed: results });
  });

  return server;
}
