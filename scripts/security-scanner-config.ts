import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const scannerNames = ['gitleaks', 'semgrep', 'trivy'] as const;
export type ScannerName = (typeof scannerNames)[number];

export type ScannerToolConfig = {
  image: string;
  version: string;
  digest: string;
  network: 'none' | 'bridge';
  ruleFile: string;
  command: string[];
  environment: Record<string, string>;
};

export type ScannerConfig = {
  schemaVersion: 1;
  tools: Record<ScannerName, ScannerToolConfig>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.values(value).every((entry) => typeof entry === 'string');

// CIとローカルが同じimage@digest・固定ルール・出力形式を使うことを保証する。
export function validateScannerConfig(value: unknown): ScannerConfig {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.tools))
    throw new Error('security scanner設定のschemaが不正です。');

  const configuredNames = Object.keys(value.tools).sort();
  const expectedNames = [...scannerNames].sort();
  if (configuredNames.join(',') !== expectedNames.join(','))
    throw new Error('Gitleaks、Semgrep、Trivyの設定が揃っていません。');

  const tools = {} as Record<ScannerName, ScannerToolConfig>;
  for (const name of scannerNames) {
    const raw = value.tools[name];
    if (!isRecord(raw)) throw new Error(`${name}の設定が不正です。`);

    const { image, version, digest, network, ruleFile, command, environment } =
      raw;
    if (
      typeof image !== 'string' ||
      !/^[a-z0-9][a-z0-9./_-]*$/.test(image) ||
      typeof version !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version) ||
      typeof digest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(digest) ||
      (network !== 'none' && network !== 'bridge') ||
      typeof ruleFile !== 'string' ||
      ruleFile.startsWith('/') ||
      ruleFile.includes('..') ||
      !Array.isArray(command) ||
      !command.every((entry) => typeof entry === 'string') ||
      !command.includes('__OUTPUT__') ||
      !isStringRecord(environment)
    )
      throw new Error(`${name}の固定実行設定が不正です。`);

    if (
      Object.keys(environment).some(
        (key) =>
          /secret|token|password|credential|private.?key/i.test(key) ||
          /\$\{|\r|\n/.test(environment[key] ?? ''),
      )
    )
      throw new Error(`${name}へsecret系の環境変数を渡せません。`);

    tools[name] = {
      image,
      version,
      digest,
      network,
      ruleFile,
      command,
      environment,
    };
  }

  return { schemaVersion: 1, tools };
}

export async function readScannerConfig(root: string): Promise<ScannerConfig> {
  const configPath = path.join(
    root,
    '.github',
    'security',
    'security-scanners.json',
  );
  const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  return validateScannerConfig(parsed);
}

export function scannerImageReference(config: ScannerToolConfig): string {
  return `${config.image}:${config.version}@${config.digest}`;
}
