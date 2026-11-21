# Module: auth

> Phase **P1** · Depends on: `core`, `identity` · New module · Owner: flasharb

## 1. Purpose & responsibilities
Authenticate users by **Sign-In With Solana** (connect Phantom → sign a nonce), issue and rotate
sessions (access JWT + refresh cookie), and provide the route guards (`requireAuth`, `requireVip`,
`requireFreshAuth`) the rest of the API uses.

## 2. Out of scope
User records/linking → `identity`. Entitlement value → `billing` (guard calls it). No passwords/email.

## 3. Folder & files
`modules/auth/`: `auth.types.ts · auth.repo.ts · auth.service.ts · auth.controller.ts · auth.routes.ts · auth.guards.ts · index.ts`

## 4. Data model
```sql
sessions(
  id uuid pk,
  user_id uuid fk -> users,
  refresh_token_hash text not null,   -- sha256 of the refresh token
  user_agent text, ip text,
  created_at, expires_at timestamptz,
  revoked_at timestamptz null)
```
Nonces live in **Redis**: `siws:nonce:<address> = <nonce>` with 5-min TTL (single use).

## 5. Types & DTOs
```ts
const NonceReq  = z.object({ address: z.string().min(32).max(64) });
const VerifyReq = z.object({ address: z.string(), signature: z.string(), message: z.string() });
interface Session { accessToken: string; expiresAt: string }  // refresh set as httpOnly cookie
interface JwtClaims { sub: string /*userId*/; wal: string /*address*/; iat; exp }
```
SIWS message: domain-bound text containing `stackalpha.xyz`, the address, the nonce, issuedAt, and a
statement — ed25519-signed by the wallet.

## 6. Service API
```ts
createNonce(address): Promise<{ nonce; message }>        // store nonce in Redis (TTL)
verify(address, message, signature): Promise<{ user; session; refreshToken }>
  // 1 validate message binds our domain + the stored unused nonce
  // 2 verify ed25519 signature over message bytes (tweetnacl / @noble/ed25519)
  // 3 identity.getOrCreateByWallet(address); consume nonce
  // 4 issue access JWT (~15m) + refresh (rotate, store hash)
refresh(refreshToken): Promise<{ session; refreshToken }>  // rotate; revoke old
logout(refreshToken): Promise<void>
verifyAccess(token): JwtClaims                             // used by guards
```

## 7. HTTP API (base `/api/v1/auth`)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/nonce` | `{ address }` | `{ nonce, message }` |
| POST | `/verify` | `{ address, message, signature }` | `{ accessToken, expiresAt }` + Set-Cookie refresh |
| POST | `/refresh` | — (cookie) | new `{ accessToken }` + rotated cookie |
| POST | `/logout` | — (cookie) | `{ ok }` |

## 8. Guards (`auth.guards.ts`)
- `requireAuth` → verify Bearer JWT → set `req.user = { id, address }`; else `AUTH_REQUIRED`.
- `requireVip` → `requireAuth` + `billing.isVip(userId)`; else `VIP_REQUIRED`.
- `requireFreshAuth(maxAgeSec)` → access token `iat` within window; else force re-auth (for withdraw/export).

## 9. Events
Emits `session.created`. Consumes none.

## 10. Security & validation
- **Nonce**: single-use, 5-min TTL, bound to address; deleted on verify → no replay.
- **Signature**: strict ed25519 verify over exact message bytes; reject domain mismatch.
- **JWT**: short access TTL, HS256/EdDSA with `AUTH_JWT_SECRET`; refresh = opaque random, **hashed** at
  rest, rotated every refresh, revocable; cookie `httpOnly; Secure; SameSite=Lax`.
- **Rate limit** `/nonce` + `/verify` per IP. CORS allowlist (stackalpha.xyz + Vercel previews).

## 11. Observability
Log logins/ref/logout with correlation id; alert on verify failure spikes (credential stuffing).

## 12. Testing
Unit: message binding, signature verify (valid/invalid/replayed nonce), JWT issue/rotate. Integration:
full nonce→verify→refresh→logout; guard rejections.

## 13. Tasks — A→Z
- [ ] a. `sessions` migration; Redis nonce helpers in `core`.
- [ ] b. SIWS message builder + ed25519 verify util.
- [ ] c. `auth.service` (nonce, verify, refresh, logout, verifyAccess).
- [ ] d. JWT + refresh rotation + cookie handling.
- [ ] e. Guards (`requireAuth`/`requireVip`/`requireFreshAuth`).
- [ ] f. Controller + routes; rate limits.
- [ ] g. Tests (unit + integration).

## 14. Acceptance criteria
- Connecting Phantom and signing the nonce returns a working session; `/account/me` succeeds with the token.
- Replaying a nonce or tampering the signature/message is rejected.
- Refresh rotates tokens and revokes the old; logout invalidates the session.
- `requireVip` and `requireFreshAuth` gate the right routes.
