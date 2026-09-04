import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertDeploymentRecord } from './deployment-contract.ts';
import {
  verifyDeployPostconditions,
  verifyDeployPreconditions,
} from './deployment-preconditions.ts';

// provider固有処理は外部adapterへ委譲し、検証済みartifactと配置記録を確認できない場合は配置成功にしない。
const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production')
  throw new Error(
    '配置環境は staging または production のいずれかで指定してください。',
  );
const shaIndex = process.argv.indexOf('--artifact-sha');
const releaseIndex = process.argv.indexOf('--release-dir');
const localStaging = process.argv.includes('--local');
if (localStaging && environment !== 'staging')
  throw new Error('ローカルデプロイ経路はstagingに限定されています。');
const artifactSha =
  (shaIndex === -1 ? undefined : process.argv[shaIndex + 1]) ??
  process.env.ARTIFACT_SHA;
const releaseDir =
  (releaseIndex === -1 ? undefined : process.argv[releaseIndex + 1]) ??
  '.release';
if (!artifactSha || !/^[0-9a-f]{40}$/.test(artifactSha))
  throw new Error('成果物の SHA は40桁の小文字 SHA-1 で指定してください。');

await verifyDeployPreconditions(environment, artifactSha, releaseDir, {
  localStaging,
});

const adapter = process.env[`${environment.toUpperCase()}_DEPLOY_ADAPTER`];
if (!adapter)
  throw new Error(
    `${environment} 環境の配置アダプターが未設定です。配置を継続しません。`,
  );

const result = spawnSync(
  adapter,
  [
    '--artifact-sha',
    artifactSha,
    '--release-dir',
    releaseDir,
    '--environment',
    environment,
  ],
  { stdio: 'inherit', shell: false },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('配置アダプターが失敗しました。');

const recordPath = path.join(releaseDir, 'deployment-record.json');
const record = JSON.parse(await readFile(recordPath, 'utf8'));
assertDeploymentRecord(record, { artifactSha, environment });
await verifyDeployPostconditions(environment);
console.log(`${environment} 環境へ成果物 ${artifactSha} を配置しました。`);
