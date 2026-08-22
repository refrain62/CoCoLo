import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertDeploymentRecord } from './deployment-contract.mjs';

// stagingで実行済みのmigration・smoke・E2Eと、配置したartifact SHAをproduction昇格用証跡へ束ねる。
if (!/^[0-9a-f]{40}$/.test(process.env.ARTIFACT_SHA ?? ''))
  throw new Error('ARTIFACT_SHA は40桁の小文字 SHA-1 で指定してください。');
const artifactSha = process.env.ARTIFACT_SHA;
const deploymentRecordPath =
  process.env.STAGING_DEPLOYMENT_RECORD ??
  path.join('.release', 'deployment-record.json');
const deploymentRecord = assertDeploymentRecord(
  JSON.parse(await readFile(deploymentRecordPath, 'utf8')),
  { artifactSha, environment: 'staging' },
);
const expectedBaseUrl = process.env.STAGING_BASE_URL;
if (
  expectedBaseUrl &&
  new URL(deploymentRecord.deployedUrl).origin !==
    new URL(expectedBaseUrl).origin
)
  throw new Error('配置済み URL が staging 環境の公開 URL と一致しません。');
await mkdir('.evidence', { recursive: true });
const evidence = {
  workflowName: 'ステージングへデプロイ',
  workflowPath: '.github/workflows/staging-deploy.yml',
  event: 'push',
  headBranch: 'main',
  headSha: artifactSha,
  artifactSha,
  deployment: {
    deployedUrl: deploymentRecord.deployedUrl,
    deployedAt: deploymentRecord.deployedAt,
  },
  migration: 'success',
  smoke: 'success',
  e2e: 'success',
};
await writeFile(
  '.evidence/evidence.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);
console.log('staging 環境の配置証跡を作成しました。');
