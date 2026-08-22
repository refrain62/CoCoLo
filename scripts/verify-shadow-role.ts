import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type ShadowRoleInspection = Readonly<{
  roleName: string;
  currentUser: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  hasMembership: boolean;
}>;

// Shadow roleはDDLを実行できるが、管理者権限・RLS迂回権限・他roleへの所属を持たないことを実DBで確認する。
export function assertShadowRoleAttributes(
  inspection: ShadowRoleInspection,
  expectedRole: string,
): void {
  assert.equal(
    inspection.currentUser,
    expectedRole,
    'Shadow DB接続roleが不一致です。',
  );
  assert.equal(
    inspection.roleName,
    expectedRole,
    'Shadow roleが存在しません。',
  );
  assert.equal(
    inspection.isSuperuser,
    false,
    'Shadow roleにsuperuser権限があります。',
  );
  assert.equal(
    inspection.bypassRls,
    false,
    'Shadow roleにbypassrls権限があります。',
  );
  assert.equal(
    inspection.canCreateDatabase,
    false,
    'Shadow roleにcreatedb権限があります。',
  );
  assert.equal(
    inspection.canCreateRole,
    false,
    'Shadow roleにcreaterole権限があります。',
  );
  assert.equal(
    inspection.canReplicate,
    false,
    'Shadow roleにreplication権限があります。',
  );
  assert.equal(
    inspection.hasMembership,
    false,
    'Shadow roleにrole membershipがあります。',
  );
}

type PrismaClientLike = Readonly<{
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
  $disconnect: () => Promise<void>;
}>;

type PrismaClientConstructor = new (options: {
  datasources: { db: { url: string } };
}) => PrismaClientLike;

function loadPrismaClient(): PrismaClientConstructor {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const require = createRequire(
    path.join(root, 'packages', 'db', 'package.json'),
  );
  try {
    const loaded = require('@prisma/client') as {
      PrismaClient: PrismaClientConstructor;
    };
    return loaded.PrismaClient;
  } catch (error) {
    throw new Error('Shadow role検査用のPrisma Clientを読み込めません。', {
      cause: error,
    });
  }
}

export async function inspectShadowRole(
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL,
  expectedRole = process.env.SHADOW_DATABASE_ROLE,
): Promise<void> {
  assert.ok(shadowDatabaseUrl, 'SHADOW_DATABASE_URLが必要です。');
  assert.ok(expectedRole, 'SHADOW_DATABASE_ROLEが必要です。');
  const parsed = new URL(shadowDatabaseUrl);
  assert.equal(
    parsed.password,
    '',
    'SHADOW_DATABASE_URLにパスワードを含めず、専用の外部認証を設定してください。',
  );
  assert.match(expectedRole, /^[a-z_][a-z0-9_]*$/, 'Shadow role名が不正です。');

  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient({
    datasources: { db: { url: shadowDatabaseUrl } },
  });
  try {
    const rows = await prisma.$queryRawUnsafe<ShadowRoleInspection[]>(
      `SELECT r.rolname AS "roleName",
              current_user AS "currentUser",
              r.rolsuper AS "isSuperuser",
              r.rolbypassrls AS "bypassRls",
              r.rolcreatedb AS "canCreateDatabase",
              r.rolcreaterole AS "canCreateRole",
              r.rolreplication AS "canReplicate",
              EXISTS (
                SELECT 1
                  FROM pg_auth_members m
                 WHERE m.member = r.oid
              ) AS "hasMembership"
         FROM pg_roles r
        WHERE r.rolname = $1`,
      expectedRole,
    );
    assert.equal(rows.length, 1, 'Shadow roleが見つかりません。');
    assertShadowRoleAttributes(rows[0] as ShadowRoleInspection, expectedRole);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  await inspectShadowRole();
  console.log('Shadow roleの属性とmembershipを実DBで検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
