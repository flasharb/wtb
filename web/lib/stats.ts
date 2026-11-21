import { query } from './db';

export interface Call {
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

export interface TrackRecord {
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

const EMPTY_RECORD: TrackRecord = { total: 0, x2: 0, x3: 0, x5: 0, x10: 0, avgPeak: 1, best: 1, rugged: 0, faded: 0 };

// Light in-memory cache so repeated SSR renders don't hammer the DB (data changes slowly).
type Cached<T> = { at: number; data: T };
const cache = new Map<string, Cached<unknown>>();
const TTL_MS = 60_000;

async function cached<T>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error(`[stats] ${key} failed:`, (e as Error)?.message);
    return hit?.data ?? fallback;
  }
}

export function getTrackRecord(): Promise<TrackRecord> {
  return cached(
    'track',
    async () => {
      const [r] = await query<any>(
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
      return (r as TrackRecord) ?? EMPTY_RECORD;
    },
    EMPTY_RECORD
  );
}

export function getRecentCalls(limit = 24): Promise<Call[]> {
  return cached(
    `recent:${limit}`,
    () =>
      query<Call>(
        `select
           token_address as "tokenAddress", symbol, name, dex,
           liquidity_usd::float as "liquidityUsd", holder_count as "holderCount",
           peak_multiple as "peakMultiple", alerted_at as "alertedAt",
           status, reported_fade as "reportedFade"
         from launch_candidates
         where status in ('alerted', 'closed') and alerted_at is not null
         order by alerted_at desc
         limit $1`,
        [limit]
      ),
    []
  );
}

export function getTopCalls(limit = 6): Promise<Call[]> {
  return cached(
    `top:${limit}`,
    () =>
      query<Call>(
        `select
           token_address as "tokenAddress", symbol, name, dex,
           liquidity_usd::float as "liquidityUsd", holder_count as "holderCount",
           peak_multiple as "peakMultiple", alerted_at as "alertedAt",
           status, reported_fade as "reportedFade"
         from launch_candidates
         where status in ('alerted', 'closed') and peak_multiple > 1.05
         order by peak_multiple desc
         limit $1`,
        [limit]
      ),
    []
  );
}
