import { Connection } from '@solana/web3.js';
import { config } from '../config/index.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function rpcUrl(): string {
  if (config.SOLANA_RPC_URL) return config.SOLANA_RPC_URL;
  if (config.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`;
  return 'https://api.mainnet-beta.solana.com';
}

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection(rpcUrl(), { commitment: 'confirmed' });
  return conn;
}

export const solToLamports = (sol: number) => Math.round(sol * LAMPORTS_PER_SOL);
export const lamportsToSol = (lamports: number | bigint) => Number(lamports) / LAMPORTS_PER_SOL;
