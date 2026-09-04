import assert from 'node:assert/strict';
import test from 'node:test';
import { createBulletinBoardRepositories } from '../dist/bulletin-board-repository.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ANNOUNCEMENT_ID = '00000000-0000-7000-8000-000000000002';
const NOTIFICATION_ID = '00000000-0000-7000-8000-000000000003';

function createClient({ featureEnabled = true } = {}) {
  const calls = [];
  const transaction = {
    async $queryRaw(strings, ...values) {
      const sql = strings.join('?');
      calls.push({ sql, values });
      if (sql.includes('FROM tenant_memberships'))
        return [{ role: 'owner', status: 'active' }];
      if (sql.includes('INSERT INTO announcements'))
        return [
          {
            id: ANNOUNCEMENT_ID,
            tenant_id: TENANT_ID,
            author_user_id: 'owner-a',
            title: '活動のお知らせ',
            body: '集合場所が変更されました。',
            status: 'published',
            published_at: new Date('2026-08-25T00:00:00.000Z'),
            read_at: null,
            is_author: true,
          },
        ];
      if (sql.includes('FROM line_connections'))
        return [{ group_id: 'group-a' }];
      if (sql.includes('app_enqueue_line_delivery'))
        return [{ id: NOTIFICATION_ID }];
      return [];
    },
    async $executeRaw(strings, ...values) {
      calls.push({ sql: strings.join('?'), values });
    },
  };
  return {
    calls,
    async $transaction(work) {
      return work(transaction);
    },
    featureEnabled,
  };
}

function createRepository(client) {
  let idIndex = 0;
  const ids = [ANNOUNCEMENT_ID, NOTIFICATION_ID];
  return createBulletinBoardRepositories(client, {
    attachmentLookup: async () => [],
    createId: () => ids[idIndex++],
    notificationPublicAppUrl: 'https://staging.example.test/',
    notificationFeatureEnabled: async () => client.featureEnabled,
  }).bulletinBoardRepository;
}

const publishInput = {
  tenantId: TENANT_ID,
  actorUserId: 'owner-a',
  role: 'owner',
  title: '活動のお知らせ',
  body: '集合場所が変更されました。',
  attachmentIds: [],
};

test('回覧掲載とLINE通知outbox登録を同一transactionで行う', async () => {
  const client = createClient();
  await createRepository(client).publish(publishInput);

  const enqueue = client.calls.find((call) =>
    call.sql.includes('app_enqueue_line_delivery'),
  );
  assert.ok(enqueue);
  assert.ok(enqueue.values.includes('bulletin'));
  assert.ok(enqueue.values.includes('group-a'));
  assert.ok(
    enqueue.values.includes(
      `https://staging.example.test/bulletins/${ANNOUNCEMENT_ID}`,
    ),
  );
  assert.ok(enqueue.values.includes(`bulletin:${ANNOUNCEMENT_ID}`));
});

test('line-notificationsが無効なら回覧掲載だけ成功し、通知を登録しない', async () => {
  const client = createClient({ featureEnabled: false });
  await createRepository(client).publish(publishInput);

  assert.equal(
    client.calls.some((call) => call.sql.includes('app_enqueue_line_delivery')),
    false,
  );
});
