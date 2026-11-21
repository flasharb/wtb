import { getToken, clearToken } from './session';

// Authed client for the backend (via the same-origin /api/v1 proxy).
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    throw new Error('Session expired — reconnect your wallet.');
  }
  if (!res.ok) throw new Error(json?.error?.message || `Request failed (${res.status})`);
  return json.data as T;
}
