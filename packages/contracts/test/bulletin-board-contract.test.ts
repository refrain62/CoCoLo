import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementCreateSchema,
  announcementListQuerySchema,
} from '../src/bulletin-board-contract.ts';

const ATTACHMENT_ID = '00000000-0000-7000-8000-000000002001';

test('回覧掲載の本文と添付IDを正規化する', () => {
  const parsed = announcementCreateSchema.parse({
    title: '  総会資料  ',
    body: '  本文\n二行目  ',
    attachmentIds: [ATTACHMENT_ID],
  });
  assert.deepEqual(parsed, {
    title: '総会資料',
    body: '本文\n二行目',
    attachmentIds: [ATTACHMENT_ID],
  });
  assert.deepEqual(
    announcementCreateSchema.parse({ title: '題名', body: '本文' }),
    {
      title: '題名',
      body: '本文',
      attachmentIds: [],
    },
  );
});

test('不正な添付IDの重複、未知項目、一覧上限を拒否する', () => {
  assert.equal(
    announcementCreateSchema.safeParse({
      title: '題名',
      body: '本文',
      attachmentIds: [ATTACHMENT_ID, ATTACHMENT_ID],
    }).success,
    false,
  );
  assert.equal(
    announcementCreateSchema.safeParse({
      title: '題名',
      body: '本文',
      authorUserId: 'user-from-body',
    }).success,
    false,
  );
  assert.equal(
    announcementListQuerySchema.safeParse({ page: '1', pageSize: '101' })
      .success,
    false,
  );
});
