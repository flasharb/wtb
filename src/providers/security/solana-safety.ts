/**
 * Real Solana token safety via GoPlus (free, no key).
 * GET https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=<mint>
 *
 * Strict checks (any hard fail suppresses the alert):
 *   - mint authority revoked        (mintable.status === "0")
 *   - freeze authority revoked      (freezable.status === "0")
 *   - transferable / not honeypot   (non_transferable === "0", no active transfer hook)
 *   - balance not mutable           (balance_mutable_authority.status === "0")
 *   - enough holders                (holder_count >= minHolders)
 *   - not over-concentrated         (top-10 non-pool/unlocked holders <= maxTop10Pct)
 * Warnings (shown, not suppressed): mutable metadata, nonzero transfer fee.
 */

export interface SafetyCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface TokenSafety {
  passed: boolean;
  reason?: string; // first hard-fail reason
  checks: SafetyCheck[];
  mintRevoked: boolean;
  freezeRevoked: boolean;
  transferable: boolean;
  holderCount: number;
  top10Pct: number;
  verified: boolean; // did GoPlus return data at all
}

export interface SafetyThresholds {
  minHolders: number;
  maxTop10Pct: number;
}

export class SolanaSafetyChecker {
  async check(mint: string, t: SafetyThresholds): Promise<TokenSafety> {
    const checks: SafetyCheck[] = [];
    let item: any = null;
    const url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`;
    // GoPlus rate-limits bursts; retry on 429/empty with backoff.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 429) {
          await this.sleep(1500 * (attempt + 1));
          continue;
        }
        if (r.ok) {
          const j = (await r.json()) as any;
          item = j?.result?.[mint] || (j?.result ? Object.values(j.result)[0] : null);
          if (item) break;
        }
      } catch {
        /* retry */
      }
      await this.sleep(900 * (attempt + 1));
    }

    if (!item) {
      return {
        passed: false,
        reason: 'Could not verify token (no security data)',
        checks: [{ name: 'Contract', status: 'fail', detail: 'No security data available' }],
        mintRevoked: false,
        freezeRevoked: false,
        transferable: false,
        holderCount: 0,
        top10Pct: 0,
        verified: false,
      };
    }

    const statusZero = (v: any) => String(v?.status ?? v) === '0';

    // 1. Mint authority
    const mintRevoked = statusZero(item.mintable);
    checks.push({
      name: 'Mint authority',
      status: mintRevoked ? 'pass' : 'fail',
      detail: mintRevoked ? 'Revoked' : 'ACTIVE — supply can be inflated',
    });

    // 2. Freeze authority
    const freezeRevoked = statusZero(item.freezable);
    checks.push({
      name: 'Freeze authority',
      status: freezeRevoked ? 'pass' : 'fail',
      detail: freezeRevoked ? 'Revoked' : 'ACTIVE — wallets can be frozen',
    });

    // 3. Transferable / honeypot
    const nonTransferable = String(item.non_transferable ?? '0') === '1';
    const hasHook = Array.isArray(item.transfer_hook) && item.transfer_hook.length > 0;
    const transferable = !nonTransferable && !hasHook;
    checks.push({
      name: 'Transferable',
      status: transferable ? 'pass' : 'fail',
      detail: transferable ? 'Yes (no honeypot traits)' : 'Restricted — possible honeypot',
    });

    // 4. Balance mutable authority
    const balanceSafe = statusZero(item.balance_mutable_authority);
    checks.push({
      name: 'Balances',
      status: balanceSafe ? 'pass' : 'fail',
      detail: balanceSafe ? 'Immutable' : 'Mutable — balances can be changed',
    });

    // 5. Holder count
    const holderCount = parseInt(item.holder_count || '0', 10) || 0;
    const enoughHolders = holderCount >= t.minHolders;
    checks.push({
      name: 'Holders',
      status: enoughHolders ? 'pass' : 'fail',
      detail: `${holderCount.toLocaleString()}${enoughHolders ? '' : ` (min ${t.minHolders})`}`,
    });

    // 6. Top-10 concentration (exclude pools/tagged/locked holders)
    const holders: any[] = Array.isArray(item.holders) ? item.holders : [];
    const realHolders = holders.filter((h) => !h.tag && Number(h.is_locked) !== 1);
    const top10Pct =
      realHolders
        .slice(0, 10)
        .reduce((s, h) => s + (parseFloat(h.percent || '0') || 0), 0) * 100;
    const concentrationOk = top10Pct <= t.maxTop10Pct;
    checks.push({
      name: 'Top-10 holders',
      status: concentrationOk ? 'pass' : 'fail',
      detail: `${top10Pct.toFixed(1)}% of supply${concentrationOk ? '' : ` (max ${t.maxTop10Pct}%)`}`,
    });

    // Warnings (do not suppress)
    if (!statusZero(item.metadata_mutable)) {
      checks.push({ name: 'Metadata', status: 'warn', detail: 'Mutable' });
    }
    const feeObj = item.transfer_fee;
    const hasFee = feeObj && typeof feeObj === 'object' && Object.keys(feeObj).length > 0;
    if (hasFee) {
      checks.push({ name: 'Transfer fee', status: 'warn', detail: 'Token has a transfer fee/tax' });
    }

    const firstFail = checks.find((c) => c.status === 'fail');
    return this.result(checks, firstFail, mintRevoked, freezeRevoked, transferable, holderCount, top10Pct);
  }

  private result(
    checks: SafetyCheck[],
    firstFail: SafetyCheck | undefined,
    mintRevoked: boolean,
    freezeRevoked: boolean,
    transferable: boolean,
    holderCount: number,
    top10Pct: number
  ): TokenSafety {
    return {
      passed: !firstFail,
      reason: firstFail ? `${firstFail.name}: ${firstFail.detail}` : undefined,
      checks,
      mintRevoked,
      freezeRevoked,
      transferable,
      holderCount,
      top10Pct,
      verified: true,
    };
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
