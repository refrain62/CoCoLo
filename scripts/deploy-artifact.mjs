import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertDeploymentRecord } from './deployment-contract.mjs';

const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production')
  throw new Error('配置環境はstagingまたはproductionで指定してください');
const shaIndex = process.argv.indexOf('--artifact-sha');
const releaseIndex = process.argv.indexOf('--release-dir');
const artifactSha =
  (shaIndex === -1 ? undefined : process.argv[shaIndex + 1]) ??
  process.env.ARTIFACT_SHA;
const releaseDir =
  (releaseIndex === -1 ? undefined : process.argv[releaseIndex + 1]) ??
  '.release';
if (!artifactSha || !/^[0-9a-f]{40}$/.test(artifactSha))
  throw new Error('artifact SHAは40桁の小文字SHA-1で指定してください');

const adapter = process.env[`${environment.toUpperCase()}_DEPLOY_ADAPTER`];
if (!adapter)
  throw new Error(
    `${environment}のdeploy adapterが未設定です。配置を継続しません。`,
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
if (result.status !== 0) throw new Error('deploy adapterが失敗しました');

const recordPath = path.join(releaseDir, 'deployment-record.json');
const record = JSON.parse(await readFile(recordPath, 'utf8'));
assertDeploymentRecord(record, { artifactSha, environment });
console.log(`${environment}へartifact ${artifactSha}を配置しました。`);
