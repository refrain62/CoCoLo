import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function workflow(name: string): Promise<string> {
  return readFile(path.join(root, '.github/workflows', name), 'utf8');
}

function assertDeploySecurity(content: string, environment: string): void {
  assert.match(
    content,
    new RegExp(
      `pnpm deploy:${environment}[\\s\\S]*?run: pnpm verify:deployed-database-security[\\s\\S]*?APP_ENV: ${environment}[\\s\\S]*?DEPLOY_ENV: ${environment}[\\s\\S]*?DIRECT_URL: \\$\\{\\{ secrets\\.DIRECT_URL \\}\\}`,
    ),
  );
}

test('staging/production deployは実DB security入口をDIRECT_URL付きで呼ぶ', async () => {
  assertDeploySecurity(await workflow('staging-deploy.yml'), 'staging');
  assertDeploySecurity(await workflow('production-promote.yml'), 'production');
});

test('履歴だけへ差し替える悪性fixtureを拒否する', () => {
  assert.throws(() =>
    assertDeploySecurity(
      [
        'migrate deploy\nrun: pnpm verify:migration-history\nenv:\n  DIRECT_URL: $',
        '{{ secrets.DIRECT_URL }}',
      ].join(''),
      'staging',
    ),
  );
});
