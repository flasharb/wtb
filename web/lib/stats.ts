import { apiGet } from './api';

// Types mirror the backend's /api/public DTOs.
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

export function getTrackRecord(): Promise<TrackRecord> {
  return apiGet<TrackRecord>('/api/public/track-record', EMPTY_RECORD, 60);
}

export function getRecentCalls(limit = 24): Promise<Call[]> {
  return apiGet<Call[]>(`/api/public/calls?limit=${limit}`, [], 45);
}

export function getTopCalls(limit = 6): Promise<Call[]> {
  return apiGet<Call[]>(`/api/public/top?limit=${limit}`, [], 120);
}
