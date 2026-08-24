import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findLineEndingViolations,
  type LineEndingFile,
} from './line-ending-policy.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = process.platform === 'win32' ? 'git.exe' : 'git';

function readTrackedPaths(): string[] {
  const output = execFileSync(git, ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
  });
  return output
    .toString('utf8')
    .split('\0')
    .filter((filePath) => filePath.length > 0);
}

function checkGitDiff(label: string, args: string[]): void {
  try {
    execFileSync(git, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff --check（${label}）に失敗しました。\n${detail}`);
  }
}

const trackedPaths = readTrackedPaths();
const files: LineEndingFile[] = await Promise.all(
  trackedPaths.map(async (filePath) => ({
    path: filePath,
    content: await readFile(path.join(root, filePath)),
  })),
);
const violations = findLineEndingViolations(files);
if (violations.length > 0) {
  throw new Error(
    `追跡対象ファイルにCR改行が${violations.length}件あります。LFへ変換してください。\n${violations
      .map(({ path: filePath }) => `- ${filePath}`)
      .join('\n')}`,
  );
}

checkGitDiff('unstaged', ['diff', '--check', '--']);
checkGitDiff('staged', ['diff', '--cached', '--check', '--']);
console.log(
  `改行検査に成功しました。追跡対象${trackedPaths.length}ファイル、CR改行0件、git diff --check（unstaged/staged）成功。`,
);
