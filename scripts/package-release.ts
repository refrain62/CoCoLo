import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMigrationChecksum } from './verify-migration-checksum.ts';

// API/Web、DB schema、migrationを同一artifactへ梱包し、SHA-256を後続環境でも再検証できる形にする。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputIndex = process.argv.indexOf('--output');
const output =
  (outputIndex === -1 ? undefined : process.argv[outputIndex + 1]) ??
  path.join(root, '.release');
const artifactShaIndex = process.argv.indexOf('--artifact-sha');
const artifactSha =
  (artifactShaIndex === -1 ? undefined : process.argv[artifactShaIndex + 1]) ??
  process.env.ARTIFACT_SHA;
if (!artifactSha || !/^[0-9a-f]{40}$/.test(artifactSha))
  throw new Error('成果物の SHA は40桁の小文字 SHA-1 で指定してください。');

await verifyMigrationChecksum(root);
const migrationChecksumFile = path.join(
  root,
  'packages',
  'db',
  'prisma',
  'migrations.sha256',
);
const migrationChecksumSha256 = createHash('sha256')
  .update(await readFile(migrationChecksumFile))
  .digest('hex');

await mkdir(output, { recursive: true });
const manifest = {
  artifactSha,
  migrationChecksumSha256,
  files: [
    'apps/api/dist',
    'apps/web/dist',
    'packages/db/prisma/schema.prisma',
    'packages/db/prisma/migrations',
    'packages/db/prisma/migrations.sha256',
    'package.json',
    'pnpm-lock.yaml',
  ],
  generatedAt: new Date().toISOString(),
};
await writeFile(
  path.join(output, 'release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

const archive = path.join(output, 'release.tar.gz');
const tarResult = spawnSync(
  'tar',
  ['-czf', archive, '-C', root, ...manifest.files],
  {
    stdio: 'inherit',
  },
);
if (tarResult.error) throw tarResult.error;
if (tarResult.status !== 0)
  throw new Error('リリース成果物の作成に失敗しました。');
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(
  path.join(output, 'artifact.sha256'),
  `${digest}  release.tar.gz\n`,
  'utf8',
);
console.log(`固定したリリース成果物を ${output} に作成しました。`);
