'use client';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import Link from 'next/link';
import { api } from '@/lib/apiClient';
import { siwsLogin } from '@/lib/auth';
import { getToken, clearToken } from '@/lib/session';
import { shortAddr } from '@/lib/format';

type Me = { address: string; tradingWallet: string | null; tradingLive: boolean };
type WalletInfo = { address: string | null; balanceSol: number };
type Reveal = { mnemonic: string | null; secretKey: string };
type Config = {
  enabled: boolean; buySol: number; tpPct: number; slPct: number; trailPct: number;
  tpSellPct: number; slippageBps: number; maxConcurrent: number; maxDailyBuys: number; maxBuySol: number;
};
type Position = { id: number; token: string; tokenAddress: string; status: string; buySol: number; peakMultiple: number; tpHit: boolean };
type Portfolio = { balanceSol: number; open: number; closed: number; winRate: number; realizedPnlSol: number; feesPaidSol: number };

const PRESETS = {
  buy: [0.05, 0.1, 0.25, 0.5, 1, 2], tp: [50, 100, 150, 200, 300, 500], sl: [20, 30, 40, 50, 60],
  trail: [15, 20, 25, 30, 40], moon: [0, 25, 50, 75, 100], slip: [5, 10, 15, 20, 30],
  max: [1, 2, 3, 5, 10], daily: [5, 10, 20, 50, 100],
};
const nextCycle = (cur: number, arr: number[]) => arr.find((v) => v > cur + 1e-9) ?? arr[0];
const numStr = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

export default function AppPage() {
  const { publicKey, connected, signMessage, disconnect } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [hasToken, setHasToken] = useState(false);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [tradingLive, setTradingLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toAddr, setToAddr] = useState('');
  const [amt, setAmt] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => setHasToken(!!getToken()), []);

  const load = useCallback(async () => {
    try {
      const [m, w, c, p, pf] = await Promise.all([
        api<Me>('/me'), api<WalletInfo>('/wallet'), api<Config>('/trading/config'),
        api<Position[]>('/trading/positions'), api<Portfolio>('/trading/portfolio'),
      ]);
      setTradingLive(m.tradingLive); setWallet(w); setCfg(c); setPositions(p); setPortfolio(pf); setErr(null);
      if (address && m.address !== address) { clearToken(); setHasToken(false); }
    } catch (e: any) {
      setErr(e.message);
      if (/expired|login/i.test(e.message)) setHasToken(false);
    }
  }, [address]);

  useEffect(() => { if (hasToken) load(); }, [hasToken, load]);

  const signIn = async () => {
    if (!address || !signMessage) return;
    setBusy(true); setErr(null);
    try { await siwsLogin(address, signMessage); setHasToken(true); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const signOut = () => { clearToken(); setHasToken(false); setWallet(null); setCfg(null); disconnect().catch(() => {}); };

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { setCfg(await api<Config>('/trading/config', { method: 'PATCH', body })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const createW = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ address: string; mnemonic: string; secretKey: string }>('/wallet/create', { method: 'POST' });
      setReveal({ mnemonic: r.mnemonic, secretKey: r.secretKey }); setShowSecret(false); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const exportW = async () => {
    setBusy(true); setErr(null);
    try { setReveal(await api<Reveal>('/wallet/export', { method: 'POST' })); setShowSecret(false); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const doWithdraw = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sig: string }>('/wallet/withdraw', { method: 'POST', body: { toAddress: toAddr, amountSol: Number(amt) } });
      setToAddr(''); setAmt('');
      setErr(null);
      alert('Sent! Tx: ' + r.sig);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="container-x py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="font-display text-lg font-bold text-white">Stack<span className="text-brand-400">Alpha</span></Link>
        <div className="flex items-center gap-2">
          <WalletMultiButton style={{ background: '#7c3aed', height: 40, borderRadius: 12, fontSize: 14 }} />
          {hasToken && <button className="btn-ghost" onClick={signOut}>Sign out</button>}
        </div>
      </div>

      {err && <div className="card mb-4 border-red-500/40 text-sm text-red-300">{err}</div>}
      {!tradingLive && hasToken && <div className="card mb-4 border-amber-500/40 text-sm text-amber-300">Trading isn’t switched on yet — settings save, but buys won’t run.</div>}

      {!connected ? (
        <div className="card text-center">
          <h1 className="font-display text-2xl font-bold text-white">Connect your wallet</h1>
          <p className="mt-2 text-brand-100/70">Sign in with Phantom, Solflare or Backpack — no email, no password.</p>
          <div className="mt-6 flex justify-center"><WalletMultiButton style={{ background: '#7c3aed', borderRadius: 12 }} /></div>
        </div>
      ) : !hasToken ? (
        <div className="card text-center">
          <h1 className="font-display text-2xl font-bold text-white">Sign in</h1>
          <p className="mt-2 text-brand-100/70">Sign a message to prove you own <span className="text-brand-200">{shortAddr(address || '')}</span>. It’s free and triggers no transaction.</p>
          <button className="btn-primary mt-6" onClick={signIn} disabled={busy}>{busy ? 'Waiting for signature…' : 'Sign in with Solana'}</button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Seed/key reveal — shown once on create, or on export */}
          {reveal && (
            <div className="card border-gold/50 lg:col-span-2">
              <h3 className="font-display text-lg font-bold text-gold">🔑 Save your wallet keys</h3>
              <p className="mt-1 text-sm text-red-300">Anyone with these can take your funds. Save them offline — we can’t recover them for you. This is a hot wallet; only keep what you’re actively trading.</p>
              {reveal.mnemonic && (
                <div className="mt-3">
                  <p className="text-xs text-brand-100/60">Seed phrase (import into Phantom/Solflare)</p>
                  <div className={`mt-1 rounded-lg bg-ink-950/60 p-3 text-sm leading-relaxed ${showSecret ? '' : 'select-none blur-sm'}`}>{reveal.mnemonic}</div>
                </div>
              )}
              <div className="mt-3">
                <p className="text-xs text-brand-100/60">Private key</p>
                <code className={`mt-1 block break-all rounded-lg bg-ink-950/60 p-2 text-xs ${showSecret ? '' : 'select-none blur-sm'}`}>{reveal.secretKey}</code>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => setShowSecret((s) => !s)}>{showSecret ? 'Hide' : 'Reveal'}</button>
                <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(reveal.mnemonic || reveal.secretKey)}>Copy</button>
                <button className="btn-primary" onClick={() => { setReveal(null); setShowSecret(false); }}>I’ve saved it</button>
              </div>
            </div>
          )}

          {/* Autopilot */}
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-white">🤖 Autopilot</h2>
              {cfg && (
                <button className={cfg.enabled ? 'btn-ghost' : 'btn-primary'} onClick={() => patch({ enabled: !cfg.enabled })} disabled={busy}>
                  {cfg.enabled ? '🔴 Disable' : '🟢 Enable'}
                </button>
              )}
            </div>
            {!cfg ? <p className="mt-4 text-brand-100/50">Loading…</p> : (
              <>
                <p className="mt-1 text-sm text-brand-100/60">Status: {cfg.enabled ? <span className="text-emerald-400">ON</span> : <span className="text-brand-100/60">OFF</span>} · tap a setting to change it</p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SetBtn label={`💰 Buy ${numStr(cfg.buySol)} SOL`} onClick={() => patch({ buySol: nextCycle(cfg.buySol, PRESETS.buy.filter((v) => v <= cfg.maxBuySol)) })} busy={busy} />
                  <SetBtn label={`🎯 TP +${cfg.tpPct}%`} onClick={() => patch({ tpPct: nextCycle(cfg.tpPct, PRESETS.tp) })} busy={busy} />
                  <SetBtn label={`🛑 SL -${cfg.slPct}%`} onClick={() => patch({ slPct: nextCycle(cfg.slPct, PRESETS.sl) })} busy={busy} />
                  <SetBtn label={`📉 Trail ${cfg.trailPct}%`} onClick={() => patch({ trailPct: nextCycle(cfg.trailPct, PRESETS.trail) })} busy={busy} />
                  <SetBtn label={`🌙 Moon ${cfg.tpSellPct}%`} onClick={() => patch({ tpSellPct: nextCycle(cfg.tpSellPct, PRESETS.moon) })} busy={busy} />
                  <SetBtn label={`↔️ Slip ${numStr(cfg.slippageBps / 100)}%`} onClick={() => patch({ slippageBps: Math.round(nextCycle(cfg.slippageBps / 100, PRESETS.slip) * 100) })} busy={busy} />
                  <SetBtn label={`🔢 Max ${cfg.maxConcurrent}`} onClick={() => patch({ maxConcurrent: nextCycle(cfg.maxConcurrent, PRESETS.max) })} busy={busy} />
                  <SetBtn label={`📆 Daily ${cfg.maxDailyBuys}`} onClick={() => patch({ maxDailyBuys: nextCycle(cfg.maxDailyBuys, PRESETS.daily) })} busy={busy} />
                </div>
              </>
            )}
          </div>

          {/* Wallet */}
          <div className="card">
            <h2 className="font-display text-lg font-bold text-white">💰 Trading wallet</h2>
            {!wallet ? <p className="mt-4 text-brand-100/50">Loading…</p> : wallet.address === null ? (
              <div className="mt-3">
                <p className="text-sm text-brand-100/60">Create your in-app trading wallet. You’ll get a seed phrase to save — it runs autopilot and you can withdraw to your own wallet anytime.</p>
                <button className="btn-primary mt-4" onClick={createW} disabled={busy}>{busy ? 'Creating…' : 'Create wallet'}</button>
              </div>
            ) : (
              <>
                <p className="mt-3 text-sm text-brand-100/60">Balance</p>
                <p className="font-display text-2xl font-bold text-white">{wallet.balanceSol.toFixed(4)} SOL</p>
                <p className="mt-3 text-xs text-brand-100/60">Deposit SOL to:</p>
                <code className="mt-1 block cursor-pointer break-all rounded-lg bg-ink-950/60 p-2 text-xs text-brand-200" onClick={() => navigator.clipboard?.writeText(wallet.address || '')}>{wallet.address}</code>
                <div className="mt-4 space-y-2">
                  <input className="w-full rounded-lg border border-ink-border bg-ink-950/60 p-2 text-sm" placeholder="Withdraw to address" value={toAddr} onChange={(e) => setToAddr(e.target.value)} />
                  <div className="flex gap-2">
                    <input className="w-full rounded-lg border border-ink-border bg-ink-950/60 p-2 text-sm" placeholder="Amount SOL" value={amt} onChange={(e) => setAmt(e.target.value)} />
                    <button className="btn-ghost shrink-0" onClick={doWithdraw} disabled={busy || !toAddr || !amt}>Withdraw</button>
                  </div>
                  <button className="btn-ghost w-full text-xs" onClick={exportW} disabled={busy}>🔑 Export seed / private key</button>
                </div>
              </>
            )}
          </div>

          {/* Portfolio */}
          <div className="card">
            <h2 className="font-display text-lg font-bold text-white">🧾 Portfolio</h2>
            {!portfolio ? <p className="mt-4 text-brand-100/50">Loading…</p> : (
              <div className="mt-3 space-y-2 text-sm">
                <Row k="Open positions" v={String(portfolio.open)} />
                <Row k="Closed trades" v={`${portfolio.closed} · ${portfolio.winRate}% win`} />
                <Row k="Realized P&L" v={`${portfolio.realizedPnlSol >= 0 ? '+' : ''}${portfolio.realizedPnlSol.toFixed(4)} SOL`} accent={portfolio.realizedPnlSol >= 0} />
                <Row k="Fees paid (1%)" v={`${portfolio.feesPaidSol.toFixed(4)} SOL`} />
              </div>
            )}
          </div>

          {/* Positions */}
          <div className="card lg:col-span-2">
            <h2 className="font-display text-lg font-bold text-white">📈 Open positions</h2>
            {positions.length === 0 ? <p className="mt-3 text-sm text-brand-100/50">None yet — autopilot opens one on each qualifying call.</p> : (
              <div className="mt-3 space-y-2">
                {positions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-ink-950/40 px-3 py-2 text-sm">
                    <span className="text-white">{p.token}{p.tpHit ? ' · 🎯' : ''}</span>
                    <span className="text-brand-100/60">in {p.buySol.toFixed(3)} SOL · peak {p.peakMultiple.toFixed(2)}x</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SetBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return <button className="btn-ghost w-full text-xs sm:text-sm" onClick={onClick} disabled={busy}>{label}</button>;
}
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return <div className="flex justify-between"><span className="text-brand-100/60">{k}</span><span className={accent ? 'text-emerald-400' : 'text-white'}>{v}</span></div>;
}
