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
    /migrate deploy[\s\S]*?name: [^\r\n]*migration履歴[^\r\n]*\r?\n\s+run: pnpm verify:migration-history[\s\S]*?DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/,
    `${name}: deploy直後のDIRECT_URL履歴照合がありません`,
  );
}

test('staging/production deployは適用直後にDIRECT_URL履歴を照合する', async () => {
  assertHistoryAfterDeploy(
    await readWorkflow('staging-deploy.yml'),
    'staging-deploy.yml',
  );
  assertHistoryAfterDeploy(
    await readWorkflow('production-promote.yml'),
    'production-promote.yml',
  );
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
