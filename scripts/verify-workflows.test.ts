import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  validateCodeowners,
  validatePackageScripts,
  validateWorkflow,
  workflowFiles,
} from './verify-workflows.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowDirectory = path.join(root, '.github', 'workflows');

async function workflow(name: (typeof workflowFiles)[number]): Promise<string> {
  return readFile(path.join(workflowDirectory, name), 'utf8');
}

test('現行Workflowをすべて受け入れる', async () => {
  for (const name of workflowFiles) {
    const content = await workflow(name);
    assert.doesNotThrow(() => validateWorkflow(name, content));
  }
});

test('未固定Actionを拒否する', async () => {
  const content = await workflow('quality.yml');
  assert.throws(() =>
    validateWorkflow(
      'quality.yml',
      content.replace(
        'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
        'evil/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ),
  );
});

test('quality gateのfail-closed条件を拒否する', async () => {
  const content = await workflow('quality.yml');
  assert.throws(() =>
    validateWorkflow(
      'quality.yml',
      content.replace(
        'QUALITY_RESULT" != "success"',
        'QUALITY_RESULT" == "success"',
      ),
    ),
  );
});

test('security gateのtrust依存削除を拒否する', async () => {
  const content = await workflow('security-scanners.yml');
  assert.throws(() =>
    validateWorkflow(
      'security-scanners.yml',
      content.replace('      - trust\n', ''),
    ),
  );
});

test('runへのGitHub expression直接展開を拒否する', async () => {
  const content = await workflow('quality.yml');
  const expression = ['$', '{', '{ github.event.pull_request.title }}'].join(
    '',
  );
  assert.throws(() =>
    validateWorkflow(
      'quality.yml',
      content.replace('run: pnpm ci:fast', `run: echo "${expression}"`),
    ),
  );
});

test('検査用package scriptの差し替えとCODEOWNERS削除を拒否する', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  assert.throws(() =>
    validatePackageScripts({
      ...packageJson,
      scripts: { ...packageJson.scripts, 'security:scan': 'echo bypass' },
    }),
  );
  const codeowners = await readFile(
    path.join(root, '.github', 'CODEOWNERS'),
    'utf8',
  );
  assert.throws(() =>
    validateCodeowners(codeowners.replace('/scripts/** @refrain62', '')),
  );
});
