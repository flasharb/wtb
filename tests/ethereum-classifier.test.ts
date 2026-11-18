import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyEthereumTx } from '../src/classify/ethereum.js';
import {
  ethereumFixtures,
  WHALE_ETH_WALLET,
  TARGET_ERC20_TOKEN,
  SECOND_ERC20_TOKEN,
} from './fixtures/ethereum-fixtures.js';

describe('Ethereum Buy Classifier (12 Fixtures)', () => {
  it('1. detects Uniswap V3 ETH -> Token swap ($15,000)', () => {
    const fixture = ethereumFixtures.uniswapV3EthSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.tokenAddress, TARGET_ERC20_TOKEN.toLowerCase());
    assert.strictEqual(res.buy.quoteAsset, 'ETH');
  });

  it('2. detects Uniswap V2 USDC -> Token swap ($20,000)', () => {
    const fixture = ethereumFixtures.uniswapV2UsdcSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.quoteAsset, 'USDC');
  });

  it('3. detects 1inch Multi-Hop WETH -> Token swap ($90,000 High Conviction)', () => {
    const fixture = ethereumFixtures.aggregator1inchWethSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.tokenAddress, SECOND_ERC20_TOKEN.toLowerCase());
    assert.strictEqual(res.buy.quoteAsset, 'WETH');
  });

  it('4. detects CowSwap DAI -> Token swap ($12,000)', () => {
    const fixture = ethereumFixtures.cowSwapDaiSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, true);
    assert.ok(res.buy);
    assert.strictEqual(res.buy.usdValue, fixture.expectedUsd);
    assert.strictEqual(res.buy.quoteAsset, 'DAI');
  });

  it('5. ignores token sell swap (selling token for WETH)', () => {
    const fixture = ethereumFixtures.tokenSellSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('6. ignores stable-to-stable swap (USDC -> DAI)', () => {
    const fixture = ethereumFixtures.stableToStableSwap;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('7. ignores plain ERC-20 transfer in / airdrop (no quote outflow)', () => {
    const fixture = ethereumFixtures.plainErc20TransferIn;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No quote asset outflow/);
  });

  it('8. ignores exchange withdrawal of native ETH', () => {
    const fixture = ethereumFixtures.exchangeWithdrawalEth;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /No non-quote target token received/);
  });

  it('9. ignores small buy below threshold ($3,000 < $5,000)', () => {
    const fixture = ethereumFixtures.smallBuyBelowThreshold;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /below threshold/);
  });

  it('10. ignores reverted / failed transaction (status: 0)', () => {
    const fixture = ethereumFixtures.revertedTx;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
    assert.match(res.ignoredReason || '', /Transaction failed/);
  });

  it('11. ignores liquidity pool deposit', () => {
    const fixture = ethereumFixtures.uniswapLpDeposit;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
  });

  it('12. ignores bridge deposit outflow', () => {
    const fixture = ethereumFixtures.bridgeDeposit;
    const res = classifyEthereumTx(fixture.tx, WHALE_ETH_WALLET);

    assert.strictEqual(res.isBuy, false);
  });
});
