import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateWallet, selectTopWhales } from '../src/providers/whale-sources/filter-engine.js';
import { CandidateWallet } from '../src/providers/whale-sources/types.js';

describe('Whale Selection Filter Engine', () => {
  const baseWallet: CandidateWallet = {
    chain: 'ethereum',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    estUsdBalance: 250000,
    swaps30d: 30,
    avgSwapsPerDay: 1.0,
    distinctTokensCount: 10,
    avgHoldingHours: 48,
    label: 'Smart Money Fund',
    category: 'fund',
    isContract: false,
    isExchangeOrBridge: false,
    isBot: false,
  };

  it('passes a legitimate whale trader and computes positive quality score', () => {
    const result = evaluateWallet(baseWallet);
    assert.strictEqual(result.passed, true);
    assert.ok(result.score > 50);
  });

  it('rejects a wallet with insufficient balance (< $100,000)', () => {
    const poorWallet: CandidateWallet = {
      ...baseWallet,
      estUsdBalance: 50000,
    };
    const result = evaluateWallet(poorWallet);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /Insufficient USD balance/);
  });

  it('rejects an inactive wallet with too few swaps (< 10 swaps in 30d)', () => {
    const inactiveWallet: CandidateWallet = {
      ...baseWallet,
      swaps30d: 5,
    };
    const result = evaluateWallet(inactiveWallet);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /Too few swaps in 30d/);
  });

  it('rejects a hyper-active wallet exceeding max swaps/day (> 40 swaps/day)', () => {
    const hyperWallet: CandidateWallet = {
      ...baseWallet,
      avgSwapsPerDay: 55,
    };
    const result = evaluateWallet(hyperWallet);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /Exceeds max swaps\/day/);
  });

  it('rejects exchange or bridge hot wallets', () => {
    const exchangeWallet: CandidateWallet = {
      ...baseWallet,
      isExchangeOrBridge: true,
    };
    const result = evaluateWallet(exchangeWallet);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /Exchange \/ Bridge/);
  });

  it('rejects smart contract accounts on Ethereum', () => {
    const contractAccount: CandidateWallet = {
      ...baseWallet,
      chain: 'ethereum',
      isContract: true,
    };
    const result = evaluateWallet(contractAccount);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /smart contract account/);
  });

  it('rejects bot flagged patterns', () => {
    const botWallet: CandidateWallet = {
      ...baseWallet,
      isBot: true,
    };
    const result = evaluateWallet(botWallet);
    assert.strictEqual(result.passed, false);
    assert.match(result.failedReason || '', /bot pattern/);
  });

  it('selects and ranks the top candidates up to walletCap', () => {
    const candidates: CandidateWallet[] = [
      { ...baseWallet, address: '0x1', distinctTokensCount: 20, avgHoldingHours: 72 },
      { ...baseWallet, address: '0x2', distinctTokensCount: 2, avgHoldingHours: 2 },
      { ...baseWallet, address: '0x3', estUsdBalance: 1000 }, // should fail
    ];

    const { selected, rejected } = selectTopWhales(candidates, {
      minWalletUsd: 100000,
      minSwaps30d: 10,
      maxSwapsPerDay: 40,
      walletCap: 1,
    });

    assert.strictEqual(selected.length, 1);
    assert.strictEqual(selected[0].address, '0x1');
    assert.strictEqual(rejected.length, 1);
  });
});
