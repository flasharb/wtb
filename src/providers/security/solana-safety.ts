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
import { config } from '../../config/index.js';

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

    // GoPlus hasn't indexed this token — fall back to direct on-chain checks via Helius RPC.
    if (!item) {
      return this.checkViaRpc(mint, t);
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

  // ---- Helius RPC fallback (when GoPlus has no data) ----
  private async rpc(method: string, params: any[]): Promise<any> {
    const url = `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (r.status === 429) {
          await this.sleep(500 * (attempt + 1));
          continue;
        }
        const j = (await r.json()) as any;
        if (j.error) throw new Error(JSON.stringify(j.error));
        return j.result;
      } catch (e) {
        if (attempt === 2) throw e;
        await this.sleep(400 * (attempt + 1));
      }
    }
  }

  private unverified(reason: string): TokenSafety {
    return {
      passed: false,
      reason,
      checks: [{ name: 'Contract', status: 'fail', detail: reason }],
      mintRevoked: false,
      freezeRevoked: false,
      transferable: false,
      holderCount: 0,
      top10Pct: 0,
      verified: false,
    };
  }

  /**
   * On-chain safety via Helius RPC — covers tokens GoPlus hasn't indexed. Verifies the
   * rug-critical facts (mint/freeze authority revoked, transferable/no honeypot extensions)
   * and a best-effort top-10 concentration (excluding the pool vault). Holder *count* isn't
   * available over basic RPC, so that one gate is skipped in the fallback.
   */
  private async checkViaRpc(mint: string, t: SafetyThresholds): Promise<TokenSafety> {
    const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    if (!config.HELIUS_API_KEY) return this.unverified('Could not verify token (no data)');

    let info: any;
    let largest: any;
    try {
      info = await this.rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
      largest = await this.rpc('getTokenLargestAccounts', [mint]);
    } catch {
      return this.unverified('Could not verify token (on-chain lookup failed)');
    }

    const parsed = info?.value?.data?.parsed?.info;
    const program = info?.value?.owner;
    if (!parsed) return this.unverified('Could not verify token (not a standard mint)');

    const checks: SafetyCheck[] = [];

    const mintRevoked = parsed.mintAuthority == null;
    checks.push({
      name: 'Mint authority',
      status: mintRevoked ? 'pass' : 'fail',
      detail: mintRevoked ? 'Revoked' : 'ACTIVE — supply can be inflated',
    });

    const freezeRevoked = parsed.freezeAuthority == null;
    checks.push({
      name: 'Freeze authority',
      status: freezeRevoked ? 'pass' : 'fail',
      detail: freezeRevoked ? 'Revoked' : 'ACTIVE — wallets can be frozen',
    });

    // Classic SPL token = no transfer hooks possible. Token-2022 = inspect extensions.
    const extensions: any[] = parsed.extensions || [];
    const hasHook = extensions.some((e) => e.extension === 'transferHook' && e.state?.programId);
    const nonTransferable = extensions.some((e) => e.extension === 'nonTransferable');
    const classic = program === TOKEN_PROGRAM;
    const transferable = classic || (!hasHook && !nonTransferable);
    checks.push({
      name: 'Transferable',
      status: transferable ? 'pass' : 'fail',
      detail: transferable ? (classic ? 'Yes (standard SPL)' : 'Yes') : 'Restricted — possible honeypot',
    });

    // Best-effort top-10 concentration: skip the single largest account (the pool vault).
    const decimals = parsed.decimals ?? 0;
    const supplyUi = Number(parsed.supply || 0) / Math.pow(10, decimals);
    const amounts: number[] = (largest?.value || [])
      .map((a: any) => a.uiAmount || 0)
      .sort((a: number, b: number) => b - a);
    const top10ExclPool = amounts.slice(1, 11).reduce((s, v) => s + v, 0);
    const top10Pct = supplyUi > 0 ? (top10ExclPool / supplyUi) * 100 : 0;
    const concentrationOk = top10Pct <= t.maxTop10Pct;
    checks.push({
      name: 'Top-10 holders',
      status: concentrationOk ? 'pass' : 'fail',
      detail: `${top10Pct.toFixed(1)}% of supply (excl. pool)`,
    });
    checks.push({ name: 'Source', status: 'warn', detail: 'On-chain (GoPlus had no data)' });

    const firstFail = checks.find((c) => c.status === 'fail');
    return this.result(checks, firstFail, mintRevoked, freezeRevoked, transferable, 0, top10Pct);
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
