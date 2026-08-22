const environments = new Set(['staging', 'production']);
type DeploymentEnvironment = 'staging' | 'production';
type DeploymentRecord = {
  status: string;
  artifactSha: string;
  environment: string;
  deployedUrl: string;
  deployedAt: string;
};
type DeploymentRecordInput = Partial<DeploymentRecord>;
type DeploymentExpectation = {
  artifactSha: string;
  environment: DeploymentEnvironment;
};

// 配置adapterの自己申告を、artifact SHA・環境・HTTPS URL・時刻まで検証して昇格判断に使える記録へ限定する。
export function assertDeploymentRecord(
  record: unknown,
  expected: DeploymentExpectation,
): DeploymentRecord {
  if (!record || typeof record !== 'object')
    throw new Error('配置記録がオブジェクトではありません');
  const candidate = record as DeploymentRecordInput;
  if (candidate.status !== 'success')
    throw new Error('配置記録の status が success ではありません。');
  if (candidate.artifactSha !== expected.artifactSha)
    throw new Error('配置済み成果物の SHA が一致しません。');
  if (candidate.environment !== expected.environment)
    throw new Error('配置環境が一致しません。');
  if (!environments.has(candidate.environment))
    throw new Error('配置環境が不正です。');
  if (typeof candidate.deployedUrl !== 'string' || !candidate.deployedUrl)
    throw new Error('配置 URL が必要です。');
  try {
    const url = new URL(candidate.deployedUrl);
    if (url.protocol !== 'https:')
      throw new Error('配置 URL には HTTPS が必要です。');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === '配置 URL には HTTPS が必要です。'
    )
      throw error;
    throw new Error('配置 URL が不正です。');
  }
  if (typeof candidate.deployedAt !== 'string' || !candidate.deployedAt)
    throw new Error('配置時刻が必要です。');
  return candidate as DeploymentRecord;
}
