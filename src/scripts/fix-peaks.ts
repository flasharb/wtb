import { db, pool } from '../db/index.js';
import { launchCandidates } from '../db/schema.js';
import { gt } from 'drizzle-orm';
import { config } from '../config/index.js';

// Reset peaks/milestones that were polluted by the price-glitch bug (anything above the cap
// is a data glitch, not a real move).
const res = await db
  .update(launchCandidates)
  .set({ peakMultiple: 1, reportedMultiple: 1 })
  .where(gt(launchCandidates.peakMultiple, config.FOLLOWUP_MAX_MULT))
  .returning({ id: launchCandidates.id, s: launchCandidates.symbol, peak: launchCandidates.peakMultiple });
console.log(`reset ${res.length} glitched peaks:`, res.map((r) => r.s).join(', '));
await pool.end().catch(() => {});
