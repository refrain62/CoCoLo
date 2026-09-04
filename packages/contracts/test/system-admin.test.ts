import assert from 'node:assert/strict';
import test from 'node:test';
import {
  globalAnnouncementListResponseSchema,
  systemAnnouncementCreateSchema,
  systemAnnouncementUpdateSchema,
  systemFeatureUpdateSchema,
} from '../dist/system-admin-contract.js';

test('system adminのお知らせ入力は状態・長さ・未知項目を検証する', () => {
  assert.deepEqual(
    systemAnnouncementCreateSchema.parse({
      title: '  メンテナンス  ',
      body: '  本文  ',
    }),
    { title: 'メンテナンス', body: '本文', status: 'draft' },
  );
  assert.equal(
    systemAnnouncementCreateSchema.safeParse({
      title: '告知',
      body: '本文',
      unknown: true,
    }).success,
    false,
  );
  assert.equal(systemAnnouncementUpdateSchema.safeParse({}).success, false);
});

test('利用者向け全体お知らせresponseは公開済み項目だけを受け付ける', () => {
  const result = globalAnnouncementListResponseSchema.safeParse({
    data: [
      {
        id: '0198b5a8-0000-7000-8000-000000000001',
        title: 'メンテナンス',
        body: '本文',
        status: 'published',
        publishedAt: '2026-08-27T00:00:00.000Z',
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    ],
  });
  assert.equal(result.success, true);
  assert.equal(
    globalAnnouncementListResponseSchema.safeParse({
      data: [
        {
          id: '0198b5a8-0000-7000-8000-000000000001',
          title: '下書き',
          body: '本文',
          status: 'draft',
          publishedAt: null,
          createdAt: '2026-08-26T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      ],
    }).success,
    false,
  );
});

test('system featureの提供状態変更はreasonと未知項目を必須検証する', () => {
  assert.deepEqual(
    systemFeatureUpdateSchema.parse({ enabled: false, reason: '障害対応' }),
    { enabled: false, reason: '障害対応' },
  );
  assert.equal(
    systemFeatureUpdateSchema.safeParse({ enabled: true, reason: ' ' }).success,
    false,
  );
  assert.equal(
    systemFeatureUpdateSchema.safeParse({
      enabled: true,
      reason: '運用変更',
      tenantId: 'not-accepted',
    }).success,
    false,
  );
});
