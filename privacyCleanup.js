'use strict';

const { timingSafeEqual } = require('node:crypto');

// Fixed table names and predicates: neither can be supplied by an HTTP caller.
// Use the database clock, like the existing reset and notification writers.
const POLICIES = Object.freeze([
  { table: 'app_password_resets', predicate: 'expires_at <= NOW()' },
  { table: 'org_password_resets', predicate: 'expires_at <= NOW()' },
  { table: 'notification_history', predicate: 'sent_at < DATE_SUB(NOW(), INTERVAL 28 DAY)' },
]);
const BATCH_SIZE = 1000;

function authorized(header, secret) {
  if (typeof secret !== 'string' || !secret.trim()) return false;
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function countEligible(executeQuery, policy) {
  const result = await executeQuery(`SELECT COUNT(*) AS eligible_count FROM ${policy.table} WHERE ${policy.predicate}`);
  const count = Number(result.rows?.[0]?.eligible_count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid cleanup count');
  return count;
}

function createPrivacyCleanupHandler({ executeQuery, env = process.env, logger = console }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (typeof env.CRON_SECRET !== 'string' || !env.CRON_SECRET.trim()) {
      return res.status(503).json({ error: 'Cleanup requires CRON_SECRET' });
    }
    if (!authorized(req.headers.authorization, env.CRON_SECRET)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const configuredMode = env.PRIVACY_CLEANUP_MODE || 'dry-run';
    if (!['dry-run', 'delete'].includes(configuredMode)) {
      return res.status(503).json({ error: 'Invalid PRIVACY_CLEANUP_MODE' });
    }
    // A request can force a dry-run, but can never enable deletion.
    const dryRun = configuredMode !== 'delete' || req.query?.dry_run === '1';
    const report = { mode: dryRun ? 'dry-run' : 'delete', tables: {} };
    let currentTable;
    try {
      // Probe every table before the first DELETE. Missing schema/permissions fail closed.
      for (const policy of POLICIES) {
        currentTable = policy.table;
        report.tables[policy.table] = { eligible: await countEligible(executeQuery, policy), deleted: 0 };
      }
      if (!dryRun) {
        for (const policy of POLICIES) {
          currentTable = policy.table;
          const entry = report.tables[policy.table];
          if (entry.eligible > 0) {
            // Re-evaluate expiry at deletion time; never delete by a stale list of user IDs.
            const result = await executeQuery(`DELETE FROM ${policy.table} WHERE ${policy.predicate} LIMIT ${BATCH_SIZE}`);
            if (!Number.isSafeInteger(result.rowCount) || result.rowCount < 0) throw new Error('Invalid delete count');
            entry.deleted = result.rowCount;
          }
          entry.remaining = await countEligible(executeQuery, policy);
        }
      }
      const pending = !dryRun && Object.values(report.tables).some(entry => entry.remaining > 0);
      logger.info('[Privacy cleanup]', report);
      return res.status(pending ? 503 : 200).json({ ...report, pending });
    } catch {
      // Never log SQL errors, rows, tokens, or other account data.
      logger.error('[Privacy cleanup] Database operation failed', { table: currentTable });
      return res.status(503).json({ ...report, error: 'Cleanup incomplete', failed_table: currentTable });
    }
  };
}

module.exports = { createPrivacyCleanupHandler };
