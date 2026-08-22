import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  readScannerConfig,
  scannerImageAllowlist,
  validateScannerConfig,
} from './security-scanner-config.ts';
import { summarizeScannerResult } from './security-scanner-summary.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('scanner imageは固定allowlistと対応するdigestだけを受理する', async () => {
  const config = await readScannerConfig(root);
  assert.deepEqual(
    {
      image: config.tools.gitleaks.image,
      version: config.tools.gitleaks.version,
      digest: config.tools.gitleaks.digest,
    },
    scannerImageAllowlist.gitleaks,
  );

  const tampered = structuredClone(config) as typeof config;
  tampered.tools.gitleaks.digest = config.tools.semgrep.digest;
  assert.throws(
    () => validateScannerConfig(tampered),
    /許可されたimage・version・digest対応が不正です/,
  );
});

test('Gitleaksはgit履歴を検査する固定コマンドになっている', async () => {
  const configText = await readFile(
    path.join(root, '.github', 'security', 'security-scanners.json'),
    'utf8',
  );
  const config = JSON.parse(configText) as {
    tools: { gitleaks: { command: string[] } };
  };
  assert.equal(config.tools.gitleaks.command[0], 'git');
});

test('不正JSONはunknown fail-closedになる', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'cocolo-scanner-test-'),
  );
  try {
    const resultPath = path.join(directory, 'semgrep.json');
    await writeFile(resultPath, '{ invalid json', 'utf8');
    assert.equal(
      await summarizeScannerResult('semgrep', resultPath, 0, 'local'),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
