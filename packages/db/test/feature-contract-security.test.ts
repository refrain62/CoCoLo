import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const baseMigration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20260825100000_team_feature_contract/migration.sql',
  ),
  'utf8',
);
const operatorMigration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20260826110000_feature_contract_operator_grants/migration.sql',
  ),
  'utf8',
);
const migration = `${baseMigration}\n${operatorMigration}`;

test('課金operatorのfeature変更監査はmembership RLSと分離される', () => {
  assert.match(
    migration,
    /DROP POLICY IF EXISTS audit_logs_insert ON audit_logs/,
  );
  assert.match(migration, /current_setting\('app\.role', true\) = 'operator'/);
  assert.match(
    migration,
    /actor_user_id = current_setting\('app\.user_id', true\)/,
  );
});

test('課金連携はプランカタログとevent台帳をDBへ持つ', () => {
  assert.match(migration, /CREATE TABLE feature_plan_definitions/);
  assert.match(migration, /CREATE TABLE feature_contract_events/);
  assert.match(migration, /CREATE TABLE feature_grant_approvals/);
  assert.match(migration, /feature_grant_approvals_operator_consume/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, approval_id\)/);
  assert.match(
    migration,
    /FOREIGN KEY \(tenant_id, provider_account_id\)[\s\S]*tenant_billing_accounts/,
  );
  assert.match(
    migration,
    /feature_key varchar\(64\) NOT NULL REFERENCES feature_definitions/,
  );
  assert.match(migration, /UNIQUE \(tenant_id, event_id\)/);
  assert.match(migration, /provider_version integer NOT NULL DEFAULT 0/);
});
