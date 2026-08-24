import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInitialFixedE2eReport,
  getFixedE2eReportPath,
  readFixedE2eReport,
  writeFixedE2eReport,
} from './e2e-report.ts';

function fail(message: string): never {
  throw new Error(message);
}

function validateTestOnlyEnvironment(): void {
  if (process.env.APP_ENV !== 'local' || process.env.E2E_ENV !== 'local')
    fail('定期E2Eはlocal環境でのみ実行できます。');
  if (process.env.E2E_TEST_EMAIL !== 'owner-a@example.test')
    fail('定期E2Eの認証メールアドレスがtest-onlyではありません。');
  if (process.env.E2E_TEST_PASSWORD !== 'owner-password')
    fail('定期E2Eの認証パスワードがtest-onlyではありません。');
  if (
    process.env.E2E_MODE === 'weekly' &&
    process.env.E2E_SEED !== 't014-weekly-seed-v1'
  )
    fail('週次E2Eのseedが固定値ではありません。');
}

function reportAfterRunner(reportPath: string, runnerStatus: number | null) {
  try {
    const report = readFixedE2eReport(reportPath);
    if (runnerStatus === 0 && report.status === 'success') return true;
    if (runnerStatus !== 0 && report.status === 'success')
      writeFixedE2eReport(reportPath, createInitialFixedE2eReport());
    return false;
  } catch {
    writeFixedE2eReport(reportPath, createInitialFixedE2eReport());
    return false;
  }
}

validateTestOnlyEnvironment();
const reportPath = getFixedE2eReportPath();
writeFixedE2eReport(reportPath, createInitialFixedE2eReport());

const runnerTemp = path.resolve(process.env.RUNNER_TEMP ?? os.tmpdir());
const rawOutputPath = path.join(
  runnerTemp,
  'cocolo-e2e',
  `${process.env.E2E_MODE}-${process.env.E2E_ITERATION}`,
);
mkdirSync(rawOutputPath, { recursive: true });

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runnerScript = path.join(root, 'scripts', 'supabase-local.ts');
const result = spawnSync(
  process.execPath,
  [
    runnerScript,
    'e2e',
    '--',
    '--reporter=./scripts/e2e-fixed-reporter.ts',
    '--retries=0',
    '--trace=off',
    '--workers=1',
    '--output',
    rawOutputPath,
  ],
  {
    env: {
      ...process.env,
      APP_ENV: 'local',
      E2E_ENV: 'local',
    },
    shell: false,
    stdio: 'inherit',
  },
);

const success = reportAfterRunner(
  reportPath,
  result.error ? null : result.status,
);
console.log(`定期E2E固定レポート: ${success ? 'success' : 'failure'}`);
process.exitCode = success ? 0 : 1;
