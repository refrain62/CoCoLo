import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const shaPattern = /^[0-9a-f]{40}$/;
const pullRequestNumberPattern = /^[1-9][0-9]*$/;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}が未設定です。`);
  return value;
}

function assertSha(value: string, name: string): void {
  if (!shaPattern.test(value))
    throw new Error(`${name}は40桁の小文字hex SHAで指定してください。`);
}

function fetchHead(headSha: string): void {
  try {
    execFileSync('git', ['cat-file', '-e', `${headSha}^{commit}`]);
    return;
  } catch {
    // base checkoutにhead objectがない場合だけ、PR refまたはSHAを取得する。
  }
  const token = requiredEnvironment('GITHUB_TOKEN');
  const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  const fetchArguments = [
    '-c',
    `http.extraheader=${authHeader}`,
    'fetch',
    '--no-tags',
    '--depth=1',
    'origin',
  ];
  if (process.env.GITHUB_EVENT_NAME === 'pull_request_target') {
    const number = requiredEnvironment('TRUST_PR_NUMBER');
    if (!pullRequestNumberPattern.test(number))
      throw new Error('pull_request_targetの番号が不正です。');
    execFileSync('git', [...fetchArguments, `refs/pull/${number}/head`]);
  } else {
    execFileSync('git', [...fetchArguments, headSha]);
  }

  const fetchedSha = execFileSync('git', ['rev-parse', 'FETCH_HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (fetchedSha !== headSha)
    throw new Error(`取得したhead SHAが一致しません: ${fetchedSha}`);
}

const baseSha = requiredEnvironment('TRUST_BASE_SHA');
const headSha = requiredEnvironment('TRUST_HEAD_SHA');
const targetRoot = path.resolve(requiredEnvironment('SECURITY_TARGET_ROOT'));
assertSha(baseSha, 'base SHA');
assertSha(headSha, 'head SHA');
if (targetRoot === path.resolve(process.cwd()))
  throw new Error('head対象をbase checkoutへ展開できません。');

fetchHead(headSha);
await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true, mode: 0o700 });
execFileSync('git', [
  'archive',
  '--format=tar',
  headSha,
  '-o',
  `${targetRoot}.tar`,
]);
try {
  execFileSync('tar', ['-xf', `${targetRoot}.tar`, '-C', targetRoot]);
} finally {
  await rm(`${targetRoot}.tar`, { force: true });
}

console.log(`security target prepared: base=${baseSha} head=${headSha}`);
