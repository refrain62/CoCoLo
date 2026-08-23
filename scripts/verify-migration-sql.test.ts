import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type MigrationSqlFile,
  validateMigrationSql,
} from './verify-migration-sql.ts';

const safeMigration: MigrationSqlFile = {
  path: '20260823160000_safe/migration.sql',
  content: [
    'CREATE TABLE records (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, FOREIGN KEY (tenant_id) REFERENCES tenants(id));',
    "COMMENT ON TABLE records IS 'tenant data';",
    'ALTER TABLE records ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE records FORCE ROW LEVEL SECURITY;',
    "CREATE POLICY records_select ON records FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);",
    'GRANT SELECT ON records TO cocolo_app;',
  ].join('\n'),
};

test('新規tableのCOMMENT・RLS・policy・tenant権限を同一migrationで要求する', () => {
  assert.doesNotThrow(() => validateMigrationSql([safeMigration]));
});

test('危険なDDL・一括削除・任意roleへの権限付与を拒否する', () => {
  for (const content of [
    'DROP TABLE records;',
    'ALTER TABLE records DISABLE ROW LEVEL SECURITY;',
    'DELETE FROM records;',
    'GRANT SELECT ON records TO PUBLIC;',
    'GRANT SELECT ON records TO another_role;',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        { path: '20260823160001_unsafe/migration.sql', content },
      ]),
    );
  }
  assert.throws(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260823160002_public_grant/migration.sql',
        content: 'GRANT SELECT ON records TO cocolo_app, PUBLIC;',
      },
    ]),
  );
});

test('新規tableの保護不足と無条件policyを拒否する', () => {
  assert.throws(() =>
    validateMigrationSql([
      {
        path: safeMigration.path,
        content: [
          'CREATE TABLE records (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);',
          "COMMENT ON TABLE records IS 'tenant data';",
          'ALTER TABLE records ENABLE ROW LEVEL SECURITY;',
          'GRANT SELECT ON records TO cocolo_app;',
        ].join('\n'),
      },
    ]),
  );
  assert.throws(() =>
    validateMigrationSql([
      {
        ...safeMigration,
        content: safeMigration.content.replace(
          "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
          'true',
        ),
      },
    ]),
  );
  assert.throws(() =>
    validateMigrationSql([
      {
        ...safeMigration,
        content: safeMigration.content.replace(
          "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
          'tenant_id IS NOT NULL OR tenant_id = NULL',
        ),
      },
    ]),
  );
  assert.throws(() =>
    validateMigrationSql([
      {
        ...safeMigration,
        content: safeMigration.content.replace(
          "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
          "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR true",
        ),
      },
    ]),
  );
});

test('worker専用outboxのapp role無権限を許可する', () => {
  assert.doesNotThrow(() =>
    validateMigrationSql([
      {
        path: '20260823160000_line_delivery/migration.sql',
        content: [
          'CREATE TABLE line_delivery_outbox (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, FOREIGN KEY (tenant_id) REFERENCES tenants(id));',
          "COMMENT ON TABLE line_delivery_outbox IS 'worker queue';",
          'ALTER TABLE line_delivery_outbox ENABLE ROW LEVEL SECURITY;',
          'ALTER TABLE line_delivery_outbox FORCE ROW LEVEL SECURITY;',
          "CREATE POLICY line_delivery_outbox_select ON line_delivery_outbox FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true));",
          'GRANT EXECUTE ON FUNCTION app_enqueue_line_delivery(uuid) TO cocolo_app;',
        ].join('\n'),
      },
    ]),
  );
});
