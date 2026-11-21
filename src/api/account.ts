import { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requireAuth, userId } from './auth.js';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { positions, fees } from '../db/schema.js';
import { tokenTicker } from '../bot/formatters.js';
import { tradingLive } from '../trading/engine.js';
import { getPublicKey, getBalanceSol, withdrawSol, createWallet, exportWallet } from '../trading/wallet.js';
import { getOrCreateConfig, updateConfig, TradingConfig } from '../trading/store.js';
import { lamportsToSol } from '../trading/solana.js';

// DTOs mirror the bot's /autotrade dashboard so the web renders the same thing.
function configDto(c: TradingConfig) {
  return {
    enabled: c.enabled,
    buySol: Number(c.buySol),
    tpPct: c.tpPct,
    slPct: c.slPct,
    trailPct: c.trailPct,
    tpSellPct: c.tpSellPct,
    slippageBps: c.slippageBps,
    maxConcurrent: c.maxConcurrent,
    maxDailyBuys: c.maxDailyBuys,
    maxBuySol: config.TRADE_MAX_BUY_SOL,
  };
}

function positionDto(p: typeof positions.$inferSelect) {
  return {
    id: p.id,
    token: tokenTicker(p.symbol, p.tokenAddress),
    tokenAddress: p.tokenAddress,
    symbol: p.symbol,
    status: p.status,
    buySol: lamportsToSol(Number(p.costLamports)),
    peakMultiple: p.peakMultiple,
    tpHit: p.tpHit,
    openedAt: p.openedAt,
  };
}

// Same bounds as the bot's setters (src/bot/trading.ts).
function validatePatch(body: any): { value: Partial<TradingConfig> } | { error: string } {
  const out: any = {};
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  if (body == null || typeof body !== 'object') return { error: 'Invalid body' };
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be boolean' };
    out.enabled = body.enabled;
  }
  if ('buySol' in body) {
    const v = num(body.buySol);
    if (!(v >= 0.001 && v <= config.TRADE_MAX_BUY_SOL)) return { error: `buySol 0.001–${config.TRADE_MAX_BUY_SOL}` };
    out.buySol = String(v);
  }
  if ('tpPct' in body) { const v = num(body.tpPct); if (!(v >= 10 && v <= 10000)) return { error: 'tpPct 10–10000' }; out.tpPct = v; }
  if ('slPct' in body) { const v = num(body.slPct); if (!(v >= 1 && v <= 95)) return { error: 'slPct 1–95' }; out.slPct = v; }
  if ('trailPct' in body) { const v = num(body.trailPct); if (!(v >= 1 && v <= 90)) return { error: 'trailPct 1–90' }; out.trailPct = v; }
  if ('tpSellPct' in body) { const v = num(body.tpSellPct); if (!(v >= 0 && v <= 100)) return { error: 'tpSellPct 0–100' }; out.tpSellPct = v; }
  if ('slippageBps' in body) { const v = num(body.slippageBps); if (!(v >= 50 && v <= 5000)) return { error: 'slippageBps 50–5000' }; out.slippageBps = Math.round(v); }
  if ('maxConcurrent' in body) { const v = num(body.maxConcurrent); if (!(v >= 1 && v <= 50 && Number.isInteger(v))) return { error: 'maxConcurrent 1–50' }; out.maxConcurrent = v; }
  if ('maxDailyBuys' in body) { const v = num(body.maxDailyBuys); if (!(v >= 1 && v <= 200 && Number.isInteger(v))) return { error: 'maxDailyBuys 1–200' }; out.maxDailyBuys = v; }
  if (Object.keys(out).length === 0) return { error: 'No valid fields' };
  return { value: out };
}

const unavailable = (reply: any) => reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Trading is not enabled yet' } });

export function registerAccountRoutes(server: FastifyInstance) {
  server.get('/api/v1/me', { preHandler: requireAuth }, async (req) => {
    const u = userId(req);
    const wallet = await getPublicKey(u);
    return { data: { address: u, tradingWallet: wallet, tradingLive: tradingLive() } };
  });

  // ---- Wallet ----
  // Does NOT auto-create — the web shows a "Create wallet" step so the user can save the seed.
  server.get('/api/v1/wallet', { preHandler: requireAuth }, async (req, reply) => {
    if (!tradingLive()) return unavailable(reply);
    const address = await getPublicKey(userId(req));
    if (!address) return { data: { address: null, balanceSol: 0 } };
    let balanceSol = 0;
    try { balanceSol = await getBalanceSol(address); } catch { /* rpc blip */ }
    return { data: { address, balanceSol } };
  });

  // Create the exportable trading wallet; returns seed + key ONCE.
  server.post('/api/v1/wallet/create', { preHandler: requireAuth }, async (req, reply) => {
    if (!tradingLive()) return unavailable(reply);
    try {
      return { data: await createWallet(userId(req)) };
    } catch (e: any) {
      return reply.status(409).send({ error: { code: 'WALLET_EXISTS', message: e?.message ?? 'Wallet exists' } });
    }
  });

  // Reveal the seed phrase + private key of the existing wallet (re-auth gated upstream later).
  server.post('/api/v1/wallet/export', { preHandler: requireAuth }, async (req, reply) => {
    if (!tradingLive()) return unavailable(reply);
    try {
      return { data: await exportWallet(userId(req)) };
    } catch (e: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: e?.message ?? 'No wallet' } });
    }
  });

  server.post('/api/v1/wallet/withdraw', { preHandler: requireAuth }, async (req, reply) => {
    if (!tradingLive()) return unavailable(reply);
    const { toAddress, amountSol } = (req.body as any) || {};
    const amt = Number(amountSol);
    if (!toAddress || !(amt > 0)) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'toAddress and positive amountSol required' } });
    try {
      const { sig } = await withdrawSol(userId(req), String(toAddress), amt);
      return { data: { sig } };
    } catch (e: any) {
      return reply.status(400).send({ error: { code: 'WITHDRAW_FAILED', message: e?.message ?? 'Withdraw failed' } });
    }
  });

  // ---- Autopilot config (mirrors bot /autotrade settings) ----
  server.get('/api/v1/trading/config', { preHandler: requireAuth }, async (req) => {
    return { data: configDto(await getOrCreateConfig(userId(req))) };
  });

  server.patch('/api/v1/trading/config', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = validatePatch(req.body);
    if ('error' in parsed) return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error } });
    // Enabling requires a funded wallet (same rule as the bot).
    if (parsed.value.enabled === true) {
      if (!tradingLive()) return unavailable(reply);
      const addr = await getPublicKey(userId(req));
      let bal = 0;
      if (addr) { try { bal = await getBalanceSol(addr); } catch { /* */ } }
      const cfg = await getOrCreateConfig(userId(req));
      if (bal < Number(cfg.buySol) + config.TRADE_FEE_RESERVE_SOL) {
        return reply.status(400).send({ error: { code: 'INSUFFICIENT_BALANCE', message: `Fund your wallet first (≥ ${(Number(cfg.buySol) + config.TRADE_FEE_RESERVE_SOL).toFixed(3)} SOL)` } });
      }
    }
    await getOrCreateConfig(userId(req));
    const updated = await updateConfig(userId(req), parsed.value);
    return { data: configDto(updated) };
  });

  // ---- Positions + portfolio (mirrors bot /positions, /portfolio) ----
  server.get('/api/v1/trading/positions', { preHandler: requireAuth }, async (req) => {
    const u = userId(req);
    const rows = await db
      .select().from(positions)
      .where(and(eq(positions.telegramUserId, u), eq(positions.status, 'open')))
      .orderBy(desc(positions.openedAt)).limit(50);
    return { data: rows.map(positionDto) };
  });

  server.get('/api/v1/trading/portfolio', { preHandler: requireAuth }, async (req) => {
    const u = userId(req);
    const [agg] = await db
      .select({
        closed: sql<number>`count(*) filter (where ${positions.status} = 'closed')::int`,
        open: sql<number>`count(*) filter (where ${positions.status} = 'open')::int`,
        realized: sql<string>`coalesce(sum(${positions.realizedPnlLamports}) filter (where ${positions.status} = 'closed'), 0)`,
        wins: sql<number>`count(*) filter (where ${positions.status} = 'closed' and ${positions.realizedPnlLamports} > 0)::int`,
      })
      .from(positions)
      .where(eq(positions.telegramUserId, u));
    const [feeAgg] = await db
      .select({ paid: sql<string>`coalesce(sum(${fees.feeLamports}) filter (where ${fees.status} = 'swept'), 0)` })
      .from(fees)
      .where(eq(fees.telegramUserId, u));
    const addr = await getPublicKey(u);
    let balanceSol = 0;
    if (addr) { try { balanceSol = await getBalanceSol(addr); } catch { /* */ } }
    const closed = agg?.closed ?? 0;
    const wins = agg?.wins ?? 0;
    return {
      data: {
        balanceSol,
        open: agg?.open ?? 0,
        closed,
        winRate: closed > 0 ? Math.round((wins / closed) * 100) : 0,
        realizedPnlSol: lamportsToSol(Number(agg?.realized ?? 0)),
        feesPaidSol: lamportsToSol(Number(feeAgg?.paid ?? 0)),
      },
    };
  });
}
