/**
 * Testing helper: grant VIP + enable autopilot for every known bot user.
 *
 * "Known users" = individual Telegram users the bot has a record of (positive numeric ids from
 * chats ∪ subscriptions ∪ trading_wallets ∪ trading_configs). Channel-only members who never
 * started the bot can't be reached and aren't included.
 *
 * Autopilot being enabled is a no-op until a user funds their trading wallet (the engine skips
 * zero-balance wallets). To undo: `GRANT_DAYS` subs expire, or run with REVOKE=1.
 *
 *   pnpm exec tsx src/scripts/grant-test-access.ts           # grant (365 days VIP)
 *   GRANT_DAYS=30 pnpm exec tsx src/scripts/grant-test-access.ts
 *   REVOKE=1 pnpm exec tsx src/scripts/grant-test-access.ts   # turn autopilot off + expire VIP
 */
import { pool } from '../db/index.js';

const DAYS = Number(process.env.GRANT_DAYS || 365);
const REVOKE = process.env.REVOKE === '1';

const TARGETS = `
  with targets as (
    select distinct uid from (
      select telegram_chat_id as uid from chats
      union select telegram_user_id from subscriptions
      union select telegram_user_id from trading_wallets
      union select telegram_user_id from trading_configs
    ) u
    where uid ~ '^[0-9]+$'
  )`;

async function main() {
  const { rows } = await pool.query(`${TARGETS} select uid from targets order by uid`);
  const uids = rows.map((r) => r.uid as string);
  console.log(`target users (${uids.length}): ${uids.join(', ') || '(none)'}`);
  if (uids.length === 0) return;

  if (REVOKE) {
    const s = await pool.query(`${TARGETS} update subscriptions set status='expired', expires_at=now()
      where telegram_user_id in (select uid from targets) returning telegram_user_id`);
    const c = await pool.query(`${TARGETS} update trading_configs set enabled=false, updated_at=now()
      where telegram_user_id in (select uid from targets) returning telegram_user_id`);
    console.log(`REVOKE: VIP expired ${s.rowCount}, autopilot disabled ${c.rowCount}`);
    return;
  }

  const vip = await pool.query(
    `${TARGETS}
     insert into subscriptions (telegram_user_id, status, plan, started_at, expires_at)
     select uid, 'active', 'testing', now(), now() + ($1 || ' days')::interval from targets
     on conflict (telegram_user_id) do update
       set status='active', plan='testing',
           expires_at = greatest(subscriptions.expires_at, excluded.expires_at)
     returning telegram_user_id`,
    [String(DAYS)]
  );
  console.log(`VIP granted/extended (${DAYS}d): ${vip.rowCount}`);

  const cfg = await pool.query(
    `${TARGETS}
     insert into trading_configs (telegram_user_id, enabled)
     select uid, true from targets
     on conflict (telegram_user_id) do update set enabled=true, updated_at=now()
     returning telegram_user_id`
  );
  console.log(`autopilot enabled: ${cfg.rowCount}`);
  console.log('Note: autopilot only trades wallets that have been funded (create one with /wallet in the bot).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
