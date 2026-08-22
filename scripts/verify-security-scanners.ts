import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readScannerConfig,
  type ScannerName,
  scannerNames,
} from './security-scanner-config.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowPath = path.join(
  root,
  '.github',
  'workflows',
  'security-scanners.yml',
);
const exceptionsPath = path.join(
  root,
  '.github',
  'security',
  'scanner-exceptions.json',
);

const workflow = await readFile(workflowPath, 'utf8');
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
) as {
  engines?: { node?: string };
  scripts?: Record<string, string>;
};
const config = await readScannerConfig(root);

assert.equal(packageJson.engines?.node, '>=24.12.0 <25');
assert.equal(
  packageJson.scripts?.['security:verify'],
  'node scripts/verify-security-scanners.ts',
);
assert.equal(
  packageJson.scripts?.['security:scan'],
  'node scripts/run-security-scanners.ts',
);

assert.match(workflow, /^name:\s*セキュリティ検査\s*$/m);
assert.match(workflow, /^\s*pull_request:\s*$/m);
assert.match(workflow, /^\s*push:\s*$/m);
assert.match(workflow, /^\s*schedule:\s*$/m);
assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /timeout-minutes:/);
assert.match(workflow, /node-version:\s*24\.12\.0/);
assert.match(workflow, /pnpm security:verify/);
assert.match(workflow, /pnpm security:scan/);
assert.match(workflow, /if:\s*\$\{\{\s*always\(\)/);
assert.match(workflow, /needs\.config\.result/);
assert.match(workflow, /needs\.scanners\.result/);
assert.match(workflow, /contents:\s*read/);
assert.doesNotMatch(workflow, /pull_request_target|workflow_run|secrets\s*:/);
assert.doesNotMatch(workflow, /environment\s*:/);
assert.doesNotMatch(workflow, /upload-artifact|deploy/i);
assert.doesNotMatch(workflow, /^\s*run:.*\$\{\{/m);

for (const match of workflow.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g))
  assert.match(
    match[2] ?? '',
    /^[0-9a-f]{40}$/,
    `Action参照がSHA固定ではありません: ${match[1]}`,
  );

for (const name of scannerNames) {
  const tool = config.tools[name];
  assert.ok(
    tool.command.includes('__OUTPUT__'),
    `${name}: JSON出力先を固定してください`,
  );
  assert.ok(
    tool.command.includes('--report-format') ||
      tool.command.includes('--format') ||
      tool.command.includes('--json'),
    `${name}: 機械可読な結果形式を固定してください`,
  );
  assert.ok(
    tool.command.includes('--report-path') || tool.command.includes('--output'),
    `${name}: 結果ファイルを固定してください`,
  );
  await readFile(path.join(root, tool.ruleFile), 'utf8');
}

type ScannerException = {
  id: string;
  tool: ScannerName;
  ruleId: string;
  severity: string;
  owner: string;
  rationale: string;
  mitigation: string;
  issue: string;
  expires: string;
};

type ExceptionFile = {
  schemaVersion: number;
  policy: { criticalMaxDays: number; highMaxDays: number };
  exceptions: ScannerException[];
};

const exceptionFile = JSON.parse(
  await readFile(exceptionsPath, 'utf8'),
) as ExceptionFile;
assert.equal(exceptionFile.schemaVersion, 1);
assert.equal(exceptionFile.policy.criticalMaxDays, 7);
assert.equal(exceptionFile.policy.highMaxDays, 14);
assert.ok(Array.isArray(exceptionFile.exceptions));

const today = new Date().toISOString().slice(0, 10);
const todayStart = new Date(`${today}T00:00:00.000Z`);
const ids = new Set<string>();
for (const exception of exceptionFile.exceptions) {
  assert.ok(!ids.has(exception.id), `例外IDが重複しています: ${exception.id}`);
  ids.add(exception.id);
  assert.match(exception.id, /^SEC-[A-Z0-9-]+$/);
  assert.ok(scannerNames.includes(exception.tool));
  assert.match(exception.ruleId, /^[A-Za-z0-9._-]+$/);
  assert.match(exception.severity, /^(CRITICAL|HIGH|MEDIUM|LOW)$/);
  for (const [field, value] of Object.entries(exception))
    if (field !== 'expires')
      assert.ok(typeof value === 'string' && value.trim());
  assert.match(
    exception.issue,
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/,
  );
  assert.match(exception.expires, /^\d{4}-\d{2}-\d{2}$/);
  const expires = new Date(`${exception.expires}T23:59:59.999Z`);
  assert.ok(
    !Number.isNaN(expires.valueOf()),
    `${exception.id}: 失効日が不正です`,
  );
  assert.ok(exception.expires >= today, `${exception.id}: 期限切れの例外です`);

  const maxDays =
    exception.severity === 'CRITICAL'
      ? exceptionFile.policy.criticalMaxDays
      : exception.severity === 'HIGH'
        ? exceptionFile.policy.highMaxDays
        : undefined;
  if (maxDays !== undefined) {
    const latest = new Date(todayStart);
    latest.setUTCDate(latest.getUTCDate() + maxDays);
    assert.ok(
      expires <= new Date(`${latest.toISOString().slice(0, 10)}T23:59:59.999Z`),
      `${exception.id}: ${exception.severity}例外の期限が長すぎます`,
    );
  }
}

console.log(
  'Security scanner設定、秘密情報非注入、出力秘匿、例外期限を検証しました。',
);
