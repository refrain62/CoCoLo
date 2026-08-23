import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyDatabaseSecurity } from './verify-database-security.ts';
import { verifyMigrationChecksum } from './verify-migration-checksum.ts';
import { verifyMigrationHistoryAtDatabase } from './verify-migration-history.ts';
import {
  type ReleaseManifest,
  verifyReleaseArtifact,
} from './verify-release.ts';

type DeploymentEnvironment = 'staging' | 'production';

type StagingEvidence = Readonly<{
  workflowName: string;
  workflowPath: string;
  event: string;
  headBranch: string;
  headSha: string;
  artifactSha: string;
  artifactSha256: string;
  migrationChecksumSha256: string;
  schemaDriftRunId: string;
  schemaDrift: string;
  migration: string;
  smoke: string;
  e2e: string;
}>;

function assertDeploymentEnvironment(environment: DeploymentEnvironment): void {
  assert.equal(
    process.env.APP_ENV,
    environment,
    `deploy環境とAPP_ENVが一致しません（${environment}が必要です）。`,
  );
}

export function assertStagingEvidence(
  value: unknown,
  expectedSha: string,
  expectedArtifactSha256: string,
  expectedMigrationChecksumSha256: string,
): StagingEvidence {
  assert.ok(
    value && typeof value === 'object',
    'staging証跡がオブジェクトではありません。',
  );
  const evidence = value as Partial<StagingEvidence>;
  assert.equal(
    evidence.workflowName,
    'ステージングへデプロイ',
    'staging証跡のworkflow名が不一致です。',
  );
  assert.equal(
    evidence.workflowPath,
    '.github/workflows/staging-deploy.yml',
    'staging証跡のworkflow pathが不一致です。',
  );
  assert.equal(evidence.event, 'push', 'staging証跡のeventが不一致です。');
  assert.equal(
    evidence.headBranch,
    'main',
    'staging証跡はmain由来でなければなりません。',
  );
  assert.equal(
    evidence.headSha,
    expectedSha,
    'staging証跡のhead SHAが不一致です。',
  );
  assert.equal(
    evidence.artifactSha,
    expectedSha,
    'staging証跡のartifact SHAが不一致です。',
  );
  assert.equal(
    evidence.artifactSha256,
    expectedArtifactSha256,
    'staging証跡のartifact checksumが不一致です。',
  );
  assert.equal(
    evidence.migrationChecksumSha256,
    expectedMigrationChecksumSha256,
    'staging証跡のmigration checksumが不一致です。',
  );
  assert.match(
    evidence.schemaDriftRunId ?? '',
    /^\d+$/,
    'staging証跡のschema-drift run IDが不正です。',
  );
  assert.equal(
    evidence.schemaDrift,
    'success',
    'staging証跡のschema-driftがsuccessではありません。',
  );
  for (const key of ['migration', 'smoke', 'e2e'] as const)
    assert.equal(
      evidence[key],
      'success',
      `staging証跡の${key}がsuccessではありません。`,
    );
  return evidence as StagingEvidence;
}

function assertGitHubDeploymentProvenance(
  environment: DeploymentEnvironment,
  artifactSha: string,
): void {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'deployはGitHub Actions上でのみ実行できます。',
  );
  assert.match(
    process.env.GITHUB_REPOSITORY ?? '',
    /^[^/]+\/[^/]+$/,
    'GitHub repository provenanceがありません。',
  );
  assert.match(
    process.env.GITHUB_RUN_ID ?? '',
    /^\d+$/,
    'GitHub Actions run IDがありません。',
  );
  assert.ok(
    process.env.GITHUB_WORKFLOW,
    'GitHub Actions workflow provenanceがありません。',
  );
  assert.equal(
    process.env.ARTIFACT_ATTESTATION_VERIFIED,
    'true',
    '成果物のGitHub attestation検証が完了していません。',
  );
  if (environment === 'staging')
    assert.equal(
      process.env.GITHUB_SHA,
      artifactSha,
      'staging artifactとGitHub commit SHAが不一致です。',
    );
}

async function readArtifactChecksum(releaseDir: string): Promise<string> {
  return (await readFile(path.join(releaseDir, 'artifact.sha256'), 'utf8'))
    .trim()
    .split(/\s+/)[0] as string;
}

export async function verifyDeployPreconditions(
  environment: DeploymentEnvironment,
  artifactSha: string,
  releaseDir: string,
): Promise<ReleaseManifest> {
  assertDeploymentEnvironment(environment);
  assertGitHubDeploymentProvenance(environment, artifactSha);
  const manifest = await verifyReleaseArtifact(releaseDir, artifactSha);
  await verifyMigrationChecksum();
  const artifactSha256 = await readArtifactChecksum(releaseDir);
  if (environment === 'production') {
    const evidencePath =
      process.env.STAGING_EVIDENCE_FILE ??
      path.join('.evidence', 'evidence.json');
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    assertStagingEvidence(
      evidence,
      artifactSha,
      artifactSha256,
      manifest.migrationChecksumSha256,
    );
  }
  await verifyDatabaseSecurity({ ...process.env, APP_ENV: environment });
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, 'deploy前検査にはDIRECT_URLが必要です。');
  await verifyMigrationHistoryAtDatabase(directUrl);
  return manifest;
}

// adapter完了後にも同じ実DB検査を通し、配置記録だけの自己申告を成功扱いにしない。
export async function verifyDeployPostconditions(
  environment: DeploymentEnvironment,
): Promise<void> {
  assertDeploymentEnvironment(environment);
  await verifyDatabaseSecurity({ ...process.env, APP_ENV: environment });
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, 'deploy後検査にはDIRECT_URLが必要です。');
  await verifyMigrationHistoryAtDatabase(directUrl);
}
