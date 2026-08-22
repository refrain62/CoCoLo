import assert from 'node:assert/strict';
import test from 'node:test';
import {
  teamSelectionRequestSchema,
  teamSelectionResponseSchema,
} from '../src/auth-team-selection-contract.ts';

const TEAM_A = '00000000-0000-7000-8000-000000000001';

test('チーム選択要求はUUIDv7と未知キーを検証する', () => {
  assert.equal(
    teamSelectionRequestSchema.safeParse({ tenantId: TEAM_A }).success,
    true,
  );
  assert.equal(
    teamSelectionRequestSchema.safeParse({
      tenantId: '00000000-0000-4000-8000-000000000001',
    }).success,
    false,
  );
  assert.equal(
    teamSelectionRequestSchema.safeParse({
      tenantId: TEAM_A,
      role: 'owner',
    }).success,
    false,
  );
});

test('チーム選択応答はtenantIdと役割だけを公開する', () => {
  const result = teamSelectionResponseSchema.safeParse({
    data: { tenantId: TEAM_A, tenantName: 'Aチーム', role: 'owner' },
  });
  assert.equal(result.success, true);
  assert.equal(
    teamSelectionResponseSchema.safeParse({
      data: {
        tenantId: TEAM_A,
        tenantName: 'Aチーム',
        role: 'owner',
        userId: 'user-a',
      },
    }).success,
    false,
  );
});
