import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import {
  readScannerConfig,
  type ScannerName,
  scannerImageReference,
  scannerNames,
} from './security-scanner-config.ts';
import { summarizeScannerResult } from './security-scanner-summary.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  'cocolo-security-scanners',
);
const runUrl = process.env.SECURITY_RUN_URL ?? 'local';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
let activeChild: ReturnType<typeof spawn> | undefined;

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
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=512m',
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

async function runDocker(
  name: ScannerName,
  config: Awaited<ReturnType<typeof readScannerConfig>>,
): Promise<number> {
  const stdoutPath = path.join(outputRoot, `${name}.stdout`);
  const stderrPath = path.join(outputRoot, `${name}.stderr`);
  await Promise.all([
    writeFile(stdoutPath, '', { encoding: 'utf8', mode: 0o600 }),
    writeFile(stderrPath, '', { encoding: 'utf8', mode: 0o600 }),
  ]);
  const stdout = createWriteStream(stdoutPath, { mode: 0o600 });
  const stderr = createWriteStream(stderrPath, { mode: 0o600 });
  const child = spawn('docker', dockerArguments(name, config), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeChild = child;
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);

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
  await Promise.all([finished(stdout), finished(stderr)]);
  await Promise.all([chmod(stdoutPath, 0o600), chmod(stderrPath, 0o600)]);
  activeChild = undefined;
  return exitCode;
}

await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await chmod(outputRoot, 0o700);

let overallPassed = true;
try {
  const config = await readScannerConfig(root);
  for (const name of scannerNames) {
    const exitCode = await runDocker(name, config);
    const passed = await summarizeScannerResult(
      name,
      path.join(outputRoot, `${name}.json`),
      exitCode,
      runUrl,
      summaryPath,
    );
    overallPassed = overallPassed && passed;
  }
} finally {
  // 生のJSON、stdout、stderrはArtifactにもローカルにも残さない。
  await cleanupOutput();
}

if (!overallPassed) process.exitCode = 1;
