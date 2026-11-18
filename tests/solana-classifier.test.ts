import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifySolanaSwap } from '../src/classify/solana.js';
import { solanaFixtures, WHALE_SOL_WALLET, TARGET_TOKEN_MINT } from './fixtures/solana-fixtures.js';

describe('Solana Buy Classifier (11 Fixtures)', () => {
  it('1. detects Jupiter SOL -> Token swap ($10,000)', () => {
    const fixture = solanaFixtures.jupiterSolSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.tokenAddress, TARGET_TOKEN_MINT);
    assert.strictEqual(res.buy.quoteAsset, 'SOL');
  });

  it('2. detects Raydium USDC -> Token swap ($15,000)', () => {
    const fixture = solanaFixtures.raydiumUsdcSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.quoteAsset, 'USDC');
  });

  it('3. detects Pump.fun SOL -> Meme Coin swap ($7,000)', () => {
    const fixture = solanaFixtures.pumpFunSolSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.quoteAsset, 'SOL');
  });

  it('4. detects Jupiter Aggregator Multi-Hop route ($50,000 High Conviction)', () => {
    const fixture = solanaFixtures.aggregatorMultiHopSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
  });

  it('5. ignores token sell swap (selling token for SOL)', () => {
    const fixture = solanaFixtures.tokenSellSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('6. ignores stable-to-stable swap (USDC -> USDT)', () => {
    const fixture = solanaFixtures.stableToStableSwap;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('7. ignores plain token airdrop (no quote outflow)', () => {
    const fixture = solanaFixtures.plainAirdrop;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No quote asset outflow/);
  });

  it('8. ignores exchange withdrawal of SOL (native asset transfer)', () => {
    const fixture = solanaFixtures.exchangeWithdrawalSol;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('9. ignores small buy below threshold ($1,600 < $5,000)', () => {
    const fixture = solanaFixtures.smallBuyBelowThreshold;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /below threshold/);
  });

  it('10. ignores failed / reverted on-chain transaction', () => {
    const fixture = solanaFixtures.failedTransaction;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /Transaction failed/);
  });

  it('11. ignores liquidity pool deposit', () => {
    const fixture = solanaFixtures.liquidityPoolDeposit;
    const res = classifySolanaSwap(fixture.tx, WHALE_SOL_WALLET);

    assert.strictEqual(res.isBuy, false);
  });
});
