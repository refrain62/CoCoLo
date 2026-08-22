import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  assertDatabaseSecurity,
  inspectDatabase,
} from './verify-database-security.ts';

type DeploymentEnvironment = 'staging' | 'production';

function requiredDeploymentEnvironment(
  env: NodeJS.ProcessEnv,
): DeploymentEnvironment {
  const environment = env.DEPLOY_ENV;
  assert.ok(
    environment === 'staging' || environment === 'production',
    '実DB検査にはstaging/productionのDEPLOY_ENVが必要です。',
  );
  assert.equal(env.APP_ENV, environment, 'DEPLOY_ENVとAPP_ENVが一致しません。');
  assert.equal(
    env.GITHUB_ACTIONS,
    'true',
    '実DB検査はGitHub Actionsのdeploy jobからだけ実行できます。',
  );
  assert.equal(
    env.DEPLOYMENT_APPROVED,
    `${environment}-approved`,
    'Environment protection完了の証拠がありません。',
  );
  return environment;
}

function requiredDirectUrl(env: NodeJS.ProcessEnv): string {
  const directUrl = env.DIRECT_URL;
  assert.ok(
    directUrl,
    'staging/productionの実DB検査には検証済みDIRECT_URLが必要です。',
  );
  const parsed = new URL(directUrl);
  assert.ok(
    parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:',
    'DIRECT_URLはPostgreSQL URLで指定してください。',
  );
  assert.ok(
    !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname),
    'deploy後の実DB検査へlocal DBを注入できません。',
  );
  return directUrl;
}

export function assertDeployedDatabaseConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): { environment: DeploymentEnvironment; directUrl: string } {
  return {
    environment: requiredDeploymentEnvironment(env),
    directUrl: requiredDirectUrl(env),
  };
}

export async function verifyDeployedDatabaseSecurity(): Promise<void> {
  const { environment, directUrl } = assertDeployedDatabaseConfiguration();
  const inspection = await inspectDatabase(directUrl);
  assertDatabaseSecurity(inspection);
  console.log(
    `${environment}のdeploy後実DB security/RLS/ACL/role driftを照合しました。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyDeployedDatabaseSecurity();
