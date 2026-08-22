import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceExtensions = new Set(['.ts', '.tsx']);
const ignored = new Set(['node_modules', 'dist', 'coverage', '.git']);

// 依存境界検査の対象ファイルを再帰的に収集し、生成物や管理対象外のディレクトリは除外する。
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(fullPath)));
    else if (sourceExtensions.has(path.extname(entry.name)))
      files.push(fullPath);
  }
  return files;
}

// Web/API/domain/contractsの依存方向と、production codeからtest fixtureへの参照禁止を宣言する。
const rules = [
  {
    scope: 'apps/web',
    forbidden: [
      '@cocolo/db',
      '@cocolo/auth',
      '@cocolo/api',
      'apps/api',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
    ],
  },
  {
    scope: 'packages/domain',
    forbidden: ['hono', 'react', '@prisma/client', 'process.env'],
  },
  { scope: 'packages/contracts', forbidden: ['@cocolo/db', '@cocolo/domain'] },
];
const violations = [];

for (const file of await filesUnder(root)) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const content = await readFile(file, 'utf8');
  for (const rule of rules) {
    if (
      relative.startsWith(`${rule.scope}/`) &&
      rule.forbidden.some((token) => content.includes(token))
    ) {
      violations.push(`${relative}: ${rule.scope} の禁止依存を検出しました`);
    }
  }
  const isProductionSource =
    relative.startsWith('apps/') || relative.startsWith('packages/');
  if (
    isProductionSource &&
    !relative.includes('/test/') &&
    !relative.endsWith('.test.ts') &&
    content.includes('@cocolo/test-fixtures')
  ) {
    violations.push(
      `${relative}: 本番コードから test-fixtures を参照しています`,
    );
  }
  if (
    relative.startsWith('apps/') &&
    /from ['"].*apps\/(web|api)/.test(content)
  ) {
    violations.push(`${relative}: apps 間の直接 import は禁止です`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('ワークスペースの依存境界を検証しました。');
