import { pool } from '../db/index.js';

/** Public, read-only aggregates over the launch calls. Served by the /api/public routes and
 * consumed by the web app. Small in-memory cache so the marketing site can't hammer the DB. */

export interface CallDto {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  dex: string | null;
  liquidityUsd: number;
  holderCount: number;
  peakMultiple: number;
  alertedAt: string | null;
  status: string;
  reportedFade: boolean;
}

export interface TrackRecordDto {
  total: number;
  x2: number;
  x3: number;
  x5: number;
  x10: number;
  avgPeak: number;
  best: number;
  rugged: number;
  faded: number;
}

const EMPTY: TrackRecordDto = { total: 0, x2: 0, x3: 0, x5: 0, x10: 0, avgPeak: 1, best: 1, rugged: 0, faded: 0 };

type Cached<T> = { at: number; data: T };
const cache = new Map<string, Cached<unknown>>();
const TTL_MS = 30_000;

async function cached<T>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e: any) {
    console.error(`[api/stats] ${key} failed:`, e?.message ?? e);
    return hit?.data ?? fallback;
  }
}

const CALL_COLS = `
  token_address as "tokenAddress", symbol, name, dex,
  liquidity_usd::float as "liquidityUsd", holder_count as "holderCount",
  peak_multiple as "peakMultiple", alerted_at as "alertedAt",
  status, reported_fade as "reportedFade"`;

export function getTrackRecord(): Promise<TrackRecordDto> {
  return cached(
    'track',
    async () => {
      const { rows } = await pool.query(
        `select
           count(*)::int as total,
           count(*) filter (where peak_multiple >= 2)::int as x2,
           count(*) filter (where peak_multiple >= 3)::int as x3,
           count(*) filter (where peak_multiple >= 5)::int as x5,
           count(*) filter (where peak_multiple >= 10)::int as x10,
           coalesce(avg(peak_multiple), 1)::float as "avgPeak",
           coalesce(max(peak_multiple), 1)::float as best,
           count(*) filter (where status = 'closed')::int as rugged,
           count(*) filter (where reported_fade)::int as faded
         from launch_candidates
         where status in ('alerted', 'closed')`
      );
      return (rows[0] as TrackRecordDto) ?? EMPTY;
    },
    EMPTY
  );
}

export function getRecentCalls(limit = 30): Promise<CallDto[]> {
  const n = Math.min(100, Math.max(1, limit));
  return cached(
    `recent:${n}`,
    async () => {
      const { rows } = await pool.query(
        `select ${CALL_COLS}
         from launch_candidates
         where status in ('alerted', 'closed') and alerted_at is not null
         order by alerted_at desc
         limit $1`,
        [n]
      );
      return rows as CallDto[];
    },
    []
  );
}

export function getTopCalls(limit = 6): Promise<CallDto[]> {
  const n = Math.min(50, Math.max(1, limit));
  return cached(
    `top:${n}`,
    async () => {
      const { rows } = await pool.query(
        `select ${CALL_COLS}
         from launch_candidates
         where status in ('alerted', 'closed') and peak_multiple > 1.05
         order by peak_multiple desc
         limit $1`,
        [n]
      );
      return rows as CallDto[];
    },
    []
  );
}
