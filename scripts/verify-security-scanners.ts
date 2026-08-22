import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityScanRoot } from './security-scan-root.ts';
import {
  readScannerConfig,
  scannerNames,
  scannerRuleAllowlist,
} from './security-scanner-config.ts';
import { readScannerExceptions } from './security-scanner-exceptions.ts';

const root = securityScanRoot(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const workflowPath = path.join(
  root,
  '.github',
  'workflows',
  'security-scanners.yml',
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
  packageJson.scripts?.['security:trust'],
  'node scripts/verify-security-trust.ts',
);
assert.equal(
  packageJson.scripts?.['security:scan'],
  'node scripts/run-security-scanners.ts',
);
assert.equal(
  packageJson.scripts?.['test:security'],
  'node --test scripts/security-scanner.test.ts',
);
assert.equal(
  packageJson.scripts?.['lint:workflows'],
  'node scripts/verify-workflows.ts',
);
assert.equal(
  packageJson.scripts?.['test:workflows'],
  'node --test scripts/verify-workflows.test.ts',
);

assert.match(workflow, /^name:\s*セキュリティ検査\s*$/m);
assert.match(workflow, /^\s*pull_request_target:\s*$/m);
assert.match(workflow, /^\s*push:\s*$/m);
assert.match(workflow, /^\s*schedule:\s*$/m);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /timeout-minutes:/);
assert.match(workflow, /node-version:\s*24\.12\.0/);
assert.match(workflow, /pnpm security:verify/);
assert.match(workflow, /pnpm security:scan/);
assert.match(workflow, /node scripts\/verify-security-trust\.ts/);
assert.match(workflow, /if:\s*\$\{\{\s*always\(\)/);
assert.match(workflow, /needs\.config\.result/);
assert.match(workflow, /needs\.scanners\.result/);
assert.match(workflow, /contents:\s*read/);
assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m);
assert.doesNotMatch(workflow, /workflow_run|secrets\s*:/);
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
  assert.equal(
    await readFile(path.join(root, tool.ruleFile), 'utf8'),
    scannerRuleAllowlist[name],
    `${name}: ルールファイルが固定allowlistと一致しません`,
  );
}

await readScannerExceptions(root);

console.log(
  'Security scanner設定、秘密情報非注入、出力秘匿、例外期限を検証しました。',
);
