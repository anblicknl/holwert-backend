'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrivacyCleanupHandler } = require('./privacyCleanup');

async function run({ env = { CRON_SECRET: 'test-only' }, header = 'Bearer test-only', query = {}, execute } = {}) {
  const sql = [];
  const logs = [];
  const executeQuery = async statement => {
    sql.push(statement);
    return execute ? execute(statement, sql) : { rows: [{ eligible_count: '2' }], rowCount: 0 };
  };
  const res = {
    code: 200, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await createPrivacyCleanupHandler({ executeQuery, env, logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) } })({ headers: { authorization: header }, query }, res);
  return { res, sql, logs };
}

test('missing, empty, or incorrect secret prevents all database access', async () => {
  for (const options of [{ env: {} }, { env: { CRON_SECRET: ' ' } }, { header: undefined, env: {} }, { header: 'Bearer wrong' }, { header: ['Bearer test-only'] }]) {
    const { res, sql } = await run(options);
    assert.ok([401, 503].includes(res.code));
    assert.deepEqual(sql, []);
  }
});

test('default mode only counts; request cannot switch it to deletion', async () => {
  const { res, sql } = await run({ query: { mode: 'delete', dry_run: '0', table: 'users' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.mode, 'dry-run');
  assert.equal(sql.length, 3);
  assert.ok(sql.every(s => s.startsWith('SELECT COUNT(*)')));
  assert.deepEqual(Object.keys(res.body.tables), ['app_password_resets', 'org_password_resets', 'notification_history']);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('explicit dry-run overrides configured deletion', async () => {
  const { res, sql } = await run({ env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'delete' }, query: { dry_run: '1' } });
  assert.equal(res.body.mode, 'dry-run');
  assert.ok(sql.every(s => s.startsWith('SELECT')));
});

test('misspelled mode fails closed', async () => {
  const { res, sql } = await run({ env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'DELETE' } });
  assert.equal(res.code, 503);
  assert.equal(sql.length, 0);
});

test('schema failure in preflight does not partly delete or expose database errors', async () => {
  const { res, sql, logs } = await run({
    env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'delete' },
    execute: statement => {
      if (statement.includes('notification_history')) throw new Error('secret database contents');
      return { rows: [{ eligible_count: 2 }] };
    },
  });
  assert.equal(res.code, 503);
  assert.equal(res.body.failed_table, 'notification_history');
  assert.ok(sql.every(s => s.startsWith('SELECT')));
  assert.ok(!JSON.stringify([res.body, logs]).includes('secret database contents'));
});

test('approved mode deletes in bounded batches and repeated empty runs are safe', async () => {
  const counts = new Map([['app_password_resets', 2], ['org_password_resets', 1], ['notification_history', 3]]);
  const options = {
    env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'delete' },
    execute: statement => {
      const table = statement.match(/FROM (\w+)/)[1];
      assert.ok(counts.has(table), 'only approved tables');
      assert.ok(statement.includes(table === 'notification_history' ? 'sent_at < DATE_SUB(NOW(), INTERVAL 28 DAY)' : 'expires_at <= NOW()'));
      const count = counts.get(table);
      if (statement.startsWith('DELETE')) {
        assert.match(statement, /LIMIT 1000$/);
        counts.set(table, 0);
        return { rowCount: count };
      }
      return { rows: [{ eligible_count: count }] };
    },
  };
  const first = await run(options);
  assert.equal(first.res.code, 200);
  assert.equal(first.res.body.tables.notification_history.deleted, 3);
  assert.equal(first.res.body.pending, false);
  const second = await run(options);
  assert.equal(second.res.code, 200);
  assert.ok(second.sql.every(s => s.startsWith('SELECT')));
});

test('remaining backlog is reported as incomplete for operational follow-up', async () => {
  const { res } = await run({ env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'delete' }, execute: statement => statement.startsWith('DELETE') ? { rowCount: 1000 } : { rows: [{ eligible_count: 1200 }] } });
  assert.equal(res.code, 503);
  assert.equal(res.body.pending, true);
});

test('delete failure is not reported as successful completion', async () => {
  const { res } = await run({ env: { CRON_SECRET: 'test-only', PRIVACY_CLEANUP_MODE: 'delete' }, execute: statement => {
    if (statement.startsWith('DELETE')) throw new Error('failure');
    return { rows: [{ eligible_count: 1 }] };
  } });
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'Cleanup incomplete');
});
