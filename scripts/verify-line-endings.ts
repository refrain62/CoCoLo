import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findLineEndingViolations,
  type LineEndingFile,
} from './line-ending-policy.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = process.platform === 'win32' ? 'git.exe' : 'git';
const diffWhitespace = 'blank-at-eol,blank-at-eof,space-before-tab';
type EolEntry = Readonly<{
  path: string;
  isText: boolean;
}>;

function runGit(
  args: string[],
  encoding: 'utf8' | 'buffer' = 'utf8',
): string | Buffer {
  return execFileSync(git, args, {
    cwd: root,
    encoding,
    stdio: 'pipe',
  });
}

function readTrackedEntries(): EolEntry[] {
  const output = runGit(['ls-files', '--eol', '-z'], 'buffer') as Buffer;
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const metadata = entry.slice(0, tab);
      const filePath = entry.slice(tab + 1);
      const fields = metadata.split(/\s+/u);
      return {
        path: filePath,
        isText:
          fields[0] !== 'i/none' &&
          fields[1] !== 'w/none' &&
          fields[2] !== 'attr/-text',
      };
    });
}

function readUntrackedCount(): number {
  const output = runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    'buffer',
  ) as Buffer;
  return output.toString('utf8').split('\0').filter(Boolean).length;
}

function readConfig(name: string): string {
  try {
    return (runGit(['config', '--get', name]) as string).trim() || '(unset)';
  } catch {
    return '(unset)';
  }
}

function checkGitDiff(label: string, args: string[]): void {
  try {
    runGit([
      '-c',
      `core.whitespace=${diffWhitespace}`,
      'diff',
      '--check',
      ...args,
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff --check（${label}）に失敗しました。\n${detail}`);
  }
}

function pullRequestDiff(): { label: string; args: string[] } | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: {
      base?: { sha?: string };
      head?: { sha?: string };
    };
  };
  const baseSha = event.pull_request?.base?.sha;
  const headSha = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA;
  if (!baseSha || !headSha) return undefined;
  return {
    label: `${baseSha}...${headSha}`,
    args: [`${baseSha}...${headSha}`, '--'],
  };
}

function readHeadBlob(filePath: string): Buffer {
  return runGit(['cat-file', 'blob', `HEAD:${filePath}`], 'buffer') as Buffer;
}

async function readFiles(
  entries: readonly EolEntry[],
  source: 'head' | 'worktree',
): Promise<LineEndingFile[]> {
  return Promise.all(
    entries.map(async ({ path: filePath, isText }) => ({
      path: filePath,
      isText,
      content:
        source === 'head'
          ? readHeadBlob(filePath)
          : await readFileAsync(path.join(root, filePath)),
    })),
  );
}

const entries = readTrackedEntries();
const source = process.env.GITHUB_ACTIONS === 'true' ? 'head' : 'worktree';
const files = await readFiles(entries, source);
const violations = findLineEndingViolations(files);
if (violations.length > 0) {
  throw new Error(
    `テキスト追跡対象ファイルに改行ポリシー違反が${violations.length}件あります。BOMなしUTF-8、CRなし、空でないファイルの末尾LFを守ってください。\n${violations
      .map(({ path: filePath, kind }) => `- ${filePath}: ${kind}`)
      .join('\n')}`,
  );
}

const range = pullRequestDiff();
if (range) {
  checkGitDiff(`PR ${range.label}`, range.args);
} else {
  checkGitDiff('unstaged', ['--']);
  checkGitDiff('staged', ['--cached', '--']);
}

const commit = (runGit(['rev-parse', 'HEAD']) as string).trim();
const textFiles = entries.filter(({ isText }) => isText).length;
console.log(
  JSON.stringify(
    {
      policy:
        'tracked text files are UTF-8 without BOM, LF-only, and end with LF unless empty',
      source,
      commit,
      diffCheck: range?.label ?? 'unstaged and staged',
      trackedFiles: entries.length,
      textFiles,
      binaryFiles: entries.length - textFiles,
      untrackedFilesExcluded: readUntrackedCount(),
      violations: {
        carriageReturn: 0,
        utf8Bom: 0,
        invalidUtf8: 0,
        missingFinalLf: 0,
      },
      git: {
        version: (runGit(['--version']) as string).trim(),
        coreAutocrlf: readConfig('core.autocrlf'),
        coreWhitespace: readConfig('core.whitespace'),
      },
    },
    null,
    2,
  ),
);
