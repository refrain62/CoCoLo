import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 必須workflowの存在と、Actions参照が40桁SHA固定であることを検査する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
const files: string[] = await readdir(directory).catch(() => [] as string[]);
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
    const actionSha = match[2];
    assert.ok(actionSha, `${file}: Action SHA が必要です`);
    assert.match(
      actionSha,
      /^[0-9a-f]{40}$/,
      `${file}: Action は SHA 固定が必要です: ${match[1]}`,
    );
  }
}
console.log('GitHub Actions のワークフローを検証しました。');
