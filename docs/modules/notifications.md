# Module: notifications (Telegram manager + dispatch)

> Phase **exists (refactor)** · Depends on: `core`, `identity` (+ reads trading/wallet/billing/scanner via services) · Refactor of `src/bot/*` · Owner: flasharb

## 1. Purpose & responsibilities
The Telegram surface (grammY bot: commands, keyboards, channel) **and** the outbound notification
dispatcher. Subscribes to domain events and posts calls to the channel / DMs users. Bot command handlers
are thin and call the same module **services** the web API uses.

## 2. Out of scope
Business logic (buying, fees, billing math) — those live in their modules; this module renders + dispatches.

## 3. Folder & files
`modules/notifications/`: `telegram.ts` (bot init/start) · `bot/{commands,keyboards,formatters}.ts` ·
`notifications.service.ts` (dispatch API) · `notifications.events.ts` (event subscriptions) · `index.ts`.
**Reuse/migrate from:** `src/bot/index.ts`, `billing.ts`, `trading.ts`, `launch-formatter.ts`,
`formatters.ts`, `menus.ts`.

## 4. Data model
Owns `chats` (telegram chat prefs/mute) — map to `user_id` via identity. No other tables.

## 5. Types & DTOs
```ts
interface NotifyTargets { userId?: string; telegramId?: string; channel?: boolean }
// formatters return { text: string; keyboard?: InlineKeyboard }
```

## 6. Service API
```ts
registerBot(bot): void                       // commands + handlers (call services)
startBot(): Promise<void>                     // long-poll (non-blocking, ipv4first) as today
// dispatch (called by event subscribers):
postCall(candidate, safety): Promise<number>  // VIP channel + teaser + gated DMs; returns msgId
postFollowUp(candidate, kind): Promise<void>  // pump/fade/rug threaded under the call
dmUser(userId, text): Promise<void>           // resolves telegram identity; markdown + plain fallback
```

## 7. HTTP API
None (Telegram is its own transport). The bot uses webhook or long-poll per config.

## 8. Events (consumed)
`call.alerted`→postCall · `call.pumped|faded|rugged`→postFollowUp · `position.opened|closed`→dmUser ·
`fee.collected`→dmUser (optional) · `vip.changed`→channel invite/kick · `wallet.created`/`user.linked`→dmUser.

## 9. Dependencies
`identity` (telegram id ↔ user, link tokens, `getOrCreateByTelegram`), `billing` (isVip gating of DMs,
Stars payment → `recordStarsPayment`), `trading`/`wallet` (command actions), `scanner` (call data), `core`.

## 10. Security & validation
VIP-gated DMs via `billing.isVip`; link tokens single-use; Stars pre-checkout/`successful_payment` verified;
markdown-safe sends with plain-text fallback. Never post contract details to the public teaser.

## 11. Observability
Delivery success/failure, channel post ids, command usage, send-error alerts.

## 12. Testing
Unit: formatters, gating logic, event→dispatch mapping (mock bot api). Keep the existing burst-alert test.

## 13. Tasks — A→Z
- [ ] a. Move `src/bot/*` into `modules/notifications`; split commands/keyboards/formatters.
- [ ] b. Replace direct DB/bot calls in commands with service calls (identity/trading/wallet/billing).
- [ ] c. Subscribe dispatchers to the event bus (replace scanner's in-code broadcast).
- [ ] d. Stars payment → `billing.recordStarsPayment`; `vip.changed` → channel add/remove.
- [ ] e. `/linkwallet` + consume web link tokens via `identity`.
- [ ] f. Tests.

## 14. Acceptance criteria
- The bot behaves exactly as today (calls, follow-ups, autopilot commands, Stars, channel) but all logic
  runs through shared services.
- Events drive posts/DMs; no business logic remains in the bot layer.
