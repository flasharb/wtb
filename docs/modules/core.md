# Module: core (shared foundation)

> Phase **P0** · Depends on: — · Partially exists (`src/config`, `src/db`) · Owner: flasharb

## 1. Purpose & responsibilities
The only shared layer every module imports: config, db, redis, logging, errors, HTTP helpers, the event
bus, crypto primitives, ids, and the route guards' building blocks. No business logic.

## 2. Out of scope
Feature logic of any kind. Keyvault specifics live in `wallet` (core exposes generic AES/envelope helpers).

## 3. Folder & files
`modules/core/`: `config.ts · db.ts · redis.ts · logger.ts · errors.ts · http.ts · events.ts · crypto.ts · ids.ts · index.ts`

## 4. Data model
None of its own. Owns the Drizzle client + pg pool and migration runner wiring.

## 5. Types & DTOs
```ts
class AppError extends Error { constructor(code: ErrorCode, message: string, http = 400, meta?) }
type ErrorCode = 'AUTH_REQUIRED'|'VIP_REQUIRED'|'VALIDATION'|'NOT_FOUND'|'CONFLICT'
  |'INSUFFICIENT_BALANCE'|'WALLET_LOCKED'|'RATE_LIMITED'|'UPSTREAM'|'INTERNAL';
type Ok<T>   = { data: T };
type Page<T> = { data: T[]; page: { cursor: string | null; hasMore: boolean } };
type Err     = { error: { code: ErrorCode; message: string; details?: unknown } };
interface AppEvents { 'call.alerted': CallAlerted; 'position.closed': PositionClosed; /* …§4 blueprint */ }
```

## 6. Service API (utilities)
```ts
config: Config                                   // Zod-validated env (extends current config)
db, pool                                         // Drizzle + pg
redis                                            // ioredis
logger.child({ reqId })                          // structured logs
events.emit(name, payload) / events.on(name, fn) // typed in-process bus
ok(data) / page(rows, cursor) / fail(code,msg)   // response envelope
asyncHandler(fn)                                 // catch → AppError → envelope
rateLimit({ key, limit, windowSec })             // redis token bucket
encryptGcm(buf,key)/decryptGcm(payload,key)      // AES-256-GCM
newId()/newToken()/idempotencyKey(req)
```

## 7. HTTP API
None (except mounting a global **error handler** + **not-found** + `/health` + request-id hook in `app.ts`).

## 8. Events
Defines the typed `AppEvents` map + the bus; emits none itself.

## 9. Dependencies
External: pg, drizzle-orm, ioredis, pino, zod, node:crypto.

## 10. Security & validation
Central CORS allowlist, security headers, body-size limits, global rate-limit middleware, secret loading
from env/KMS. No secret ever logged (logger redaction list).

## 11. Observability
pino JSON logs + correlation id per request; `/metrics` hook (Prometheus-style counters) registered here.

## 12. Testing
Unit: error→envelope mapping, rate-limit bucket, event bus typing, crypto round-trip.

## 13. Tasks — A→Z
- [ ] a. Move/extend `config` + `db` into `modules/core`; keep back-compat exports during refactor.
- [ ] b. Add `redis`, `logger`, `errors`, `http`, `events`, `crypto`, `ids`.
- [ ] c. Global error handler + not-found + request-id + security headers in `app.ts`.
- [ ] d. Rate-limit + CORS allowlist helpers.
- [ ] e. Metrics hook.
- [ ] f. Unit tests.

## 14. Acceptance criteria
- All modules import infra only from `core`; no duplicated db/config.
- Errors render as the standard envelope with stable codes; logs carry a correlation id; secrets never appear in logs.
