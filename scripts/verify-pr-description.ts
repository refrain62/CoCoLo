import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const pullRequestSections = [
  '概要',
  '変更内容',
  '影響範囲',
  '検証',
  'レビュー観点',
  '関連',
  '残課題',
] as const;

type PullRequestSection = (typeof pullRequestSections)[number];

function sectionHeading(line: string): PullRequestSection | null {
  const match = /^## ([^#].*?)\s*$/.exec(line);
  if (!match) return null;
  const heading = match[1]?.trim();
  if (!heading) return null;
  return (pullRequestSections as readonly string[]).includes(heading)
    ? (heading as PullRequestSection)
    : null;
}

function sectionBody(lines: string[], start: number, end: number): string {
  return lines
    .slice(start + 1, end)
    .filter((line) => !/^\s*<!--(?:[\s\S]*?)-->\s*$/.test(line))
    .filter((line) => !/^\s*-\s*$/u.test(line))
    .join('\n')
    .trim();
}

export function normalizePullRequestDescription(body: string): string {
  return body
    .replace(/^\uFEFF/, '')
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trim();
}

export function validatePullRequestDescription(body: string): string[] {
  const issues: string[] = [];
  if (!body.trim()) return ['PR本文が空です。'];
  if (body.includes('\r')) issues.push('改行はLFだけを使用してください。');
  if (body.includes('\\n'))
    issues.push('文字列化された\\nではなく、実際の改行を使用してください。');
  if (/(?:^|[\r\n])[^\r\n]*[ \t]+(?:[\r\n]|$)/u.test(body))
    issues.push('行末の空白またはタブを削除してください。');

  const lines = body.split('\n');
  const headingMatches = lines
    .map((line) => ({ line }))
    .filter(({ line }) => /^#{1,6}\s+/.test(line));
  for (const { line } of headingMatches) {
    if (!/^##\s+/.test(line) && !/^###\s+/.test(line))
      issues.push(`見出しレベルが不正です: ${line}`);
  }

  const h2 = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^##\s+/.test(line));
  const headings = h2.map(({ line }) => line.replace(/^##\s+/, '').trim());
  const expected = [...pullRequestSections];
  assert.equal(expected.length, pullRequestSections.length);
  if (headings.join('\u0000') !== expected.join('\u0000'))
    issues.push(
      `H2見出しは次の順序で1回ずつ記載してください: ${expected.join(' → ')}`,
    );

  for (const required of pullRequestSections) {
    const indexes = h2
      .filter(({ line }) => sectionHeading(line) === required)
      .map(({ index }) => index);
    if (indexes.length !== 1) {
      issues.push(`${required}セクションが1回必要です。`);
      continue;
    }
    const start = indexes[0];
    if (start === undefined) continue;
    const next = h2.find(({ index }) => index > start)?.index ?? lines.length;
    if (!sectionBody(lines, start, next))
      issues.push(`${required}セクションを空にしないでください。`);
  }

  for (const { line, index } of h2) {
    if (index + 1 < lines.length && lines[index + 1] !== '')
      issues.push(`見出しの直後に空行が必要です: ${line}`);
  }
  return [...new Set(issues)];
}

export function assertPullRequestDescription(body: string): void {
  const issues = validatePullRequestDescription(body);
  assert.equal(
    issues.length,
    0,
    `PR本文のフォーマット検査に失敗しました。\n- ${issues.join('\n- ')}`,
  );
}

async function readBodyFromEvent(): Promise<string> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  assert.ok(eventPath, 'GITHUB_EVENT_PATHが必要です。');
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
    pull_request?: { body?: string | null };
  };
  return event.pull_request?.body ?? '';
}

if (process.argv[1]?.endsWith('verify-pr-description.ts')) {
  const body = await readBodyFromEvent();
  assertPullRequestDescription(body);
  console.log('PR本文のフォーマットを検証しました。');
}
