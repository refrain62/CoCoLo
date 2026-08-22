const environments = new Set(['staging', 'production']);

export function assertDeploymentRecord(record, expected) {
  if (!record || typeof record !== 'object')
    throw new Error('配置記録がオブジェクトではありません');
  if (record.status !== 'success')
    throw new Error('配置記録がsuccessではありません');
  if (record.artifactSha !== expected.artifactSha)
    throw new Error('配置済みartifact SHAが一致しません');
  if (record.environment !== expected.environment)
    throw new Error('配置環境が一致しません');
  if (!environments.has(record.environment))
    throw new Error('配置環境が不正です');
  if (typeof record.deployedUrl !== 'string' || !record.deployedUrl)
    throw new Error('配置URLが必要です');
  try {
    const url = new URL(record.deployedUrl);
    if (url.protocol !== 'https:') throw new Error('配置URLはHTTPSが必要です');
  } catch (error) {
    if (error instanceof Error && error.message === '配置URLはHTTPSが必要です')
      throw error;
    throw new Error('配置URLが不正です');
  }
  if (typeof record.deployedAt !== 'string' || !record.deployedAt)
    throw new Error('配置時刻が必要です');
  return record;
}
