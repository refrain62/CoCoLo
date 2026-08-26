import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLoadResults,
  buildLoadPlan,
  buildLoadQuery,
  loadTestDefaults,
  summarizeLoadResults,
} from './db-load-test.ts';

test('負荷試験計画は複数テナントとページ取得を混在させる', () => {
  const plan = buildLoadPlan(loadTestDefaults);
  assert.equal(plan.length, 1_000);
  assert.ok(plan.some((request) => request.tenantId.endsWith('000000000003')));
  assert.ok(plan.some((request) => request.resource === 'members'));
  assert.ok(plan.some((request) => request.resource === 'announcements'));
  assert.ok(plan.some((request) => request.offset >= 50));
});

test('負荷試験クエリーはtenantとRLSセッションを同時に設定する', () => {
  const plan = buildLoadPlan({
    ...loadTestDefaults,
    workers: 1,
    iterationsPerWorker: 4,
  });
  for (const request of plan) {
    const query = buildLoadQuery(request);
    assert.match(query, /set_config\('app\.tenant_id'/);
    assert.match(query, /WHERE tenant_id = '[0-9a-f-]+'::uuid/);
    assert.match(query, /LIMIT 50 OFFSET/);
  }
});

test('負荷結果の集計と閾値判定を行う', () => {
  const results = [
    { elapsedMs: 10, rows: 50 },
    { elapsedMs: 20, rows: 10 },
    { elapsedMs: 40, rows: 0 },
  ];
  assert.deepEqual(summarizeLoadResults(results), {
    total: 3,
    succeeded: 3,
    failed: 0,
    rows: 60,
    p50Ms: 20,
    p95Ms: 40,
    maxMs: 40,
  });
  assert.throws(
    () => assertLoadResults([{ elapsedMs: 1_001, rows: 1 }], loadTestDefaults),
    /p95が閾値を超えました/,
  );
});
