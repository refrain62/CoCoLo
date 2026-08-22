import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSchemaDriftWorkflowConnected } from './verify-schema-drift.ts';

// 必須workflowの存在と、Actions参照が40桁SHA固定であることを検査する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
const files: string[] = await readdir(directory).catch(() => [] as string[]);
assert.ok(files.includes('quality.yml'), 'quality.yml が必要です');
assert.ok(files.includes('schema-drift.yml'), 'schema-drift.yml が必要です');
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
  for (const image of content.matchAll(/image:\s*postgres:[^\s]+/g))
    assert.match(
      image[0],
      /@sha256:[0-9a-f]{64}$/,
      `${file}: PostgreSQL service image digest が必要です`,
    );
  for (const nodeVersion of content.matchAll(/node-version:\s*([^\s#]+)/g))
    assert.equal(
      nodeVersion[1],
      '24.12.0',
      `${file}: Node.jsは24.12.0へ固定してください`,
    );
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
for (const file of ['staging-deploy.yml', 'production-promote.yml']) {
  const content = await readFile(path.join(directory, file), 'utf8');
  assert.match(
    content,
    /if:\s*\$\{\{\s*false\s*\}\}/,
    `${file}: GitHub Free期間のdeploy無効化がfail-closedではありません。`,
  );
  assert.doesNotMatch(content, /secrets\.|environment:\s*(staging|production)/);
  assert.doesNotMatch(
    content,
    /deploy:(?:staging|production)|prisma\s+migrate\s+deploy/,
  );
  assert.doesNotMatch(
    content,
    /actions\/checkout@/,
    `${file}: Free期間の無効Workflowはartifact検証前のcheckoutを持てません。`,
  );
}
const qualityContent = await readFile(
  path.join(directory, 'quality.yml'),
  'utf8',
);
assert.match(
  qualityContent,
  /pnpm\s+verify:pnpm-config[\s\S]*pnpm\s+lint:workflows/,
  'quality Workflowからlint:workflowsを実行してください。',
);
assert.match(
  qualityContent,
  /pnpm\s+verify:database-security/,
  'quality Workflowから実アプリDB security検査を実行してください。',
);
assert.match(
  await readFile(path.join(directory, 'schema-drift.yml'), 'utf8'),
  /pnpm\s+verify:database-security/,
  'schema-drift Workflowから実アプリDB security検査を実行してください。',
);
assertSchemaDriftWorkflowConnected(
  await readFile(path.join(directory, 'schema-drift.yml'), 'utf8'),
);
console.log('GitHub Actions のワークフローを検証しました。');
