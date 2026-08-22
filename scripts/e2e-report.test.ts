import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  type FixedE2eReport,
  readFixedE2eReport,
  safeE2eTestName,
  validateFixedE2eReport,
  writeFixedE2eReport,
} from './e2e-report.ts';

const validReport: FixedE2eReport = {
  version: 1,
  mode: 'daily',
  targetSha: '0123456789abcdef0123456789abcdef01234567',
  runUrl: 'https://github.com/refrain62/CoCoLo/actions/runs/123',
  iteration: 1,
  totalIterations: 1,
  status: 'success',
  tests: [{ testName: 'health-endpoint', status: 'success' }],
};

test('固定E2Eレポートは許可した項目だけを保存する', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cocolo-e2e-report-'));
  const reportPath = path.join(directory, 'fixed-report.json');
  writeFixedE2eReport(reportPath, validReport);
  assert.deepEqual(readFixedE2eReport(reportPath), validReport);
  assert.doesNotMatch(readFileSync(reportPath, 'utf8'), /@|token|password/i);
});

test('不明なテスト名は固定IDへ縮退する', () => {
  assert.equal(
    safeE2eTestName('e2e/unknown.spec.ts', '実在個人名 alice@example.test'),
    'unmapped-test',
  );
});

test('失敗レポートに成功結果だけを設定できない', () => {
  assert.throws(() =>
    validateFixedE2eReport({
      ...validReport,
      status: 'failure',
    }),
  );
});
