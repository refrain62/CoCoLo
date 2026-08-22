import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTrustRootReady, assertTrustRootRecord } from './trust-root.ts';

const bootstrapped = {
  schema: 1 as const,
  status: 'bootstrapped' as const,
  owner: '@refrain62' as const,
  bootstrap_commit: 'a'.repeat(40),
};

test('owner bootstrap済みrootだけをreadyと判定する', () => {
  assert.doesNotThrow(() => assertTrustRootReady(bootstrapped));
  assert.throws(() =>
    assertTrustRootReady({
      ...bootstrapped,
      status: 'manual-owner-bootstrap-required',
      bootstrap_commit: null,
    }),
  );
});

test('bootstrap前のplaceholderと不正commitを拒否する', () => {
  assert.doesNotThrow(() =>
    assertTrustRootRecord({
      schema: 1,
      status: 'manual-owner-bootstrap-required',
      owner: '@refrain62',
      bootstrap_commit: null,
    }),
  );
  assert.throws(() =>
    assertTrustRootRecord({ ...bootstrapped, bootstrap_commit: 'short' }),
  );
});
