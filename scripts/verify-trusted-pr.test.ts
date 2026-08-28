import assert from 'node:assert/strict';
import test from 'node:test';
import { hasProtectedChanges, isProtectedPath } from './verify-trusted-pr.ts';

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
