import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBootstrapExtensionForChange,
  assertNoProtectedPathRename,
  type BootstrapExtension,
  hasProtectedChanges,
  isProtectedPath,
} from './verify-trusted-pr.ts';

const extension: BootstrapExtension = {
  schema: 1,
  mode: 'owner-only-one-time',
  owner: '@refrain62',
  head_sha: 'a'.repeat(40),
  files: {
    'scripts/verify-trusted-pr.ts': 'b'.repeat(64),
  },
};

test('保護対象を含まない後続PRはone-time拡張のheadに束縛しない', () => {
  assert.doesNotThrow(() =>
    assertBootstrapExtensionForChange(extension, 'c'.repeat(40), []),
  );
});

test('保護対象外PRではone-time拡張の不正なheadも検証しない', () => {
  assert.doesNotThrow(() =>
    assertBootstrapExtensionForChange(
      { ...extension, head_sha: 'invalid' },
      'c'.repeat(40),
      [],
    ),
  );
});

test('保護pathから非保護pathへのrenameを拒否する', () => {
  assert.throws(
    () =>
      assertNoProtectedPathRename(
        'apps/web/src/app.ts',
        'scripts/verify-trusted-pr.ts',
      ),
    /protected pathのrenameは拒否します/,
  );
});

test('非保護path同士のrenameは許可する', () => {
  assert.doesNotThrow(() =>
    assertNoProtectedPathRename(
      'apps/web/src/new-app.ts',
      'apps/web/src/app.ts',
    ),
  );
});

test('保護対象を含むPRはone-time拡張のheadを一致させる', () => {
  assert.throws(
    () =>
      assertBootstrapExtensionForChange(extension, 'c'.repeat(40), [
        'scripts/verify-trusted-pr.ts',
      ]),
    /Expected values to be strictly equal/,
  );
});

test('保護対象を含むPRはone-time拡張のファイル集合を一致させる', () => {
  assert.throws(
    () =>
      assertBootstrapExtensionForChange(extension, extension.head_sha, [
        'scripts/verify-trusted-pr.ts',
        'scripts/verify-trust-root.ts',
      ]),
    /bootstrap extensionはPRの全保護対象ファイルを過不足なく固定してください/,
  );
});

test('保護対象を含まない通常PRではextension検証を要求しない', () => {
  assert.equal(
    hasProtectedChanges(['apps/web/src/authenticated-app.tsx']),
    false,
  );
  assert.equal(hasProtectedChanges(['docs/resume-task-history.md']), false);
});

test('保護対象を含むPRではextension検証を有効にする', () => {
  assert.equal(hasProtectedChanges(['scripts/verify-trusted-pr.ts']), true);
  assert.equal(
    hasProtectedChanges(['.github/workflows/pr-trust-gate.yml']),
    true,
  );
  assert.equal(isProtectedPath('apps/web/src/authenticated-app.tsx'), false);
});
