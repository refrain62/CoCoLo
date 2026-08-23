import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memberListResponseSchemaForRole,
  promotionResponseSchema,
} from '../src/runtime-response-contract.ts';

const MEMBER = {
  id: '00000000-0000-7000-8000-000000000001',
  name: '部員',
  kana: null,
  category: 'student' as const,
  gradeLevel: 5,
  status: 'active' as const,
};

test('runtime responseは認証roleにない部員項目を受け付けない', () => {
  const guardian = memberListResponseSchemaForRole('guardian').safeParse({
    data: [{ ...MEMBER, ageGroup: 'secret' }],
    page: 1,
    pageSize: 50,
  });
  const manager = memberListResponseSchemaForRole('owner').safeParse({
    data: [
      { ...MEMBER, ageGroup: null, createdAt: '2026-08-23T00:00:00.000Z' },
    ],
    page: 1,
    pageSize: 50,
  });

  assert.equal(guardian.success, false);
  assert.equal(manager.success, true);
});

test('promotionの公開resultは既知の形状だけを受け付ける', () => {
  const safe = promotionResponseSchema.safeParse({
    data: {
      mode: 'preview',
      fiscalYear: 2026,
      status: 'preview',
      previewCount: 1,
      promotedCount: 0,
      result: {
        promotedCount: 1,
        changes: [
          {
            id: MEMBER.id,
            fromGradeLevel: 5,
            toGradeLevel: 6,
          },
        ],
      },
    },
  });
  const unsafe = promotionResponseSchema.safeParse({
    data: {
      mode: 'preview',
      fiscalYear: 2026,
      status: 'preview',
      previewCount: 1,
      promotedCount: 0,
      result: { secret: 'private-data' },
    },
  });

  assert.equal(safe.success, true);
  assert.equal(unsafe.success, false);
});
