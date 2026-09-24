/* Development helper: run the nightly billing + digest as if today were <date>.
 *   npx tsx --env-file=.env.development scripts/run-daily-at.ts 2026-09-25 */
import { sql } from '../server/db/client'
import { jobDailyBilling, jobDailyDigest } from '../server/jobs/daily'

const asOf = process.argv[2]
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('Pakai: run-daily-at.ts YYYY-MM-DD')
console.log('billing', await jobDailyBilling(asOf))
console.log('digest', await jobDailyDigest(asOf))
await sql.end()
