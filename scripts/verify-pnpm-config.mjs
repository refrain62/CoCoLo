import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const workspace = await readFile(
  path.join(root, 'pnpm-workspace.yaml'),
  'utf8',
);
assert.equal(
  packageJson.packageManager,
  'pnpm@10.26.0',
  'pnpmのバージョンを固定してください',
);
assert.match(workspace, /minimumReleaseAge:\s+2880/);
assert.match(workspace, /blockExoticSubdeps:\s+true/);
assert.match(workspace, /strictDepBuilds:\s+true/);
assert.match(workspace, /onlyBuiltDependencies:/);
console.log('pnpm設定を検証しました。');
