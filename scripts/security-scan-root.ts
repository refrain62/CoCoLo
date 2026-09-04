import path from 'node:path';

export function securityScanRoot(defaultRoot: string): string {
  const configuredRoot = process.env.SECURITY_TARGET_ROOT;
  if (!configuredRoot) return defaultRoot;
  if (!path.isAbsolute(configuredRoot))
    throw new Error('SECURITY_TARGET_ROOTは絶対パスで指定してください。');
  return configuredRoot;
}
