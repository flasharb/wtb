// Thin server-side client for the backend JSON API. The web app no longer touches the DB
// directly — it only needs API_URL (set per environment; e.g. https://api.stackalpha.xyz).
export function apiBase(): string {
  return (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function apiGet<T>(path: string, fallback: T, revalidateSeconds = 60): Promise<T> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      next: { revalidate: revalidateSeconds },
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    // Fail safe: the marketing page still renders (with placeholders) if the API is down.
    console.error(`[api] GET ${path} failed:`, (e as Error)?.message);
    return fallback;
  }
}
