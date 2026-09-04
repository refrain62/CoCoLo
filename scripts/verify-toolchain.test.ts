import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  expectedToolchain,
  validateRepositoryToolchain,
  validateRuntimeToolchain,
} from './toolchain-policy.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowDirectory = path.join(root, '.github', 'workflows');
const workflowNames = (await readdir(workflowDirectory)).filter(
  (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
);
const workflows = new Map(
  await Promise.all(
    workflowNames.map(
      async (name) =>
        [
          name,
          await readFile(path.join(workflowDirectory, name), 'utf8'),
        ] as const,
    ),
  ),
);
const packageJson = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
) as { packageManager: string };
const repositoryFiles = {
  miseToml: await readFile(path.join(root, 'mise.toml'), 'utf8'),
  packageManager: packageJson.packageManager,
  workflows,
};

test('リポジトリのtoolchain設定を固定値と照合する', () => {
  assert.doesNotThrow(() => validateRepositoryToolchain(repositoryFiles));
});

test('Node.jsとpnpmの実行バージョンを固定値と照合する', () => {
  assert.doesNotThrow(() =>
    validateRuntimeToolchain({
      nodeVersion: expectedToolchain.node,
      pnpmVersion: expectedToolchain.pnpm,
    }),
  );
  assert.throws(
    () =>
      validateRuntimeToolchain({
        nodeVersion: expectedToolchain.node,
        pnpmVersion: '11.19.0',
      }),
    /pnpmは10\.26\.0/,
  );
});

test('WorkflowのNode.js固定漏れを拒否する', () => {
  const drifted = new Map(repositoryFiles.workflows);
  const [name, content] = drifted.entries().next().value as [string, string];
  drifted.set(
    name,
    content.replace('node-version: 24.12.0', 'node-version: 24'),
  );
  assert.throws(
    () =>
      validateRepositoryToolchain({
        ...repositoryFiles,
        workflows: drifted,
      }),
    /node-version/,
  );
});
