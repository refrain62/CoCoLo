import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  throw new Error('成果物の SHA は40桁の小文字 SHA-1 で指定してください。');

await mkdir(output, { recursive: true });
const runtimePackages = [
  {
    name: '@cocolo/api',
    directory: 'apps/api',
    entrypoint: 'dist/server.js',
  },
  {
    name: '@cocolo/auth',
    directory: 'packages/auth',
    entrypoint: 'dist/index.js',
  },
  {
    name: '@cocolo/contracts',
    directory: 'packages/contracts',
    entrypoint: 'dist/index.js',
  },
  {
    name: '@cocolo/db',
    directory: 'packages/db',
    entrypoint: 'dist/index.js',
  },
  {
    name: '@cocolo/domain',
    directory: 'packages/domain',
    entrypoint: 'dist/index.js',
  },
] as const;
const runtimeFiles = runtimePackages.flatMap(({ directory }) => [
  `${directory}/dist`,
  `${directory}/package.json`,
]);
// production promoteで再buildしないため、APIが実行時にimportするworkspace packageも梱包する。
for (const file of [
  'apps/api/dist/line-delivery-worker.js',
  ...runtimeFiles,
  'pnpm-workspace.yaml',
])
  await access(path.join(root, file));
const files = [
  ...new Set([
    'apps/api/dist',
    'apps/web/dist',
    ...runtimeFiles,
    'packages/db/prisma/schema.prisma',
    'packages/db/prisma/migrations',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]),
];
const manifest = {
  artifactSha,
  workerEntrypoint: 'apps/api/dist/line-delivery-worker.js',
  runtimePackages,
  files,
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
