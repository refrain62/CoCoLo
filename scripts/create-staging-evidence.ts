import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertDeploymentRecord } from './deployment-contract.ts';
import { verifyReleaseArtifact } from './verify-release.ts';

// stagingで実行済みのmigration・smoke・E2Eと、配置したartifact SHAをproduction昇格用証跡へ束ねる。
const artifactSha = process.env.ARTIFACT_SHA;
if (typeof artifactSha !== 'string' || !/^[0-9a-f]{40}$/.test(artifactSha))
  throw new Error('ARTIFACT_SHA は40桁の小文字 SHA-1 で指定してください。');
const deploymentRecordPath =
  process.env.STAGING_DEPLOYMENT_RECORD ??
  path.join('.release', 'deployment-record.json');
const releaseDir =
  process.env.RELEASE_DIR ?? path.dirname(deploymentRecordPath);
const releaseManifest = await verifyReleaseArtifact(releaseDir, artifactSha);
const artifactChecksum = (
  await readFile(path.join(releaseDir, 'artifact.sha256'), 'utf8')
)
  .trim()
  .split(/\s+/)[0];
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
  artifactSha256: artifactChecksum,
  migrationChecksumSha256: releaseManifest.migrationChecksumSha256,
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
