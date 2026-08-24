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
      { path: 'a.md', content: Buffer.from('# title\r') },
      { path: 'safe.txt', content: Buffer.from('safe\n') },
    ]),
    [
      { path: 'a.md', kind: 'carriage-return' },
      { path: 'z.ts', kind: 'carriage-return' },
    ],
  );
});

test('バイト列中のNULを理由にテキストを除外しない', () => {
  assert.deepEqual(
    findLineEndingViolations([
      { path: 'fixture.bin', content: Buffer.from([0, 1, 2, 10]) },
    ]),
    [],
  );
});
