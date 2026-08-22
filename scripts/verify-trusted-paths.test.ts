import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isProtectedPath } from './verify-trusted-pr.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('秘密情報・deploy呼出しscriptを漏れなくtrust対象にする', () => {
  for (const filename of [
    'scripts/deploy-artifact.ts',
    'scripts/run-e2e.ts',
    'scripts/create-staging-evidence.ts',
    'scripts/deployment-contract.ts',
    'scripts/verify-deployed-database-security.ts',
    'scripts/fixtures/malicious-deploy-workflow.yml',
    'scripts/fixtures/malicious-tenant-policy.sql',
  ])
    assert.equal(isProtectedPath(filename), true, filename);
  assert.equal(isProtectedPath('docs/trust-root-bootstrap.md'), false);
});

test('deploy script改変の悪性fixtureを固定する', async () => {
  const fixture = await readFile(
    path.join(root, 'scripts/fixtures/malicious-deploy-workflow.yml'),
    'utf8',
  );
  assert.match(fixture, /pnpm deploy:production/);
  assert.match(fixture, /DIRECT_URL/);
});

test('RLS弱体化とcolumn grantの悪性fixtureを固定する', async () => {
  const fixture = await readFile(
    path.join(root, 'scripts/fixtures/malicious-tenant-policy.sql'),
    'utf8',
  );
  assert.match(fixture, /tenant_id = tenant_id/);
  assert.match(fixture, /app\.role[^\n]+IS NOT NULL/);
  assert.match(fixture, /malicious_missing_user_id/);
  assert.match(fixture, /WITH GRANT OPTION/);
});
