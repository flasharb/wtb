import crypto from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Wallet-secret encryption (AES-256-GCM).
 *
 * The 32-byte master key comes from WALLET_ENCRYPTION_KEY (hex or base64). It never leaves
 * the server and is never logged. Each secret is stored as `ivHex:authTagHex:cipherHex`.
 * Rotating the master key orphans every existing wallet, so treat it as permanent.
 */

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = config.WALLET_ENCRYPTION_KEY.trim();
  if (!raw) {
    throw new Error('WALLET_ENCRYPTION_KEY is not set — trading wallets cannot be created.');
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use 64 hex chars or base64 of 32 bytes.`
    );
  }
  cachedKey = key;
  return key;
}

/** True when a valid master key is configured (so trading can be offered). */
export function encryptionReady(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(secret: Uint8Array): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload: string): Uint8Array {
  const [ivHex, tagHex, cipherHex] = payload.split(':');
  if (!ivHex || !tagHex || !cipherHex) throw new Error('Malformed encrypted secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return new Uint8Array(dec);
}
