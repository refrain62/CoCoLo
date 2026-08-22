import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const FIXED_REPORT_VERSION = 1 as const;

export type E2eMode = 'daily' | 'weekly' | 'manual';
export type E2eStatus = 'success' | 'failure';

export interface FixedE2eTestResult {
  testName: string;
  status: E2eStatus;
}

export interface FixedE2eReport {
  version: typeof FIXED_REPORT_VERSION;
  mode: E2eMode;
  targetSha: string;
  runUrl: string;
  iteration: number;
  totalIterations: number;
  status: E2eStatus;
  tests: FixedE2eTestResult[];
}

const SAFE_TEST_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const REPORT_PATH = /^e2e-report\/[a-z0-9][a-z0-9._-]*\.json$/;
const RUN_URL =
  /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/;

const reportKeys = [
  'iteration',
  'mode',
  'runUrl',
  'status',
  'targetSha',
  'tests',
  'totalIterations',
  'version',
];
const testKeys = ['status', 'testName'];

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    fail(`固定E2Eレポートの${field}が不正です。`);
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    fail(`固定E2Eレポートの${field}が不正です。`);
  return value;
}

function requireKeys(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    fail('固定E2Eレポートに許可されていない項目があります。');
}

function modeFromEnvironment(): E2eMode {
  const mode = requireString(process.env.E2E_MODE, 'mode');
  if (mode !== 'daily' && mode !== 'weekly' && mode !== 'manual')
    fail('固定E2Eレポートのmodeが不正です。');
  return mode;
}

function runUrlFromEnvironment(): string {
  const runUrl = requireString(process.env.E2E_RUN_URL, 'runUrl');
  if (!RUN_URL.test(runUrl)) fail('固定E2EレポートのrunUrlが不正です。');
  return runUrl;
}

function reportPathFromEnvironment(): string {
  const reportPath = requireString(process.env.E2E_REPORT_PATH, 'path');
  if (!REPORT_PATH.test(reportPath.replaceAll('\\', '/')))
    fail('固定E2Eレポートの保存先が不正です。');
  return reportPath;
}

function positiveIntegerFromEnvironment(name: string): number {
  const value = requireString(process.env[name], name);
  if (!/^[1-9][0-9]*$/.test(value))
    fail(`固定E2Eレポートの${name}が不正です。`);
  return Number(value);
}

export function createInitialFixedE2eReport(): FixedE2eReport {
  const mode = modeFromEnvironment();
  const targetSha = requireString(process.env.E2E_TARGET_SHA, 'targetSha');
  if (!SHA.test(targetSha)) fail('固定E2EレポートのtargetShaが不正です。');

  const iteration = positiveIntegerFromEnvironment('E2E_ITERATION');
  const totalIterations = positiveIntegerFromEnvironment(
    'E2E_TOTAL_ITERATIONS',
  );
  const expectedIterations = mode === 'weekly' ? 3 : 1;
  if (totalIterations !== expectedIterations || iteration > totalIterations)
    fail('固定E2Eレポートの反復回数が不正です。');

  return {
    version: FIXED_REPORT_VERSION,
    mode,
    targetSha,
    runUrl: runUrlFromEnvironment(),
    iteration,
    totalIterations,
    status: 'failure',
    tests: [],
  };
}

export function validateFixedE2eReport(
  value: unknown,
): asserts value is FixedE2eReport {
  if (!isRecord(value)) fail('固定E2Eレポートの形式が不正です。');
  requireKeys(value, reportKeys);

  if (value.version !== FIXED_REPORT_VERSION)
    fail('固定E2Eレポートのversionが不正です。');
  const mode = requireString(value.mode, 'mode');
  if (mode !== 'daily' && mode !== 'weekly' && mode !== 'manual')
    fail('固定E2Eレポートのmodeが不正です。');

  const targetSha = requireString(value.targetSha, 'targetSha');
  if (!SHA.test(targetSha)) fail('固定E2EレポートのtargetShaが不正です。');

  const runUrl = requireString(value.runUrl, 'runUrl');
  if (!RUN_URL.test(runUrl)) fail('固定E2EレポートのrunUrlが不正です。');

  const iteration = requireInteger(value.iteration, 'iteration');
  const totalIterations = requireInteger(
    value.totalIterations,
    'totalIterations',
  );
  const expectedIterations = mode === 'weekly' ? 3 : 1;
  if (totalIterations !== expectedIterations || iteration > totalIterations)
    fail('固定E2Eレポートの反復回数が不正です。');

  const status = requireString(value.status, 'status');
  if (status !== 'success' && status !== 'failure')
    fail('固定E2Eレポートのstatusが不正です。');

  if (!Array.isArray(value.tests) || value.tests.length > 1000)
    fail('固定E2Eレポートのtestsが不正です。');
  const tests = value.tests as unknown[];
  for (const test of tests) {
    if (!isRecord(test)) fail('固定E2Eレポートのテスト結果が不正です。');
    requireKeys(test, testKeys);
    const testName = requireString(test.testName, 'testName');
    if (!SAFE_TEST_NAME.test(testName))
      fail('固定E2EレポートのtestNameが不正です。');
    const testStatus = requireString(test.status, 'test status');
    if (testStatus !== 'success' && testStatus !== 'failure')
      fail('固定E2Eレポートのテスト判定が不正です。');
  }

  if (
    status === 'success' &&
    (tests.length === 0 ||
      tests.some((test) => (test as FixedE2eTestResult).status !== 'success'))
  )
    fail('テスト成功の固定E2Eレポートに失敗結果があります。');
  if (
    status === 'failure' &&
    tests.length > 0 &&
    tests.every((test) => (test as FixedE2eTestResult).status === 'success')
  )
    fail('テスト失敗の固定E2Eレポートに失敗対象がありません。');
}

export function writeFixedE2eReport(
  reportPath: string,
  report: FixedE2eReport,
): void {
  validateFixedE2eReport(report);
  const absolutePath = path.resolve(reportPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function readFixedE2eReport(reportPath: string): FixedE2eReport {
  let value: unknown;
  try {
    value = JSON.parse(
      readFileSync(path.resolve(reportPath), 'utf8'),
    ) as unknown;
  } catch {
    fail('固定E2Eレポートを読み込めません。');
  }
  validateFixedE2eReport(value);
  return value;
}

export function getFixedE2eReportPath(): string {
  return reportPathFromEnvironment();
}

const safeTestNames = new Map([
  ['health.spec.ts|API health endpoint is reachable', 'health-endpoint'],
  [
    'member-ui.spec.ts|部員一覧は検索条件を送り、公開項目だけを表示する',
    'member-list-privacy',
  ],
  [
    'member-ui.spec.ts|部員登録は学生の必須項目を検証し、テナント情報を送らない',
    'member-registration-validation',
  ],
  [
    'member-ui.spec.ts|登録権限がないAPI応答を権限エラーとして表示する',
    'member-registration-authorization',
  ],
  [
    'auth-member-registration.spec.ts|管理者はログイン後に部員を登録でき、APIへBearer tokenを送る',
    'auth-member-registration',
  ],
  [
    'user-manual.spec.ts|操作マニュアルは未ログインでもサイトから確認できる',
    'manual-public-access',
  ],
  [
    'user-manual.spec.ts|ログイン画面から操作マニュアルへ移動できる',
    'manual-login-navigation',
  ],
]);

export function safeE2eTestName(fileName: string, title: string): string {
  const normalizedFileName = fileName.replaceAll('\\', '/').split('/').at(-1);
  if (!normalizedFileName) return 'unmapped-test';
  return safeTestNames.get(`${normalizedFileName}|${title}`) ?? 'unmapped-test';
}
