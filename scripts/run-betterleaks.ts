import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const mode = process.argv[2] ?? 'history';
const target = process.argv[3] ?? root;
const betterleaksImage =
  'ghcr.io/betterleaks/betterleaks:v1.7.2@sha256:1eb5e0920b47afe43f76671bc678c9fd4fd40c2d0c9b88a16f28021fd12d2347';
const dockerUser =
  typeof process.getuid === 'function' && typeof process.getgid === 'function'
    ? `${process.getuid()}:${process.getgid()}`
    : undefined;
const config = `title = "CoCoLo Betterleaks 秘密情報検査"
betterleaksMinVersion = "1.7.2"

# 検証用のSHA-256 manifestは秘密情報ではないため、秘密検査から除外する。
prefilter = '''
filter.matchesAny(attributes["path"], [
  \`(^|/)(?:node_modules|dist|coverage|test-results|playwright-report|\\.git)(?:/|$)\`,
  \`(^|/)(?:\\.github/security/trusted-file-manifest\\.json|packages/db/prisma/migrations\\.sha256)$\`
])
'''

[[rules]]
id = "cocolo-password-hash"
description = "Password hashes must not be committed."
regex = '''(?i)(?:password|passwd|password_hash|passwordHash)\\s*[:=]\\s*["']?(?:\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}|argon2(?:id|i|d)\\$[^\\s"']+|SCRAM-SHA-256\\$[^\\s"']+)'''
keywords = ["password", "passwd", "password_hash", "passwordHash", "$2", "argon2", "SCRAM-SHA-256"]
confidence = "high"
`;

if (!['history', 'staged', 'dir'].includes(mode))
  throw new Error(
    'Betterleaksの検査モードはhistory、staged、dirのいずれかです。',
  );

const temporaryDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'cocolo-betterleaks-'),
);
const configPath = path.join(temporaryDirectory, 'betterleaks.toml');
const reportPath = path.join(temporaryDirectory, 'report.json');
writeFileSync(configPath, config, { encoding: 'utf8', mode: 0o600 });
chmodSync(configPath, 0o600);

const scanArguments = [
  mode === 'dir' ? 'dir' : 'git',
  mode === 'dir' ? target : root,
  '--config',
  configPath,
  '--redact',
  '--no-banner',
  '--report-format',
  'json',
  '--report-path',
  reportPath,
  '--exit-code',
  '1',
];
if (mode === 'staged') scanArguments.splice(2, 0, '--pre-commit', '--staged');

function run(command: string, args: string[], cwd = root) {
  return spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
}

try {
  const image = process.env.BETTERLEAKS_IMAGE;
  const result = image
    ? image === betterleaksImage
      ? run('docker', [
          'run',
          '--rm',
          '--network',
          'none',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--read-only',
          '--tmpfs',
          '/tmp:rw,noexec,nosuid,size=256m',
          ...(dockerUser ? ['--user', dockerUser] : []),
          '--mount',
          `type=bind,source=${root},target=/src,readonly`,
          '--mount',
          `type=bind,source=${temporaryDirectory},target=/out`,
          image,
          mode === 'dir' ? 'dir' : 'git',
          '/src',
          '--config',
          '/out/betterleaks.toml',
          '--redact',
          '--no-banner',
          '--report-format',
          'json',
          '--report-path',
          '/out/report.json',
          '--exit-code',
          '1',
          ...(mode === 'staged' ? ['--pre-commit', '--staged'] : []),
        ])
      : (() => {
          throw new Error(
            'BetterleaksのCI image参照が許可リストと一致しません。',
          );
        })()
    : run('betterleaks', scanArguments);

  if (result.error && 'code' in result.error && result.error.code === 'ENOENT')
    throw new Error(
      'Betterleaksが見つかりません。`mise install` 後に再実行してください。',
    );
  if (result.status === null)
    throw result.error ?? new Error('Betterleaksの実行に失敗しました。');
  process.exitCode = result.status ?? 1;
} finally {
  // レポートには検出情報が含まれるため、成功・失敗にかかわらず保存しない。
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
