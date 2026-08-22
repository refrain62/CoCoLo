import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type MigrationSqlFile,
  validateMigrationSql,
} from './verify-migration-sql.ts';

const safeMigration: MigrationSqlFile = {
  path: '20260822090000_foundation/migration.sql',
  content: [
    'CREATE TABLE tenants (id uuid PRIMARY KEY, tenant_id uuid, FOREIGN KEY (tenant_id) REFERENCES tenants(id));',
    "COMMENT ON TABLE tenants IS 'team';",
    'ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE tenants FORCE ROW LEVEL SECURITY;',
    "CREATE POLICY tenants_select ON tenants FOR SELECT USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);",
    'GRANT SELECT ON tenants TO cocolo_app;',
  ].join('\n'),
};

test('新規テーブルはCOMMENT・RLS・policy・権限を同じmigrationで要求する', () => {
  assert.doesNotThrow(() => validateMigrationSql([safeMigration]));
});

test('新規テーブルの保護を別migrationへ分割して隠せない', () => {
  assert.throws(() =>
    validateMigrationSql([
      {
        path: safeMigration.path,
        content: [
          'CREATE TABLE tenants (id uuid PRIMARY KEY);',
          "COMMENT ON TABLE tenants IS 'team';",
        ].join('\n'),
      },
      {
        path: '20260822100000_hardening/migration.sql',
        content: [
          'ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;',
          'ALTER TABLE tenants FORCE ROW LEVEL SECURITY;',
          'CREATE POLICY tenants_select ON tenants FOR SELECT USING (true);',
          'GRANT SELECT ON tenants TO cocolo_app;',
          'ALTER TABLE tenants ADD CONSTRAINT tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);',
        ].join('\n'),
      },
    ]),
  );
});

test('安全な別migrationがあってもRLS無効化を隠せない', () => {
  const unsafeMigration: MigrationSqlFile = {
    path: '20260822100000_unsafe/migration.sql',
    content: 'ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;',
  };
  assert.throws(() => validateMigrationSql([safeMigration, unsafeMigration]));
});

test('RLS FORCE解除を拒否する', () => {
  assert.throws(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260822100000_unsafe/migration.sql',
        content: 'ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;',
      },
    ]),
  );
});

test('危険な削除・一括更新SQLを拒否する', () => {
  for (const content of [
    'DROP TABLE tenants;',
    'ALTER TABLE tenants DROP COLUMN name;',
    'TRUNCATE tenants;',
    'DELETE FROM tenants;',
    'REVOKE SELECT ON tenants FROM cocolo_app;',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822100000_unsafe/migration.sql',
          content,
        },
      ]),
    );
  }
});

test('cocolo_app以外への権限付与とGRANT OPTIONを拒否する', () => {
  for (const content of [
    'GRANT SELECT ON tenants TO PUBLIC;',
    'GRANT SELECT ON tenants TO another_role;',
    'GRANT SELECT ON tenants TO cocolo_app WITH GRANT OPTION;',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822100000_unsafe/migration.sql',
          content,
        },
      ]),
    );
  }
});

test('既存のDROP POLICYとDROP TRIGGERは再作成用として許可する', () => {
  assert.doesNotThrow(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260822100000_recreate/migration.sql',
        content: [
          'DROP POLICY IF EXISTS tenants_select ON tenants;',
          'DROP TRIGGER IF EXISTS tenant_guard ON tenants;',
          "CREATE POLICY tenants_select ON tenants FOR SELECT USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);",
          'CREATE TRIGGER tenant_guard BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenant_guard_function();',
        ].join('\n'),
      },
    ]),
  );
});

test('DROP POLICY/TRIGGER単独で既存の保護を削除するmigrationを拒否する', () => {
  for (const content of [
    'DROP POLICY IF EXISTS tenants_select ON tenants;',
    'DROP TRIGGER IF EXISTS tenant_guard ON tenants;',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822110000_remove-guard/migration.sql',
          content,
        },
      ]),
    );
  }
});

test('コメント内の危険SQLは無視し、コメントを挟んだ危険SQLは拒否する', () => {
  assert.doesNotThrow(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260822110000_comment/migration.sql',
        content:
          "-- DROP TABLE tenants;\n/* ALTER TABLE tenants DISABLE ROW LEVEL SECURITY; */\nCOMMENT ON TABLE tenants IS 'still safe';",
      },
    ]),
  );
  assert.throws(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260822110000_comment/migration.sql',
        content: 'ALTER TABLE tenants DISABLE /* intent */ ROW LEVEL SECURITY;',
      },
    ]),
  );
});

test('CREATE TABLE ASとLIKEを拒否する', () => {
  for (const content of [
    'CREATE TABLE leaked AS SELECT * FROM members;',
    'CREATE TABLE leaked (LIKE members);',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822110000_unsafe/migration.sql',
          content,
        },
      ]),
    );
  }
});

test('未知DDLと危険DDL・複数granteeを拒否する', () => {
  for (const content of [
    'ALTER TABLE members DROP CONSTRAINT members_fk;',
    'ALTER TABLE members DISABLE TRIGGER ALL;',
    'CREATE OR REPLACE FUNCTION unsafe() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
    'CREATE VIEW leaked AS SELECT * FROM members;',
    'SET row_security = off;',
    'GRANT SELECT ON members TO cocolo_app, PUBLIC;',
    'CREATE SCHEMA leaked;',
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822110000_unsafe/migration.sql',
          content,
        },
      ]),
    );
  }
});

test('必須tableのtenant_id欠落を拒否する', () => {
  assert.throws(() =>
    validateMigrationSql([
      safeMigration,
      {
        path: '20260822110000_missing-tenant/migration.sql',
        content: [
          'CREATE TABLE members (id uuid PRIMARY KEY);',
          "COMMENT ON TABLE members IS 'members';",
          'ALTER TABLE members ENABLE ROW LEVEL SECURITY;',
          'ALTER TABLE members FORCE ROW LEVEL SECURITY;',
          "CREATE POLICY members_select ON members FOR SELECT USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);",
          'GRANT SELECT ON members TO cocolo_app;',
        ].join('\n'),
      },
    ]),
  );
});

test('RLS policyのUSINGとWITH CHECKにtenant境界を要求する', () => {
  for (const content of [
    'CREATE POLICY members_select ON members FOR SELECT USING (true);',
    "CREATE POLICY members_select ON members FOR SELECT USING (true OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);",
    "CREATE POLICY members_write ON members FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (true);",
    "CREATE POLICY members_select ON members FOR SELECT USING (tenant_id IS NOT NULL AND current_setting('app.tenant_id', true) IS NOT NULL);",
  ]) {
    assert.throws(() =>
      validateMigrationSql([
        safeMigration,
        {
          path: '20260822110000_unsafe-policy/migration.sql',
          content,
        },
      ]),
    );
  }
});
