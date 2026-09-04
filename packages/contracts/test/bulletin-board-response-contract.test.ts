import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementListResponseSchema,
  announcementReadResponseSchema,
  announcementResponseEnvelopeSchema,
  announcementUnreadResponseSchema,
} from '../src/bulletin-board-response-contract.ts';

const announcement = {
  id: '00000000-0000-4000-8000-000000000101',
  title: '総会資料',
  status: 'published' as const,
  publishedAt: '2026-08-24T00:00:00.000Z',
  attachmentCount: 1,
  readAt: null,
  isRead: false,
  isAuthor: false,
};

test('回覧板一覧と詳細responseは公開項目を固定する', () => {
  assert.equal(
    announcementListResponseSchema.safeParse({
      data: [announcement],
      page: 1,
      pageSize: 50,
      hasNext: false,
    }).success,
    true,
  );
  assert.equal(
    announcementResponseEnvelopeSchema.safeParse({
      data: {
        ...announcement,
        body: '本文',
        attachments: [
          {
            id: '00000000-0000-4000-8000-000000000102',
            mediaType: 'application/pdf',
            byteSize: 1024,
          },
        ],
        canViewUnread: false,
        tenantId: 'tenant-a',
      },
    }).success,
    false,
  );
});

test('回覧板read responseは日時だけを返す', () => {
  assert.equal(
    announcementReadResponseSchema.safeParse({
      data: { readAt: '2026-08-24T00:00:00.000Z' },
    }).success,
    true,
  );
  assert.equal(
    announcementReadResponseSchema.safeParse({
      data: {
        readAt: '2026-08-24T00:00:00.000Z',
        email: 'hidden@example.test',
      },
    }).success,
    false,
  );
});

test('回覧板未読者responseはuserIdとroleだけを許可する', () => {
  assert.equal(
    announcementUnreadResponseSchema.safeParse({
      data: [{ userId: 'guardian-a', role: 'guardian' }],
      unreadCount: 1,
    }).success,
    true,
  );
  assert.equal(
    announcementUnreadResponseSchema.safeParse({
      data: [
        {
          userId: 'guardian-a',
          role: 'guardian',
          email: 'hidden@example.test',
        },
      ],
      unreadCount: 1,
    }).success,
    false,
  );
  assert.equal(
    announcementUnreadResponseSchema.safeParse({
      data: [{ userId: 'guardian-a', role: 'guardian' }],
      unreadCount: 2,
    }).success,
    false,
  );
});
