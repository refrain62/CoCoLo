import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
) as { packageManager?: unknown };
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const pnpmVersion = execFileSync(pnpmCommand, ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim();

validateRuntimeToolchain({
  nodeVersion: process.versions.node,
  pnpmVersion,
});
validateRepositoryToolchain({
  miseToml: await readFile(path.join(root, 'mise.toml'), 'utf8'),
  packageManager:
    typeof packageJson.packageManager === 'string'
      ? packageJson.packageManager
      : '',
  workflows,
});
console.log('Node.js 24.12.0とpnpm 10.26.0のtoolchainを検証しました。');
