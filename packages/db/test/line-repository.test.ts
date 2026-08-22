import assert from 'node:assert/strict';
import test from 'node:test';
import { createSqlLineRepository } from '../dist/line-repository.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const GROUP_ID = 'Cgroup-a';
const NOW = new Date('2026-08-22T00:00:00.000Z');

const connectionRow = {
  tenant_id: TENANT_ID,
  group_id: GROUP_ID,
  status: 'connected',
  connected_at: NOW,
  updated_at: NOW,
};

const notificationRow = {
  id: '00000000-0000-7000-8000-000000000002',
  tenant_id: TENANT_ID,
  group_id: GROUP_ID,
  created_by_user_id: 'owner-a',
  source_type: 'event',
  source_id: 'event-001',
  title: '予定',
  body: '本文',
  deep_link: 'https://staging.example.test/events/event-001',
  status: 'pending',
  attempts: 0,
  next_retry_at: null,
  provider_message_id: null,
  last_error: null,
  created_at: NOW,
  sent_at: null,
};

test('SQL repositoryはqueueを接続中の同一tenant・groupへ限定する', async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const client = {
    async query<Row>(sql: string, values: readonly unknown[]) {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO line_connections'))
        return { rows: [connectionRow] as Row[] };
      if (sql.includes('INSERT INTO line_notification_queue'))
        return { rows: [notificationRow] as Row[] };
      if (sql.includes('WITH candidate'))
        return { rows: [notificationRow] as Row[] };
      throw new Error(`想定外のSQLです: ${sql}`);
    },
  };
  const repository = createSqlLineRepository(client);

  const connection = await repository.connect({
    tenantId: TENANT_ID,
    groupId: GROUP_ID,
    now: NOW,
  });
  assert.equal(connection.groupId, GROUP_ID);

  const notification = await repository.enqueue(
    {
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      createdByUserId: 'owner-a',
      sourceType: 'event',
      sourceId: 'event-001',
      title: '予定',
      body: '本文',
      deepLink: 'https://staging.example.test/events/event-001',
    },
    NOW,
  );
  assert.equal(notification?.groupId, GROUP_ID);

  const claim = await repository.claimDue({ now: NOW });
  assert.equal(claim?.groupId, GROUP_ID);

  const enqueueQuery = queries.find((query) =>
    query.sql.includes('INSERT INTO line_notification_queue'),
  );
  assert.ok(enqueueQuery);
  assert.match(enqueueQuery.sql, /tenant_id, group_id, created_by_user_id/);
  assert.match(enqueueQuery.sql, /tenant_id = \$1 AND group_id = \$2/);

  const claimQuery = queries.find((query) =>
    query.sql.includes('WITH candidate'),
  );
  assert.ok(claimQuery);
  assert.match(claimQuery.sql, /c\.group_id = q\.group_id/);
  assert.match(claimQuery.sql, /LIMIT 1\s+FOR UPDATE OF q SKIP LOCKED/);
});
