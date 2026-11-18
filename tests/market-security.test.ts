import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DexScreenerMarketProvider } from '../src/providers/market/market-data-provider.js';
import { TokenSecurityChecker } from '../src/providers/security/safety-checker.js';

describe('Market Data & Token Security Checker', () => {
  const marketProvider = new DexScreenerMarketProvider();
  const securityChecker = new TokenSecurityChecker();

  it('fetches or parses market data correctly with caching', async () => {
    // Set mock data
    marketProvider.setMockData('solana', 'test_mint_1', {
      chain: 'solana',
      tokenAddress: 'test_mint_1',
      name: 'Alpha Doge',
      symbol: 'ADOGE',
      priceUsd: 1.5,
      liquidityUsd: 250000,
      fdvUsd: 1500000,
      volume24hUsd: 500000,
      pairCreatedAt: new Date(Date.now() - 3600 * 1000 * 24), // 1 day old
    });

    const data = await marketProvider.getTokenMarketData('solana', 'test_mint_1');
    assert.ok(data);
    assert.strictEqual(data.symbol, 'ADOGE');
    assert.strictEqual(data.priceUsd, 1.5);
    assert.strictEqual(data.liquidityUsd, 250000);
  });

  it('passes safety checks for a healthy, liquid token', async () => {
    const result = await securityChecker.evaluateToken(
      'solana',
      'test_mint_healthy',
      {
        liquidityUsd: 150000, // Above $50k min
        fdvUsd: 1500000,
        pairCreatedAt: new Date(Date.now() - 3600 * 1000 * 48), // 2 days old (> 30 min)
      }
    );

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.hardFailReason, undefined);
    assert.ok(result.items.some((i) => i.name === 'Pool Liquidity' && i.status === 'pass'));
  });

  it('hard-fails safety check when liquidity is below threshold ($20k < $50k)', async () => {
    const result = await securityChecker.evaluateToken(
      'solana',
      'test_mint_low_liq',
      {
        liquidityUsd: 20000, // Below $50,000
        fdvUsd: 1000000,
        pairCreatedAt: new Date(Date.now() - 3600 * 1000),
      }
    );

    assert.strictEqual(result.passed, false);
    assert.match(result.hardFailReason || '', /Insufficient liquidity/);
    assert.ok(result.items.some((i) => i.name === 'Pool Liquidity' && i.status === 'fail'));
  });

  it('hard-fails safety check when token is younger than 30 minutes', async () => {
    const result = await securityChecker.evaluateToken(
      'ethereum',
      '0xtest_token_young',
      {
        liquidityUsd: 100000,
        fdvUsd: 500000,
        pairCreatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes old (< 30 min)
      },
      { allowNewTokens: false }
    );

    assert.strictEqual(result.passed, false);
    assert.match(result.hardFailReason || '', /Token too young/);
    assert.ok(result.items.some((i) => i.name === 'Token Age' && i.status === 'fail'));
  });

  it('allows young token when allowNewTokens is enabled', async () => {
    const result = await securityChecker.evaluateToken(
      'ethereum',
      '0xtest_token_young_allowed',
      {
        liquidityUsd: 100000,
        fdvUsd: 500000,
        pairCreatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes old
      },
      { allowNewTokens: true }
    );

    assert.strictEqual(result.passed, true);
    assert.ok(result.items.some((i) => i.name === 'Token Age' && i.status === 'warn'));
  });
});
