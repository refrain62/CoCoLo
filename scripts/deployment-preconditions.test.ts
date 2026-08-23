import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStagingEvidence } from './deployment-preconditions.ts';

const sha = 'a'.repeat(40);
const artifactSha256 = 'b'.repeat(64);
const migrationChecksumSha256 = 'c'.repeat(64);
const cleanEvidence = {
  workflowName: 'ステージングへデプロイ',
  workflowPath: '.github/workflows/staging-deploy.yml',
  event: 'push',
  headBranch: 'main',
  headSha: sha,
  artifactSha: sha,
  artifactSha256,
  migrationChecksumSha256,
  migration: 'success',
  smoke: 'success',
  e2e: 'success',
};

test('staging証跡は同一SHA・checksumと全successだけを受理する', () => {
  assert.deepEqual(
    assertStagingEvidence(
      cleanEvidence,
      sha,
      artifactSha256,
      migrationChecksumSha256,
    ),
    cleanEvidence,
  );
});

for (const [label, change, message] of [
  ['SHA不一致', { headSha: 'd'.repeat(40) }, /head SHA/],
  [
    'artifact checksum不一致',
    { artifactSha256: 'd'.repeat(64) },
    /artifact checksum/,
  ],
  [
    'migration checksum不一致',
    { migrationChecksumSha256: 'd'.repeat(64) },
    /migration checksum/,
  ],
  ['migration未成功', { migration: 'failure' }, /migration/],
  ['smoke未成功', { smoke: 'failure' }, /smoke/],
  ['E2E未成功', { e2e: 'failure' }, /e2e/],
] as const) {
  test(`悪性fixture: ${label}を拒否する`, () => {
    assert.throws(
      () =>
        assertStagingEvidence(
          { ...cleanEvidence, ...change },
          sha,
          artifactSha256,
          migrationChecksumSha256,
        ),
      message,
    );
  });
}
