import { db, pool } from '../db/index.js';
import { wallets, walletLabels } from '../db/schema.js';
import { sql } from 'drizzle-orm';

async function check() {
  const [totalWallets] = await db.select({ count: sql`count(*)` }).from(wallets);
  const [totalLabels] = await db.select({ count: sql`count(*)` }).from(walletLabels);
  const solCount = await db.select({ count: sql`count(*)` }).from(wallets).where(sql`chain = 'solana'`);
  const ethCount = await db.select({ count: sql`count(*)` }).from(wallets).where(sql`chain = 'ethereum'`);

  console.log('--- DATABASE VERIFICATION ---');
  console.log('Total Wallets in DB:', totalWallets.count);
  console.log('  - Solana Wallets:', solCount[0].count);
  console.log('  - Ethereum Wallets:', ethCount[0].count);
  console.log('Total Labels in DB:', totalLabels.count);

  await pool.end();
}

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
