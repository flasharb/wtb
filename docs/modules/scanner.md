# Module: scanner

> Phase **exists (refactor)** · Depends on: `core`, `market`, `notifications` · Refactor of `src/jobs/scan-launches.ts` + `src/api/*` · Owner: flasharb

## 1. Purpose & responsibilities
Discover new Solana launches, vet them, **emit calls** on the survivors, track follow-ups (pump/fade/rug),
and serve the **public track-record API**. The scanner is the signal source the whole product sits on.

## 2. Out of scope
Auto-buying a call → `trading` (reacts to `call.alerted`). Posting to Telegram → `notifications`.

## 3. Folder & files
`modules/scanner/`: `scanner.types.ts · scanner.repo.ts · scanner.service.ts · scanner.stats.ts · scanner.controller.ts · scanner.routes.ts · scanner.events.ts · index.ts`

## 4. Data model
Owns `launch_candidates` (unchanged; identity-agnostic): discovery fields, status
(`watching|alerted|rejected|closed`), `price_at_alert`, `peak_multiple`, `reported_multiple`,
`reported_fade`, `channel_message_id`, safety json.

## 5. Types & DTOs
```ts
interface Candidate { /* row */ }
interface CallDto { tokenAddress; symbol; name; dex; liquidityUsd; holderCount; peakMultiple; alertedAt; status; reportedFade }
interface TrackRecordDto { total; x2; x3; x5; x10; avgPeak; best; rugged; faded }
```

## 6. Service API
```ts
runCycle(): Promise<{ discovered; refreshed; checked; alerted; rejected; followed }>  // the scan loop
getTrackRecord(): Promise<TrackRecordDto>      // cached
getRecentCalls(limit): Promise<CallDto[]>
getTopCalls(limit): Promise<CallDto[]>
```
On a pass → set `status='alerted'`, persist `price_at_alert`, **emit `call.alerted`** (trading + notifications react).

## 7. HTTP API (base `/api/v1/public`, no auth, CDN-cacheable)
| Method | Path | Returns |
|---|---|---|
| GET | `/track-record` | `TrackRecordDto` |
| GET | `/calls?limit=` | `CallDto[]` |
| GET | `/top?limit=` | `CallDto[]` |
| GET | `/overview` | `{ record, top }` |

(These already exist in `src/api`; move under this module.)

## 8. Events
Emits `call.alerted`, `call.pumped`, `call.faded`, `call.rugged`. Consumes none.

## 9. Dependencies
`core`, `market` (discover/safety/overview/marketdata), `notifications` (via event). Runs on the interval scheduler in `app.ts`.

## 10. Security & validation
Public endpoints: open CORS, cache headers, input clamping (limit bounds). DEX denylist + safety gates unchanged.

## 11. Observability
Per-cycle funnel metrics (discovered→alerted); follow-up counts; glitch-cap hits.

## 12. Testing
Unit: funnel filters, milestone/fade/rug detection, track-record SQL. Integration: public endpoints.

## 13. Tasks — A→Z
- [ ] a. Move scan loop + follow-ups into `scanner.service`; split providers to `market`.
- [ ] b. Move `src/api/{stats,routes}` into `scanner.{stats,controller,routes}` under `/api/v1/public`.
- [ ] c. Replace the in-code broadcast with **emit `call.alerted`** (+ pumped/faded/rugged); `notifications` subscribes.
- [ ] d. Keep glitch cap / conservative pricing / rug filter as-is.
- [ ] e. Tests + metrics.

## 14. Acceptance criteria
- Scanner still posts calls + follow-ups (via notifications) with identical behavior.
- `trading` auto-buys off `call.alerted` (not a direct call from the scanner).
- Public API returns the same data under `/api/v1/public/*`.
