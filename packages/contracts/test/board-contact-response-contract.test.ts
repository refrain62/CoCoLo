import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardContactCopyYearResponseSchema,
  boardContactListResponseSchemaForRole,
  boardContactManagerMutationResponseSchema,
} from '../src/board-contact-response-contract.ts';

const item = {
  id: '00000000-0000-7000-8000-000000000301',
  fiscalYear: 2026,
  roleName: '会計',
  roleType: 'admin',
  contactPreference: 'both',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

test('役員responseはroleごとの公開項目を固定する', () => {
  assert.equal(
    boardContactListResponseSchemaForRole('staff').safeParse({
      data: [{ ...item, phone: '090-0000-0000' }],
      fiscalYear: 2026,
    }).success,
    false,
  );
  assert.equal(
    boardContactListResponseSchemaForRole('owner').safeParse({
      data: [{ ...item, phone: '090-0000-0000' }],
      fiscalYear: 2026,
    }).success,
    true,
  );
});

test('役員manager responseは表示設定と未知項目を検証する', () => {
  assert.equal(
    boardContactManagerMutationResponseSchema.safeParse({
      data: { ...item, phone: '090-0000-0000', tenantId: 'tenant-a' },
    }).success,
    false,
  );
  assert.equal(
    boardContactManagerMutationResponseSchema.safeParse({
      data: { ...item, contactPreference: 'line', phone: '090-0000-0000' },
    }).success,
    false,
  );
});

test('年度引き継ぎresponseは件数と年度を固定する', () => {
  assert.equal(
    boardContactCopyYearResponseSchema.safeParse({
      data: [item],
      copiedCount: 1,
      fromFiscalYear: 2026,
      toFiscalYear: 2027,
    }).success,
    true,
  );
  assert.equal(
    boardContactCopyYearResponseSchema.safeParse({
      data: [item],
      copiedCount: -1,
      fromFiscalYear: 2026,
      toFiscalYear: 2027,
    }).success,
    false,
  );
});
