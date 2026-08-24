import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePullRequestDescription,
  validatePullRequestDescription,
} from './verify-pr-description.ts';

const validBody = `## 概要

目的を記載します。

## 変更内容

- 変更を記載します。

## 影響範囲

- APIへの影響はありません。

## 検証

- pnpm test: 成功

## レビュー観点

- tenant境界と入力検証を確認しました。

## 関連

- なし

## 残課題

- なし`;

test('共通7区画のPR本文を受け入れる', () => {
  assert.deepEqual(validatePullRequestDescription(validBody), []);
});

test('見出しの欠落・順序違反・空区画を拒否する', () => {
  const body = validBody.replace(
    '## 影響範囲\n\n- APIへの影響はありません。',
    '## 検証\n\n',
  );
  const issues = validatePullRequestDescription(body);
  assert.ok(issues.some((issue) => issue.includes('H2見出し')));
  assert.ok(issues.some((issue) => issue.includes('影響範囲セクション')));
});

test('文字列化された改行、CR、行末空白を拒否する', () => {
  const body = validBody.replace(
    '目的を記載します。',
    '目的\\nを記載します。 \r',
  );
  const issues = validatePullRequestDescription(body);
  assert.ok(issues.some((issue) => issue.includes('LF')));
  assert.ok(issues.some((issue) => issue.includes('文字列化')));
  assert.ok(issues.some((issue) => issue.includes('行末')));
});

test('正規化はBOM、改行、行末空白を修正する', () => {
  assert.equal(
    normalizePullRequestDescription('\uFEFF## 概要\\n\\n本文  \r\n'),
    '## 概要\n\n本文',
  );
});

test('H1と未知のH2見出しを拒否する', () => {
  const body = validBody
    .replace('## 概要', '# 概要')
    .replace('## 関連', '## 補足');
  const issues = validatePullRequestDescription(body);
  assert.ok(issues.some((issue) => issue.includes('見出しレベル')));
  assert.ok(issues.some((issue) => issue.includes('H2見出し')));
});

test('テンプレートの未記入プレースホルダーを拒否する', () => {
  const body = validBody.replace('- APIへの影響はありません。', '-');
  const issues = validatePullRequestDescription(body);
  assert.ok(issues.some((issue) => issue.includes('影響範囲セクション')));
});
