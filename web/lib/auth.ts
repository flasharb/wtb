import { setToken } from './session';

function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** Sign-In With Solana: request a nonce, sign it with the wallet, verify → store the session JWT. */
export async function siwsLogin(
  address: string,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<void> {
  const nonceRes = await fetch('/api/v1/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const nonceJson = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(nonceJson?.error?.message || 'Could not start sign-in');
  const message: string = nonceJson.data.message;

  const sig = await signMessage(new TextEncoder().encode(message));
  const signature = toBase64(sig);

  const verifyRes = await fetch('/api/v1/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  const verifyJson = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(verifyJson?.error?.message || 'Sign-in failed');
  setToken(verifyJson.data.token);
}
