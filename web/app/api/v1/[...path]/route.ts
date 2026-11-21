import { NextRequest } from 'next/server';

// Server-side proxy: the browser calls same-origin /api/v1/* (HTTPS), and we forward to the
// backend over the server network — avoids mixed-content and keeps API_URL off the client.
export const dynamic = 'force-dynamic';

const API = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function handler(req: NextRequest, ctx: { params: { path: string[] } }) {
  const path = ctx.params.path.join('/');
  const url = `${API}/api/v1/${path}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  if (auth) headers['authorization'] = auth;
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  try {
    const res = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: { code: 'UPSTREAM', message: 'Backend unreachable' } }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
