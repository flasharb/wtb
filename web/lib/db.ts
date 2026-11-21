import { Pool } from 'pg';

// Read-only pooled connection to the SAME Neon database the Telegram bot/scanner use.
// A small pool (the web app only reads public aggregates). Singleton across hot reloads.
const needsSsl = () => {
  const url = process.env.DATABASE_URL || '';
  return url.includes('neon.tech') || url.includes('sslmode=require') || process.env.NODE_ENV === 'production';
};

const g = globalThis as unknown as { __saPool?: Pool };

export const pool: Pool =
  g.__saPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: needsSsl() ? { rejectUnauthorized: false } : undefined,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });

if (process.env.NODE_ENV !== 'production') g.__saPool = pool;

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
