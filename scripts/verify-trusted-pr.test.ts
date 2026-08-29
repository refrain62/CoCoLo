import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBootstrapExtensionForChange,
  assertNoProtectedPathRename,
  assertProtectedPathStatus,
  type BootstrapExtension,
  hasProtectedChanges,
  isOwnerOnlyExtensionRegistration,
  isOwnerOnlyExtensionRegistrationCandidate,
  isProtectedPath,
  type PullRequestMetadata,
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

const ownerOnlyRegistration: PullRequestMetadata = {
  user: { login: 'refrain62' },
  head: { repo: { full_name: 'refrain62/CoCoLo' } },
};
const ownerOnlyRegistrationFiles = [
  {
    filename: '.github/security/bootstrap-extension.json',
    status: 'modified',
  },
  {
    filename: '.github/security/trusted-file-manifest.json',
    status: 'modified',
  },
] as const;

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

test('extension対象の削除を拒否する', () => {
  assert.throws(
    () =>
      assertProtectedPathStatus(
        'scripts/verify-trusted-pr.ts',
        'removed',
        true,
      ),
    /extension対象の追加・削除状態が不正です/,
  );
});

test('manifest対象の削除を拒否する', () => {
  assert.throws(
    () =>
      assertProtectedPathStatus(
        'scripts/verify-trust-root.ts',
        'removed',
        false,
      ),
    /追加・削除はfail-closedで拒否します/,
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

test('owner-only登録はownerと同一repositoryの2ファイル変更だけを許可する', () => {
  assert.equal(
    isOwnerOnlyExtensionRegistrationCandidate(ownerOnlyRegistrationFiles),
    true,
  );
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      ownerOnlyRegistration,
      'refrain62/CoCoLo',
      ownerOnlyRegistrationFiles,
    ),
    true,
  );
});

test('owner-only登録はowner、repository、変更集合の不一致を拒否する', () => {
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      { ...ownerOnlyRegistration, user: { login: 'other' } },
      'refrain62/CoCoLo',
      ownerOnlyRegistrationFiles,
    ),
    false,
  );
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      ownerOnlyRegistration,
      'other/CoCoLo',
      ownerOnlyRegistrationFiles,
    ),
    false,
  );
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      ownerOnlyRegistration,
      'refrain62/CoCoLo',
      [...ownerOnlyRegistrationFiles, { filename: 'scripts/extra.ts' }],
    ),
    false,
  );
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      ownerOnlyRegistration,
      'refrain62/CoCoLo',
      ownerOnlyRegistrationFiles.map((file) => ({ ...file, status: 'added' })),
    ),
    false,
  );
  assert.equal(
    isOwnerOnlyExtensionRegistration(
      ownerOnlyRegistration,
      'refrain62/CoCoLo',
      ownerOnlyRegistrationFiles.map((file) => ({
        ...file,
        previous_filename: file.filename,
      })),
    ),
    false,
  );
});
