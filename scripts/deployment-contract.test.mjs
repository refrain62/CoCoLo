import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeploymentRecord } from './deployment-contract.mjs';

const validRecord = {
  status: 'success',
  artifactSha: 'a'.repeat(40),
  environment: 'staging',
  deployedUrl: 'https://staging.example.test',
  deployedAt: '2026-08-22T00:00:00.000Z',
};

test('配置記録は成果物のSHA・環境・URLを満たす場合だけ受理する', () => {
  assert.deepEqual(
    assertDeploymentRecord(validRecord, {
      artifactSha: validRecord.artifactSha,
      environment: 'staging',
    }),
    validRecord,
  );
});

test('配置記録の成果物のSHA不一致を拒否する', () => {
  assert.throws(
    () =>
      assertDeploymentRecord(validRecord, {
        artifactSha: 'b'.repeat(40),
        environment: 'staging',
      }),
    /配置済み成果物の SHA が一致しません。/,
  );
});

test('配置記録の環境不一致を拒否する', () => {
  assert.throws(
    () =>
      assertDeploymentRecord(validRecord, {
        artifactSha: validRecord.artifactSha,
        environment: 'production',
      }),
    /配置環境が一致しません/,
  );
});

test('未完了の配置記録を拒否する', () => {
  assert.throws(
    () =>
      assertDeploymentRecord(
        { ...validRecord, status: 'pending' },
        { artifactSha: validRecord.artifactSha, environment: 'staging' },
      ),
    /配置記録の status が success ではありません。/,
  );
});
