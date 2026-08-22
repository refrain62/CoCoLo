import assert from 'node:assert/strict';
import test from 'node:test';
import { memberIdSchema, memberUpdateSchema } from '../src/member-contract.ts';

test('部員編集契約は区分と学年・年代の組み合わせを検証する', () => {
  const parsed = memberUpdateSchema.parse({
    name: '編集後の部員',
    kana: null,
    category: 'student',
    gradeLevel: 10,
    ageGroup: null,
    status: 'suspended',
  });

  assert.equal(parsed.name, '編集後の部員');
  assert.equal(parsed.status, 'suspended');
  assert.throws(() =>
    memberUpdateSchema.parse({
      name: '不正な部員',
      category: 'adult',
      gradeLevel: 1,
      ageGroup: '30代',
      status: 'active',
    }),
  );
});

test('部員ID契約はUUID以外を拒否する', () => {
  assert.equal(
    memberIdSchema.parse('00000000-0000-7000-8000-000000000001'),
    '00000000-0000-7000-8000-000000000001',
  );
  assert.throws(() => memberIdSchema.parse('member-1'));
});
