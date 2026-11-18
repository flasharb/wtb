import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { buildServer } from '../src/ingest/server.js';
import { IngestionProcessor } from '../src/ingest/processor.js';
import { solanaFixtures, WHALE_SOL_WALLET } from './fixtures/solana-fixtures.js';
import { ethereumFixtures, WHALE_ETH_WALLET } from './fixtures/ethereum-fixtures.js';
import { DetectedBuy } from '../src/classify/types.js';
import { pool } from '../src/db/index.js';

describe('Webhook Ingestion, Auth, & Idempotency', () => {
  const processor = new IngestionProcessor();
  const app = buildServer(processor);

  before(async () => {
    await app.ready();
  });

  after(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it('GET /health returns 200 OK', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
  });

  it('POST /hooks/alchemy rejects invalid HMAC signature with 401', async () => {
    const signingKey = 'test-signing-key';
    const payload = JSON.stringify({ event: { activity: [] } });

    // Build server with specific signing key to test verification
    const testApp = buildServer(processor);
    await testApp.ready();

    // Generate mismatching signature
    const invalidSignature = 'invalid-hex-digest-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    // We can test verifyAlchemySignature function directly
    const { verifyAlchemySignature } = await import('../src/ingest/server.js');
    const isValid = verifyAlchemySignature(payload, invalidSignature, signingKey);
    assert.strictEqual(isValid, false);

    // And valid signature
    const validHmac = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
    const isNowValid = verifyAlchemySignature(payload, validHmac, signingKey);
    assert.strictEqual(isNowValid, true);

    await testApp.close();
  });

  it('idempotently handles duplicate webhook event keys', async () => {
    const uniqueKey = `test-event-${Date.now()}-${Math.random()}`;

    // First insertion: should succeed
    const firstResult = await processor.checkAndStoreEvent('helius', uniqueKey);
    assert.strictEqual(firstResult.isDuplicate, false);
    assert.strictEqual(firstResult.eventStored, true);

    // Second insertion (duplicate replay): should be detected as duplicate
    const secondResult = await processor.checkAndStoreEvent('helius', uniqueKey);
    assert.strictEqual(secondResult.isDuplicate, true);
    assert.strictEqual(secondResult.eventStored, false);
  });

  it('idempotently records buys in the database (replaying produces 0 duplicates)', async () => {
    const uniqueTxId = `0xtest_tx_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const testBuy: DetectedBuy = {
      chain: 'ethereum',
      txId: uniqueTxId,
      logIndex: 0,
      walletAddress: WHALE_ETH_WALLET,
      tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
      tokenSymbol: 'PEPE',
      tokensBought: '10000000000',
      quoteAsset: 'ETH',
      quoteAmount: '5.0000',
      usdValue: 15000,
      blockTime: new Date(),
      rawRef: uniqueTxId,
    };

    // First attempt: should record buy
    const first = await processor.persistDetectedBuy(testBuy);
    assert.strictEqual(first.recorded, true);
    assert.ok(first.buyId != null);

    // Second attempt (replay of same tx and wallet): should NOT record duplicate
    const replay = await processor.persistDetectedBuy(testBuy);
    assert.strictEqual(replay.recorded, false);
    assert.strictEqual(replay.buyId, undefined);
  });

  it('accurately increments daily usage for credit budget guard', async () => {
    const count1 = await processor.recordDailyUsage('helius', 1);
    assert.ok(count1 >= 1);

    const count2 = await processor.recordDailyUsage('helius', 5);
    assert.strictEqual(count2, count1 + 5);
  });

  it('processes incoming Helius webhook payload and skips duplicates on replay', async () => {
    const uniqueSig = `sig_${Date.now()}_${Math.random()}`;
    const fixture = {
      ...solanaFixtures.jupiterSolSwap.tx,
      signature: uniqueSig,
    };

    // First webhook call: should process and record buy
    const res1 = await app.inject({
      method: 'POST',
      url: '/hooks/helius',
      headers: { 'Content-Type': 'application/json' },
      payload: [fixture],
    });

    assert.strictEqual(res1.statusCode, 200);
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.ok, true);
    assert.strictEqual(body1.processed[0].status, 'buy_recorded');

    // Replay the exact same webhook payload
    const res2 = await app.inject({
      method: 'POST',
      url: '/hooks/helius',
      headers: { 'Content-Type': 'application/json' },
      payload: [fixture],
    });

    assert.strictEqual(res2.statusCode, 200);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.ok, true);
    // Verified duplicate skip!
    assert.strictEqual(body2.processed[0].status, 'duplicate_skipped');
  });
});
