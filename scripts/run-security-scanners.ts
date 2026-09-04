import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { securityScanRoot } from './security-scan-root.ts';
import {
  readScannerConfig,
  type ScannerName,
  scannerImageReference,
  scannerNames,
} from './security-scanner-config.ts';
import { readScannerExceptions } from './security-scanner-exceptions.ts';
import { summarizeScannerResult } from './security-scanner-summary.ts';

const root = securityScanRoot(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const outputRoot = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  `cocolo-security-scanners-${process.pid}`,
);
const runUrl = process.env.SECURITY_RUN_URL ?? 'local';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
let activeChild: ReturnType<typeof spawn> | undefined;
const maxOutputBytes = 20 * 1024 * 1024;
const scannerTimeoutMs = 5 * 60 * 1000;
const dockerResourceArguments = [
  '--cpus=2',
  '--memory=2g',
  '--pids-limit=256',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges',
  '--read-only',
  '--tmpfs',
  '/tmp:rw,noexec,nosuid,size=512m',
];

async function cleanupOutput(): Promise<void> {
  await rm(outputRoot, { recursive: true, force: true });
}

const handleSignal = (exitCode: number) => {
  activeChild?.kill();
  void cleanupOutput().finally(() => process.exit(exitCode));
};

process.once('SIGINT', () => handleSignal(130));
process.once('SIGTERM', () => handleSignal(143));

function dockerArguments(
  name: ScannerName,
  config: Awaited<ReturnType<typeof readScannerConfig>>,
): string[] {
  const tool = config.tools[name];
  const outputPath = `/out/${name}.json`;
  const command = tool.command.map((argument) =>
    argument === '__OUTPUT__' ? outputPath : argument,
  );
  return [
    'run',
    '--rm',
    '--network',
    tool.network,
    ...dockerResourceArguments,
    '--mount',
    `type=bind,source=${root},target=/src,readonly`,
    '--mount',
    `type=bind,source=${outputRoot},target=/out`,
    ...Object.entries(tool.environment).flatMap(([key, value]) => [
      '--env',
      `${key}=${value}`,
    ]),
    scannerImageReference(tool),
    ...command,
  ];
}

function trivyDatabaseArguments(
  config: Awaited<ReturnType<typeof readScannerConfig>>,
): string[] {
  const tool = config.tools.trivy;
  return [
    'run',
    '--rm',
    '--network',
    'bridge',
    ...dockerResourceArguments,
    '--mount',
    `type=bind,source=${path.join(outputRoot, 'trivy-cache')},target=/out/trivy-cache`,
    ...Object.entries(tool.environment).flatMap(([key, value]) => [
      '--env',
      `${key}=${value}`,
    ]),
    scannerImageReference(tool),
    'image',
    '--download-db-only',
    '--cache-dir',
    '/out/trivy-cache',
    '--quiet',
  ];
}

function limitedOutput(onLimit: () => void): {
  stream: Transform;
  exceeded: () => boolean;
} {
  let bytes = 0;
  let didExceed = false;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        didExceed = true;
        onLimit();
        callback(new Error('scanner output limit exceeded'));
        return;
      }
      callback(null, chunk);
    },
  });
  return { stream, exceeded: () => didExceed };
}

async function runContainer(
  label: string,
  arguments_: string[],
): Promise<number> {
  const stdoutPath = path.join(outputRoot, `${label}.stdout`);
  const stderrPath = path.join(outputRoot, `${label}.stderr`);
  await Promise.all([
    writeFile(stdoutPath, '', { encoding: 'utf8', mode: 0o600 }),
    writeFile(stderrPath, '', { encoding: 'utf8', mode: 0o600 }),
  ]);
  const stdout = createWriteStream(stdoutPath, { mode: 0o600 });
  const stderr = createWriteStream(stderrPath, { mode: 0o600 });
  const child = spawn('docker', arguments_, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeChild = child;
  const stdoutLimit = limitedOutput(() => child.kill('SIGKILL'));
  const stderrLimit = limitedOutput(() => child.kill('SIGKILL'));
  stdoutLimit.stream.on('error', () => stdout.destroy());
  stderrLimit.stream.on('error', () => stderr.destroy());
  child.stdout.pipe(stdoutLimit.stream).pipe(stdout);
  child.stderr.pipe(stderrLimit.stream).pipe(stderr);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, scannerTimeoutMs);
  const exitCode = await new Promise<number>((resolve) => {
    let settled = false;
    const finishWith = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.once('error', () => finishWith(127));
    child.once('close', (code) => finishWith(code ?? 127));
  });
  clearTimeout(timeout);
  await Promise.all([
    finished(stdout).catch(() => undefined),
    finished(stderr).catch(() => undefined),
  ]);
  await Promise.all([chmod(stdoutPath, 0o600), chmod(stderrPath, 0o600)]);
  activeChild = undefined;
  return timedOut || stdoutLimit.exceeded() || stderrLimit.exceeded()
    ? 124
    : exitCode;
}

async function prepareTrivyDatabase(
  config: Awaited<ReturnType<typeof readScannerConfig>>,
): Promise<void> {
  const exitCode = await runContainer(
    'trivy-db',
    trivyDatabaseArguments(config),
  );
  if (exitCode !== 0)
    throw new Error(
      `Trivy vulnerability database preparation failed: ${exitCode}`,
    );
}

await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await chmod(outputRoot, 0o700);
await mkdir(path.join(outputRoot, 'trivy-cache'), {
  recursive: true,
  mode: 0o700,
});

let overallPassed = true;
try {
  const config = await readScannerConfig(root);
  const exceptions = await readScannerExceptions(root);
  await prepareTrivyDatabase(config);
  for (const name of scannerNames) {
    const exitCode = await runContainer(name, dockerArguments(name, config));
    const passed = await summarizeScannerResult(
      name,
      path.join(outputRoot, `${name}.json`),
      exitCode,
      runUrl,
      summaryPath,
      exceptions,
    );
    overallPassed = overallPassed && passed;
  }
} finally {
  // 生のJSON、stdout、stderrはArtifactにもローカルにも残さない。
  await cleanupOutput();
}

if (!overallPassed) process.exitCode = 1;
