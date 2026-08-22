import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
const files = await readdir(directory).catch(() => []);
assert.ok(files.includes('quality.yml'), 'quality.yml が必要です');
assert.ok(
  files.includes('staging-deploy.yml'),
  'staging-deploy.yml が必要です',
);
assert.ok(
  files.includes('production-promote.yml'),
  'production-promote.yml が必要です',
);
for (const file of files.filter(
  (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
)) {
  const content = await readFile(path.join(directory, file), 'utf8');
  for (const match of content.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g)) {
    assert.match(
      match[2],
      /^[0-9a-f]{40}$/,
      `${file}: Action は SHA 固定が必要です: ${match[1]}`,
    );
  }
}
console.log('GitHub Actions のワークフローを検証しました。');
