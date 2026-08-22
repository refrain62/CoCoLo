import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardContactCreateSchema,
  boardContactListQuerySchema,
  boardContactPatchSchema,
  copyBoardContactYearSchema,
} from '../../../../packages/contracts/src/board-contact-contract.mjs';
import {
  copyBoardContactSlot,
  projectBoardContact,
} from '../../../../packages/domain/dist/board-contact-domain.js';

const baseContact = {
  id: '00000000-0000-7000-8000-000000000301',
  tenantId: '00000000-0000-7000-8000-000000000001',
  fiscalYear: 2026,
  roleName: '会計',
  roleType: 'admin',
  assigneeUserId: 'user-a',
  lineContact: 'https://line.example/contact-a',
  phone: '090-0000-0000',
  contactPreference: 'both',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

test('役員契約は年度・役職・連絡先表示設定を検証し、tenantIdを受け付けない', () => {
  const parsed = boardContactCreateSchema.parse({
    fiscalYear: 2026,
    roleName: ' 会計 ',
    roleType: 'admin',
    assigneeUserId: 'user-a',
    lineContact: 'https://line.example/contact-a',
    phone: '090-0000-0000',
    contactPreference: 'both',
  });

  assert.equal(parsed.roleName, '会計');
  assert.throws(() =>
    boardContactCreateSchema.parse({
      fiscalYear: 2026,
      roleName: '会計',
      roleType: 'admin',
      tenantId: 'tenant-b',
    }),
  );
  assert.throws(() =>
    boardContactCreateSchema.parse({
      fiscalYear: 2026,
      roleName: '会計',
      roleType: 'admin',
      contactPreference: 'email',
    }),
  );
});

test('一覧・更新・年度引き継ぎ契約は範囲と必須項目を検証する', () => {
  assert.deepEqual(boardContactListQuerySchema.parse({ fiscalYear: '2026' }), {
    fiscalYear: 2026,
  });
  assert.deepEqual(
    boardContactPatchSchema.parse({ contactPreference: 'phone' }),
    { contactPreference: 'phone' },
  );
  assert.deepEqual(
    copyBoardContactYearSchema.parse({ fromFiscalYear: 2026, toFiscalYear: 2027 }),
    { fromFiscalYear: 2026, toFiscalYear: 2027 },
  );
  assert.throws(() => boardContactPatchSchema.parse({}));
  assert.throws(() =>
    copyBoardContactYearSchema.parse({ fromFiscalYear: 2026, toFiscalYear: 2026 }),
  );
});

test('連絡先の公開投影は設定どおりに最小化する', () => {
  const line = projectBoardContact(
    { ...baseContact, contactPreference: 'line' },
    'owner',
  );
  assert.equal(line.lineContact, baseContact.lineContact);
  assert.equal(line.phone, undefined);

  const phone = projectBoardContact(
    { ...baseContact, contactPreference: 'phone' },
    'admin',
  );
  assert.equal(phone.phone, baseContact.phone);
  assert.equal(phone.lineContact, undefined);

  const staff = projectBoardContact(baseContact, 'staff');
  assert.equal(staff.phone, undefined);
  assert.equal(staff.lineContact, undefined);
  assert.equal(staff.assigneeUserId, undefined);
});

test('年度引き継ぎは役職枠だけを複製し、担当者と個人連絡先を落とす', () => {
  assert.deepEqual(copyBoardContactSlot(baseContact, 2027), {
    fiscalYear: 2027,
    roleName: '会計',
    roleType: 'admin',
    assigneeUserId: null,
    lineContact: null,
    phone: null,
    contactPreference: 'line',
  });
});
