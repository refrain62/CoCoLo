import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimePackages = [
  ['apps/api', 'dist/server.js'],
  ['packages/auth', 'dist/index.js'],
  ['packages/contracts', 'dist/index.js'],
  ['packages/db', 'dist/index.js'],
  ['packages/domain', 'dist/index.js'],
] as const;

function runNodeScript(
  script: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(
    result.status,
    0,
    `${script}の実行に失敗しました。\n${result.stdout}\n${result.stderr}`,
  );
}

test('release artifactはAPIのruntime workspace packageとmetadataを含む', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'cocolo-release-'));
  const sha = 'a'.repeat(40);
  try {
    runNodeScript(
      path.join(root, 'scripts/package-release.ts'),
      ['--artifact-sha', sha, '--output', output],
      root,
      {
        VITE_SUPABASE_URL: 'https://test-ref.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key.jwt',
      },
    );
    runNodeScript(
      path.join(root, 'scripts/verify-release.ts'),
      ['--artifact-sha', sha, '--release-dir', output],
      root,
    );
    const manifest = JSON.parse(
      await readFile(path.join(output, 'release-manifest.json'), 'utf8'),
    ) as { runtimePackages: Array<{ directory: string; entrypoint: string }> };
    assert.deepEqual(
      manifest.runtimePackages.map(({ directory, entrypoint }) => [
        directory,
        entrypoint,
      ]),
      runtimePackages,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
