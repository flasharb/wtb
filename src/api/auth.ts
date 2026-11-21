import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/index.js';

/**
 * Sign-In With Solana (SIWS) for the web app.
 * Flow: POST /auth/nonce { address } → signed message; wallet signs it; POST /auth/verify
 * { address, signature(base64) } → session JWT. The wallet address IS the account id (MVP:
 * reused as the owner key across the existing trading/wallet tables).
 */

export const authReady = () => !!config.AUTH_JWT_SECRET;
const secret = () => new TextEncoder().encode(config.AUTH_JWT_SECRET);

// In-memory single-use nonces (MVP; a process restart just forces a re-sign).
const nonces = new Map<string, { message: string; exp: number }>();
const NONCE_TTL_MS = 5 * 60_000;
function sweep() {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k);
}

function buildMessage(address: string, nonce: string): string {
  return (
    `${config.SIWS_DOMAIN} wants you to sign in with your Solana account:\n${address}\n\n` +
    `Sign in to Stack Alpha. This request will not trigger a transaction or cost any fees.\n\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`
  );
}

async function issueJwt(address: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(address)
    .setIssuedAt()
    .setExpirationTime(`${config.AUTH_JWT_TTL_DAYS}d`)
    .sign(secret());
}

export async function verifyJwt(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return (payload.sub as string) || null;
  } catch {
    return null;
  }
}

/** Fastify preHandler: sets req.userId from a Bearer JWT, or 401s. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const h = req.headers['authorization'];
  const token = h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
  const sub = token ? await verifyJwt(token) : null;
  if (!sub) {
    await reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Login required' } });
    return;
  }
  (req as any).userId = sub;
}

export const userId = (req: FastifyRequest): string => (req as any).userId as string;

export function registerAuthRoutes(server: FastifyInstance) {
  server.post('/api/v1/auth/nonce', async (req, reply) => {
    if (!authReady()) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Auth not configured' } });
    const address = (req.body as any)?.address;
    try {
      new PublicKey(address);
    } catch {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid wallet address' } });
    }
    sweep();
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const message = buildMessage(address, nonce);
    nonces.set(address, { message, exp: Date.now() + NONCE_TTL_MS });
    return { data: { message } };
  });

  server.post('/api/v1/auth/verify', async (req, reply) => {
    if (!authReady()) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Auth not configured' } });
    const { address, signature } = (req.body as any) || {};
    const entry = address ? nonces.get(address) : undefined;
    if (!entry || entry.exp < Date.now()) {
      return reply.status(400).send({ error: { code: 'NONCE_EXPIRED', message: 'Nonce expired — request a new one' } });
    }
    let ok = false;
    try {
      const msgBytes = new TextEncoder().encode(entry.message);
      const sigBytes = Buffer.from(String(signature), 'base64');
      const pubBytes = new PublicKey(address).toBytes();
      ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
    } catch {
      ok = false;
    }
    if (!ok) return reply.status(401).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } });
    nonces.delete(address);
    const token = await issueJwt(address);
    return { data: { token, address } };
  });
}
