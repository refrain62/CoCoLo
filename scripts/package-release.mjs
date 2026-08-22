import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// API/Web、DB schema、migrationを同一artifactへ梱包し、SHA-256を後続環境でも再検証できる形にする。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output =
  process.argv[process.argv.indexOf('--output') + 1] ??
  path.join(root, '.release');
const artifactSha =
  process.argv[process.argv.indexOf('--artifact-sha') + 1] ??
  process.env.ARTIFACT_SHA;
if (!artifactSha || !/^[0-9a-f]{40}$/.test(artifactSha))
  throw new Error('artifact SHAは40桁の小文字SHA-1で指定してください');

await mkdir(output, { recursive: true });
const manifest = {
  artifactSha,
  files: [
    'apps/api/dist',
    'apps/web/dist',
    'packages/db/prisma/schema.prisma',
    'packages/db/prisma/migrations',
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
  throw new Error('release artifactの作成に失敗しました');
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(
  path.join(output, 'artifact.sha256'),
  `${digest}  release.tar.gz\n`,
  'utf8',
);
console.log(`immutable release artifactを ${output} に作成しました。`);
