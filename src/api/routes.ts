import { FastifyInstance, FastifyReply } from 'fastify';
import { getTrackRecord, getRecentCalls, getTopCalls } from './stats.js';

// Public JSON API consumed by the web app (and any future client). Read-only, CORS-open,
// CDN-cacheable. Namespaced under /api/ so it never collides with the ingest/webhook routes.
function setCache(reply: FastifyReply, seconds = 60) {
  reply.header('Cache-Control', `public, max-age=${Math.floor(seconds / 2)}, s-maxage=${seconds}, stale-while-revalidate=300`);
}

export function registerApiRoutes(server: FastifyInstance) {
  // Permissive CORS for the public API only, plus OPTIONS preflight short-circuit.
  server.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  server.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  server.get('/api/public/track-record', async (_req, reply) => {
    setCache(reply, 60);
    return getTrackRecord();
  });

  server.get('/api/public/calls', async (req, reply) => {
    const limit = Number((req.query as any)?.limit) || 30;
    setCache(reply, 45);
    return getRecentCalls(limit);
  });

  server.get('/api/public/top', async (req, reply) => {
    const limit = Number((req.query as any)?.limit) || 6;
    setCache(reply, 120);
    return getTopCalls(limit);
  });

  // One-call bundle for the web landing page (fewer round trips).
  server.get('/api/public/overview', async (_req, reply) => {
    setCache(reply, 60);
    const [record, top] = await Promise.all([getTrackRecord(), getTopCalls(4)]);
    return { record, top };
  });
}
