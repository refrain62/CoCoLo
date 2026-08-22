import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardContactRepository } from '../dist/board-contact-repository.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const rawContact = {
  id: '00000000-0000-7000-8000-000000000301',
  tenant_id: TENANT_ID,
  fiscal_year: 2026,
  role_name: '会計',
  role_type: 'admin',
  assignee_user_id: 'user-a',
  line_contact: 'line-a',
  phone: '090-0000-0000',
  contact_preference: 'both',
  created_at: new Date('2026-04-01T00:00:00.000Z'),
  updated_at: new Date('2026-04-01T00:00:00.000Z'),
};

function queryText(query) {
  if (Array.isArray(query)) return query.join('?');
  return typeof query?.sql === 'string' ? query.sql : '';
}

function queryValues(query) {
  return Array.isArray(query?.values) ? query.values : [];
}

function createFakeClient() {
  const calls = [];
  const tx = {
    async $executeRaw(query, ...values) {
      const normalized = {
        sql: queryText(query),
        values: [
          ...(Array.isArray(query?.values) ? query.values : []),
          ...values,
        ],
      };
      calls.push({ kind: 'execute', query: normalized });
      return 1;
    },
    async $queryRaw(query, ...values) {
      const normalized = {
        sql: queryText(query),
        values: [
          ...(Array.isArray(query?.values) ? query.values : []),
          ...values,
        ],
      };
      calls.push({ kind: 'query', query: normalized });
      const text = normalized.sql;
      if (text.includes('FROM tenant_memberships')) {
        if (text.includes('SELECT user_id')) return [{ user_id: 'user-a' }];
        return [{ role: 'owner' }];
      }
      if (text.includes('SELECT id') && text.includes('FROM board_contacts'))
        return [];
      if (text.includes('INSERT INTO board_contacts')) return [rawContact];
      if (text.includes('FROM board_contacts')) return [rawContact];
      return [];
    },
  };
  return {
    calls,
    async $transaction(callback) {
      return callback(tx);
    },
  };
}

test('repositoryの書き込み境界でもstaffのmanager操作を拒否する', async () => {
  const client = createFakeClient();
  const repository = createBoardContactRepository(client);

  await assert.rejects(
    repository.create({
      tenantId: TENANT_ID,
      actorUserId: 'staff-a',
      role: 'staff',
      contact: {
        fiscalYear: 2026,
        roleName: '会計',
        roleType: 'admin',
        contactPreference: 'line',
      },
    }),
    { status: 403 },
  );
  assert.equal(client.calls.length, 0);
});

test('repositoryは登録前に同一テナントの所属を再確認し、監査へ連絡先の値を保存しない', async () => {
  const client = createFakeClient();
  const repository = createBoardContactRepository(client);

  const result = await repository.create({
    tenantId: TENANT_ID,
    actorUserId: 'owner-a',
    role: 'owner',
    contact: {
      fiscalYear: 2026,
      roleName: '会計',
      roleType: 'admin',
      assigneeUserId: 'user-a',
      lineContact: 'line-a',
      phone: '090-0000-0000',
      contactPreference: 'both',
    },
  });

  assert.equal(result.tenantId, TENANT_ID);
  const auditCall = client.calls.find(
    ({ kind, query }) =>
      kind === 'execute' && queryValues(query).includes('board_contact.create'),
  );
  assert.ok(auditCall);
  const auditValues = queryValues(auditCall.query);
  assert.ok(auditValues.some((value) => String(value).includes('hasPhone')));
  assert.equal(
    auditValues.some((value) => String(value).includes('090-0000-0000')),
    false,
  );
  assert.equal(
    client.calls.some(({ query }) => queryValues(query).includes(TENANT_ID)),
    true,
  );
});

test('年度引き継ぎは同一テナントで実行し、結果の連絡先をDBの値として返す', async () => {
  const client = createFakeClient();
  const repository = createBoardContactRepository(client);

  const result = await repository.copyYear({
    tenantId: TENANT_ID,
    actorUserId: 'owner-a',
    role: 'owner',
    fromFiscalYear: 2026,
    toFiscalYear: 2027,
  });

  assert.equal(result[0]?.roleName, '会計');
  assert.equal(
    client.calls.some(
      ({ kind, query }) =>
        kind === 'execute' && queryText(query).includes('NOT EXISTS'),
    ),
    true,
  );
  assert.equal(
    client.calls.some(({ query }) => queryValues(query).includes(TENANT_ID)),
    true,
  );
});
