import assert from 'node:assert/strict';
import test from 'node:test';
import { findLineEndingViolations } from './line-ending-policy.ts';

test('LF改行のファイルを受け入れる', () => {
  assert.deepEqual(
    findLineEndingViolations([
      { path: 'z.ts', content: Buffer.from('const z = 1;\n') },
      { path: 'a.md', content: Buffer.from('# title\n') },
    ]),
    [],
  );
});

test('CRLFとCRだけの改行を拒否し、違反をパス順で返す', () => {
  assert.deepEqual(
    findLineEndingViolations([
      { path: 'z.ts', content: Buffer.from('const z = 1;\r\n') },
      { path: 'a.md', content: Buffer.from('# title\rbody\n') },
      { path: 'safe.txt', content: Buffer.from('safe\n') },
    ]),
    [
      { path: 'a.md', kind: 'carriage-return' },
      { path: 'z.ts', kind: 'carriage-return' },
    ],
  );
});

test('BOM、無効UTF-8、末尾LF欠落を拒否する', () => {
  assert.deepEqual(
    findLineEndingViolations([
      { path: 'bom.md', content: Buffer.from([0xef, 0xbb, 0xbf, 35, 10]) },
      { path: 'invalid.txt', content: Buffer.from([0xc3, 0x28, 10]) },
      { path: 'no-final-lf.txt', content: Buffer.from('text') },
    ]),
    [
      { path: 'bom.md', kind: 'utf8-bom' },
      { path: 'invalid.txt', kind: 'invalid-utf8' },
      { path: 'no-final-lf.txt', kind: 'missing-final-lf' },
    ],
  );
});

test('Git属性でbinaryとしたファイルの内容を改行検査から除外する', () => {
  assert.deepEqual(
    findLineEndingViolations([
      { path: 'fixture.bin', content: Buffer.from([0, 13, 10]), isText: false },
    ]),
    [],
  );
});
