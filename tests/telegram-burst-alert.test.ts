import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, pool } from '../src/db/index.js';
import { chats, tokens, wallets, walletLabels, buys, alertsSent, signals } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { IngestionProcessor } from '../src/ingest/processor.js';
import { SignalEngine } from '../src/signals/engine.js';
import { AlertDispatcher } from '../src/signals/alert-dispatcher.js';
import { DexScreenerMarketProvider } from '../src/providers/market/market-data-provider.js';
import { TokenSecurityChecker } from '../src/providers/security/safety-checker.js';

describe('Phase 3 Acceptance Test: 5 Whale Burst Alert Simulation', () => {
  const processor = new IngestionProcessor();
  const signalEngine = new SignalEngine();
  const alertDispatcher = new AlertDispatcher();
  const marketProvider = new DexScreenerMarketProvider();
  const securityChecker = new TokenSecurityChecker();

  let testChatId: number;
  let testTokenId: number;
  let testMessageId = 0;
  // Scope assertions to THIS test's chat — the shared DB may contain other (real) chats.
  const mySent = () => sentMessages.filter((m) => m.chatId === testChatTelegramId);
  const myEdited = () => editedMessages.filter((m) => m.chatId === testChatTelegramId);
  const mine = (results: Array<{ telegramChatId: string }>) =>
    results.filter((r) => r.telegramChatId === testChatTelegramId);
  const testTokenAddress = `test_burst_token_${Date.now()}`;
  const testChatTelegramId = `test_chat_${Date.now()}`;

  // Mock Telegram Bot API calls
  const sentMessages: Array<{ chatId: string; text: string; messageId: number }> = [];
  const editedMessages: Array<{ chatId: string; messageId: number; text: string }> = [];

  let nextMessageId = 1001;
  const mockBot: any = {
    api: {
      sendMessage: async (chatId: string, text: string) => {
        const messageId = nextMessageId++;
        sentMessages.push({ chatId, text, messageId });
        return { message_id: messageId, text };
      },
      editMessageText: async (chatId: string, messageId: number, text: string) => {
        editedMessages.push({ chatId, messageId, text });
        return { message_id: messageId, text };
      },
    },
  };

  before(async () => {
    // 1. Create a test chat in PostgreSQL
    const insertedChat = await db
      .insert(chats)
      .values({
        telegramChatId: testChatTelegramId,
        chains: 'solana,ethereum',
        minBuyUsd: '5000',
        minWhales: 3, // Consensus fires at 3 whales
        windowHours: 6,
        minLiquidityUsd: '50000',
        showOnlyFirstTime: false,
        muted: false,
      })
      .returning({ id: chats.id });
    testChatId = insertedChat[0].id;

    // 2. Create a test token in PostgreSQL
    const insertedToken = await db
      .insert(tokens)
      .values({
        chain: 'solana',
        address: testTokenAddress,
        symbol: 'BURST',
        name: 'Burst Alpha Token',
        decimals: 6,
      })
      .returning({ id: tokens.id });
    testTokenId = insertedToken[0].id;

    // Set mock market & security data (Passing checks)
    marketProvider.setMockData('solana', testTokenAddress, {
      chain: 'solana',
      tokenAddress: testTokenAddress,
      name: 'Burst Alpha Token',
      symbol: 'BURST',
      priceUsd: 2.5,
      liquidityUsd: 150000,
      fdvUsd: 2500000,
      volume24hUsd: 750000,
      pairCreatedAt: new Date(Date.now() - 3600 * 1000 * 24),
    });
  });

  after(async () => {
    // Cleanup test data
    if (testTokenId) {
      await db.delete(tokens).where(eq(tokens.id, testTokenId)).catch(() => {});
    }
    if (testChatId) {
      await db.delete(chats).where(eq(chats.id, testChatId)).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  it('a simulated burst of 5 whale buys of one token yields exactly 1 initial alert that updates', async () => {
    const marketData = await marketProvider.getTokenMarketData('solana', testTokenAddress);
    const safety = await securityChecker.evaluateToken('solana', testTokenAddress, {
      liquidityUsd: marketData?.liquidityUsd || 150000,
      pairCreatedAt: marketData?.pairCreatedAt,
      fdvUsd: marketData?.fdvUsd || 2500000,
    });

    // Simulate 5 whale buys from 5 distinct wallets
    const burstWallets = [
      { address: `Whale_1_${Date.now()}`, label: 'Multicoin Stash', amount: 10000 },
      { address: `Whale_2_${Date.now()}`, label: 'Wintermute Sol', amount: 12000 },
      { address: `Whale_3_${Date.now()}`, label: 'Jump Sol Active', amount: 15000 },
      { address: `Whale_4_${Date.now()}`, label: 'Ansem Alpha Buyer', amount: 20000 },
      { address: `Whale_5_${Date.now()}`, label: 'GCR Stash #5', amount: 25000 },
    ];

    for (let i = 0; i < burstWallets.length; i++) {
      const w = burstWallets[i];
      const buyTxId = `burst_tx_${i + 1}_${Date.now()}`;

      // Record buy in database
      await processor.persistDetectedBuy({
        chain: 'solana',
        txId: buyTxId,
        logIndex: 0,
        walletAddress: w.address,
        tokenAddress: testTokenAddress,
        tokenSymbol: 'BURST',
        tokenName: 'Burst Alpha Token',
        tokensBought: (w.amount * 1000).toString(),
        quoteAsset: 'SOL',
        quoteAmount: (w.amount / 200).toString(),
        usdValue: w.amount,
        blockTime: new Date(),
      });

      // Evaluate signal engine
      const evaluatedSignal = await signalEngine.evaluateTokenBuys(
        testTokenId,
        marketData?.priceUsd || 2.5
      );

      if (i === 0) {
        // Buy 1: 1 whale -> no consensus yet (needs 3)
        assert.strictEqual(evaluatedSignal, null, 'Buy 1 should not trigger consensus');
      } else if (i === 1) {
        // Buy 2: 2 whales -> no consensus yet
        assert.strictEqual(evaluatedSignal, null, 'Buy 2 should not trigger consensus');
      } else if (i === 2) {
        // Buy 3: 3 WHALES -> CONSENSUS TRIGGERED!
        assert.ok(evaluatedSignal != null, 'Buy 3 MUST trigger consensus');
        assert.strictEqual(evaluatedSignal.whaleCount, 3);
        assert.strictEqual(evaluatedSignal.isUpdate, false, 'First alert must NOT be an update');

        const dispatchResults = await alertDispatcher.dispatchAlert(
          evaluatedSignal,
          mockBot,
          marketData,
          safety
        );

        const myResults = mine(dispatchResults);
        assert.strictEqual(myResults.length, 1);
        assert.strictEqual(myResults[0].action, 'sent');
        assert.strictEqual(mySent().length, 1);
        testMessageId = mySent()[0].messageId;
      } else if (i === 3) {
        // Buy 4: 4 WHALES -> UPDATE EXISTING ALERT
        assert.ok(evaluatedSignal != null, 'Buy 4 should trigger update');
        assert.strictEqual(evaluatedSignal.whaleCount, 4);
        assert.strictEqual(evaluatedSignal.isUpdate, true, 'Subsequent alert MUST be an update');

        const dispatchResults = await alertDispatcher.dispatchAlert(
          evaluatedSignal,
          mockBot,
          marketData,
          safety
        );

        const myResults = mine(dispatchResults);
        assert.strictEqual(myResults.length, 1);
        assert.strictEqual(myResults[0].action, 'edited');
        assert.strictEqual(myEdited().length, 1);
        assert.strictEqual(myEdited()[0].messageId, testMessageId);
        assert.match(myEdited()[0].text, /4 whales bought in 6h/);
      } else if (i === 4) {
        // Buy 5: 5 WHALES -> UPDATE EXISTING ALERT AGAIN
        assert.ok(evaluatedSignal != null, 'Buy 5 should trigger update');
        assert.strictEqual(evaluatedSignal.whaleCount, 5);
        assert.strictEqual(evaluatedSignal.isUpdate, true, 'Subsequent alert MUST be an update');

        const dispatchResults = await alertDispatcher.dispatchAlert(
          evaluatedSignal,
          mockBot,
          marketData,
          safety
        );

        const myResults = mine(dispatchResults);
        assert.strictEqual(myResults.length, 1);
        assert.strictEqual(myResults[0].action, 'edited');
        assert.strictEqual(myEdited().length, 2);
        assert.strictEqual(myEdited()[1].messageId, testMessageId);
        assert.match(myEdited()[1].text, /5 whales bought in 6h/);
      }
    }

    // Final acceptance checks
    console.log('\n--- BURST ALERT SIMULATION RESULTS (test chat only) ---');
    console.log(`Initial Alerts Sent: ${mySent().length} (Expected: 1)`);
    console.log(`Message Updates: ${myEdited().length} (Expected: 2)`);
    console.log(`Target Message ID: ${myEdited()[0]?.messageId} (Expected: ${testMessageId})`);

    assert.strictEqual(mySent().length, 1, 'Exactly 1 initial alert should be sent to the test chat');
    assert.strictEqual(myEdited().length, 2, 'Subsequent whale joins should edit the test-chat message');
    assert.strictEqual(myEdited()[1].messageId, testMessageId, 'Updates must target the original message ID');
  });
});
