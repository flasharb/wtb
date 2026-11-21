# Module: identity

> Phase **P0** · Depends on: `core` · New module (canonical identity layer) · Owner: flasharb

## 1. Purpose & responsibilities
The single source of truth for **who a user is**. One canonical `users` row per person; a user may have
a **wallet** identity (Phantom login) and/or a **telegram** identity, linkable into one account. Owns
auto-provisioning on first login, account linking, and the `GET /account/me` summary.

## 2. Out of scope
- Signature verification / sessions → `auth`. Funds/wallets → `wallet`. VIP status value → `billing`
  (this module composes it for `/account/me`).

## 3. Folder & files
`modules/identity/`: `identity.types.ts · identity.repo.ts · identity.service.ts · identity.controller.ts · identity.routes.ts · identity.events.ts · index.ts`

## 4. Data model
```sql
users(
  id uuid pk default gen_random_uuid(),
  handle text unique null,
  created_at, updated_at timestamptz default now())

user_identities(
  id uuid pk,
  user_id uuid fk -> users(id) on delete cascade,
  kind text check (kind in ('wallet','telegram')) not null,
  identifier text not null,          -- wallet pubkey (base58) | telegram user id
  username text null,                -- @handle for telegram
  verified_at timestamptz,
  created_at timestamptz default now(),
  unique(kind, identifier))

link_tokens(                          -- one-time codes for cross-surface linking
  token text pk,                      -- random, short-ttl
  user_id uuid fk -> users(id),
  target_kind text,                   -- identity being added
  expires_at timestamptz,
  consumed_at timestamptz null)
```
**Migration (dual read/write):** backfill one `users` + `user_identities(kind='telegram')` per distinct
`telegram_user_id` already in the DB; add `user_id` to domain tables keyed off that map (see trading/billing docs).

## 5. Types & DTOs
```ts
type IdentityKind = 'wallet' | 'telegram';
interface User { id: string; handle: string | null; createdAt: string }
interface Identity { kind: IdentityKind; identifier: string; username?: string; verifiedAt: string }
interface AccountMe { user: User; identities: Identity[]; vipUntil: string | null; isVip: boolean }
const LinkTelegramReq = z.object({}); // uses session user
```

## 6. Service API
```ts
findById(userId): Promise<User | null>
findByIdentity(kind, identifier): Promise<User | null>
getOrCreateByWallet(address): Promise<User>          // first SIWS auto-provisions
getOrCreateByTelegram(tgId, username?): Promise<User> // bot auto-provisions
getIdentities(userId): Promise<Identity[]>
linkIdentity(userId, kind, identifier, username?): Promise<void>  // throws CONFLICT if taken by another user
createLinkToken(userId, targetKind): Promise<{ token; url }>      // url = t.me deep link / web link
consumeLinkToken(token, kind, identifier, username?): Promise<User>
```

## 7. HTTP API (base `/api/v1/account`)
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/me` | requireAuth | — | `AccountMe` (composes `billing.getVip`) |
| POST | `/link/telegram` | requireAuth | — | `{ token, url }` deep link to the bot |
| GET | `/identities` | requireAuth | — | `Identity[]` |

## 8. Events
Emits `user.created`, `user.linked`. Consumes none.

## 9. Dependencies
`core` (db, errors, ids); `billing.service.getVip` (read, for `/me`). The bot calls
`identity.service.getOrCreateByTelegram` + `consumeLinkToken`.

## 10. Security & validation
- `unique(kind, identifier)` prevents one identity mapping to two users.
- Linking refuses if the target identity already belongs to a different user (`CONFLICT`) → offer merge flow (post-MVP).
- Link tokens: random 128-bit, single-use, 10-min TTL.

## 11. Observability
Log provisioning + links; write `audit_log` on link/merge.

## 12. Testing
Unit: get-or-create idempotency, link conflict. Integration: `/me`, link token issue→consume. Migration dry-run on a copy.

## 13. Tasks — A→Z
- [ ] a. Migration: `users`, `user_identities`, `link_tokens`.
- [ ] b. Backfill script from distinct `telegram_user_id` (idempotent).
- [ ] c. `identity.repo` (CRUD + lookups by identity).
- [ ] d. `identity.service` (get-or-create, link, tokens).
- [ ] e. Controller + routes (`/me`, `/link/telegram`, `/identities`).
- [ ] f. Emit events; wire `audit_log`.
- [ ] g. Expose `getOrCreateByTelegram`/`consumeLinkToken` for the bot.
- [ ] h. Unit + integration tests.

## 14. Acceptance criteria
- Every pre-existing Telegram user has a canonical `users` row + telegram identity.
- First wallet login auto-creates a user + wallet identity.
- `/account/me` returns identities + VIP status.
- Linking a Telegram id to a web account merges them under one `user_id`; the live bot keeps working.
