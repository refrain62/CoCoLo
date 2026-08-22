import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function readWorkflow(name: string): Promise<string> {
  return readFile(path.join(root, '.github', 'workflows', name), 'utf8');
}

function assertHistoryAfterDeploy(content: string, name: string): void {
  assert.match(
    content,
    /pnpm deploy:(staging|production)[\s\S]*?name: [^\r\n]*migration履歴[^\r\n]*\r?\n\s+run: pnpm verify:migration-history[\s\S]*?DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/,
    `${name}: deploy直後のDIRECT_URL履歴照合がありません`,
  );
}

function assertSecurityAfterDeploy(content: string, name: string): void {
  assert.match(
    content,
    /pnpm deploy:(staging|production)[\s\S]*?run: pnpm verify:deployed-database-security[\s\S]*?APP_ENV: \1[\s\S]*?DEPLOY_ENV: \1[\s\S]*?DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/,
    `${name}: deploy直後の実DB security照合がありません`,
  );
}

test('staging/production deployは適用直後に実DB securityと履歴を照合する', async () => {
  for (const name of ['staging-deploy.yml', 'production-promote.yml']) {
    const content = await readWorkflow(name);
    assertSecurityAfterDeploy(content, name);
    assertHistoryAfterDeploy(content, name);
  }
});

test('履歴照合をDATABASE_URLへ差し替える悪性fixtureを拒否する', () => {
  assert.throws(() =>
    assertHistoryAfterDeploy(
      'migrate deploy\n- name: migration履歴\n  run: pnpm verify:migration-history\n  env:\n    DATABASE_URL: $' +
        '{{ secrets.DATABASE_URL }}',
      'malicious-fixture',
    ),
  );
});

test('実DB security検査を履歴だけへ差し替える悪性fixtureを拒否する', () => {
  assert.throws(() =>
    assertSecurityAfterDeploy(
      'migrate deploy\n- name: security\n  run: pnpm verify:migration-history\n  env:\n    DIRECT_URL: $' +
        '{{ secrets.DIRECT_URL }}',
      'malicious-fixture',
    ),
  );
});
