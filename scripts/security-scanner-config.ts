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

// 実行可能なscanner imageを名前・version・digestの組で固定する。個別の値だけを検証して差し替えを許さない。
export const scannerImageAllowlist: Record<
  ScannerName,
  Pick<ScannerToolConfig, 'image' | 'version' | 'digest'>
> = {
  gitleaks: {
    image: 'zricethezav/gitleaks',
    version: 'v8.28.0',
    digest:
      'sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854',
  },
  semgrep: {
    image: 'semgrep/semgrep',
    version: '1.136.0',
    digest:
      'sha256:cda1b566fafbf6010a02a3ea1d265b1c8eba4380e489a13891a102243d81ca6f',
  },
  trivy: {
    image: 'aquasec/trivy',
    version: '0.58.0',
    digest:
      'sha256:b88012e2a0a309d6a8a00463d4e63e5e513377fb74eccbc8f9b0f8f81940ebeb',
  },
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
      image !== scannerImageAllowlist[name].image ||
      typeof version !== 'string' ||
      version !== scannerImageAllowlist[name].version ||
      typeof digest !== 'string' ||
      digest !== scannerImageAllowlist[name].digest ||
      (network !== 'none' && network !== 'bridge') ||
      typeof ruleFile !== 'string' ||
      ruleFile.startsWith('/') ||
      ruleFile.includes('..') ||
      !Array.isArray(command) ||
      !command.every((entry) => typeof entry === 'string') ||
      !command.includes('__OUTPUT__') ||
      !isStringRecord(environment)
    )
      throw new Error(
        `${name}の許可されたimage・version・digest対応が不正です。`,
      );

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
