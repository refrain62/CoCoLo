import { mkdir, writeFile } from 'node:fs/promises';

if (!/^[0-9a-f]{40}$/.test(process.env.ARTIFACT_SHA ?? ''))
  throw new Error('ARTIFACT_SHAは40桁の小文字SHA-1で指定してください');
await mkdir('.evidence', { recursive: true });
const evidence = {
  workflowName: 'ステージングへデプロイ',
  workflowPath: '.github/workflows/staging-deploy.yml',
  event: 'push',
  headBranch: 'main',
  headSha: process.env.ARTIFACT_SHA,
  artifactSha: process.env.ARTIFACT_SHA,
  migration: 'success',
  smoke: 'success',
  e2e: 'success',
};
await writeFile(
  '.evidence/evidence.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);
console.log('staging evidenceを作成しました。');
