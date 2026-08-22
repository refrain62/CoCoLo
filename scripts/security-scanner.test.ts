import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { securityScanRoot } from './security-scan-root.ts';
import {
  readScannerConfig,
  scannerImageAllowlist,
  scannerRuleAllowlist,
  validateScannerConfig,
} from './security-scanner-config.ts';
import { summarizeScannerResult } from './security-scanner-summary.ts';
import {
  assertTrustedFileHashes,
  trustedScannerFiles,
} from './verify-security-trust.ts';

const root = securityScanRoot(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);

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

test('Gitleaksはgitなしの隔離headディレクトリを検査する固定コマンドになっている', async () => {
  const configText = await readFile(
    path.join(root, '.github', 'security', 'security-scanners.json'),
    'utf8',
  );
  const config = JSON.parse(configText) as {
    tools: { gitleaks: { command: string[] } };
  };
  assert.equal(config.tools.gitleaks.command[0], 'dir');
  assert.equal(config.tools.gitleaks.command.at(-1), '/src');
  assert.ok(!config.tools.gitleaks.command.includes('git'));
});

test('scannerのcommand、network、ルール本文は固定allowlistと一致する', async () => {
  const config = await readScannerConfig(root);
  for (const name of ['gitleaks', 'semgrep', 'trivy'] as const) {
    assert.equal(
      await readFile(path.join(root, config.tools[name].ruleFile), 'utf8'),
      scannerRuleAllowlist[name],
    );
  }

  const tamperedCommand = structuredClone(config) as typeof config;
  tamperedCommand.tools.semgrep.command = ['semgrep', 'scan'];
  assert.throws(() => validateScannerConfig(tamperedCommand));

  const tamperedNetwork = structuredClone(config) as typeof config;
  tamperedNetwork.tools.trivy.network = 'none';
  assert.throws(() => validateScannerConfig(tamperedNetwork));

  const tamperedRule = structuredClone(config) as typeof config;
  tamperedRule.tools.gitleaks.ruleFile = '.semgrep/ci.yml';
  assert.throws(() => validateScannerConfig(tamperedRule));
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

test('SemgrepとTrivyのreport schemaは不正時にfail-closedになる', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'cocolo-scanner-schema-test-'),
  );
  try {
    const semgrepPath = path.join(directory, 'semgrep.json');
    const trivyPath = path.join(directory, 'trivy.json');
    await writeFile(
      semgrepPath,
      JSON.stringify({ results: [{}], errors: [] }),
      'utf8',
    );
    await writeFile(
      trivyPath,
      JSON.stringify({ Results: [{ Target: 'src', Class: 'lang-pkgs' }] }),
      'utf8',
    );
    assert.equal(
      await summarizeScannerResult('semgrep', semgrepPath, 0, 'local'),
      false,
    );
    assert.equal(
      await summarizeScannerResult('trivy', trivyPath, 0, 'local'),
      false,
    );

    await writeFile(
      semgrepPath,
      JSON.stringify({
        results: [],
        errors: [],
      }),
      'utf8',
    );
    await writeFile(
      trivyPath,
      JSON.stringify({
        Results: [
          {
            Target: 'src',
            Class: 'lang-pkgs',
            Type: 'npm',
            Vulnerabilities: [
              { VulnerabilityID: 'CVE-test', Severity: 'HIGH' },
            ],
          },
        ],
      }),
      'utf8',
    );
    assert.equal(
      await summarizeScannerResult('semgrep', semgrepPath, 0, 'local'),
      true,
    );
    assert.equal(
      await summarizeScannerResult('trivy', trivyPath, 1, 'local'),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scanner exceptionはrule ID一致時だけ実行結果から除外される', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'cocolo-scanner-exception-test-'),
  );
  try {
    const semgrepPath = path.join(directory, 'semgrep.json');
    await writeFile(
      semgrepPath,
      JSON.stringify({
        results: [
          {
            check_id: 'cocolo-approved-rule',
            path: 'src/example.ts',
            start: { line: 1, col: 1 },
            end: { line: 1, col: 2 },
            extra: { severity: 'ERROR' },
          },
        ],
        errors: [],
      }),
      'utf8',
    );
    const exception = {
      id: 'SEC-TEST-1',
      tool: 'semgrep' as const,
      ruleId: 'cocolo-approved-rule',
      severity: 'HIGH',
      owner: '@refrain62',
      rationale: 'fixture',
      mitigation: 'fixture',
      issue: 'https://github.com/refrain62/CoCoLo/issues/999',
      expires: '2099-12-31',
    };
    assert.equal(
      await summarizeScannerResult(
        'semgrep',
        semgrepPath,
        1,
        'local',
        undefined,
        [exception],
      ),
      true,
    );
    assert.equal(
      await summarizeScannerResult('semgrep', semgrepPath, 1, 'local'),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('固定malicious fixtureのscanner信頼対象改変を拒否する', async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(
        root,
        '.github',
        'security',
        'fixtures',
        'malicious-scanner-pr.json',
      ),
      'utf8',
    ),
  ) as {
    tamperedFile: string;
    scannerRegression: {
      tool: string;
      mode: string;
      requiresGitDirectory: boolean;
    };
    changedFiles: string[];
    disableAttempts: string[];
  };
  assert.deepEqual(fixture.scannerRegression, {
    tool: 'gitleaks',
    mode: 'directory',
    requiresGitDirectory: false,
  });
  assert.deepEqual(fixture.changedFiles, [...trustedScannerFiles]);
  assert.ok(
    fixture.disableAttempts.includes('.github/workflows/security-scanners.yml'),
  );
  assert.ok(
    fixture.disableAttempts.includes('scripts/verify-security-trust.ts'),
  );
  const baseHashes = Object.fromEntries(
    trustedScannerFiles.map((file) => [file, 'a'.repeat(64)]),
  );
  const headHashes = { ...baseHashes, [fixture.tamperedFile]: 'b'.repeat(64) };
  assert.throws(
    () =>
      assertTrustedFileHashes(
        'a'.repeat(40),
        'b'.repeat(40),
        baseHashes,
        headHashes,
      ),
    /改変されています/,
  );
  for (const file of fixture.disableAttempts) {
    const maliciousHeadHashes = {
      ...baseHashes,
      [file]: 'b'.repeat(64),
    };
    assert.throws(
      () =>
        assertTrustedFileHashes(
          'a'.repeat(40),
          'b'.repeat(40),
          baseHashes,
          maliciousHeadHashes,
        ),
      /改変されています/,
      `trust無効化の改変を検出できません: ${file}`,
    );
  }
  const missingHashes = { ...baseHashes };
  delete missingHashes[fixture.tamperedFile];
  assert.throws(
    () =>
      assertTrustedFileHashes(
        'a'.repeat(40),
        'b'.repeat(40),
        baseHashes,
        missingHashes,
      ),
    /hashが欠落しています/,
  );
});
