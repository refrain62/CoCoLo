import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberRepositories } from '@cocolo/db';

test('部員一覧の監査metadataへ検索語を保存しない', async () => {
  const auditEntries = [];
  const transaction = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    tenantMembership: {
      findUnique: async () => ({ role: 'owner', status: 'active' }),
    },
    member: {
      findMany: async () => [],
    },
    auditLog: {
      createMany: async ({ data }) => {
        auditEntries.push(...data);
        return { count: data.length };
      },
    },
  };
  const repositories = createMemberRepositories({
    $transaction: async (callback) => callback(transaction),
  });
  const searchTerm = '監査対象の個人名';

  await repositories.memberRepository.list({
    tenantId: 'tenant-a',
    userId: 'owner-a',
    role: 'owner',
    query: { q: searchTerm, page: 1, pageSize: 50 },
  });

  assert.equal(auditEntries.length, 1);
  assert.equal(
    JSON.stringify(auditEntries[0].metadata).includes(searchTerm),
    false,
  );
  assert.deepEqual(auditEntries[0].metadata, {
    filters: { category: null, status: null, page: 1, pageSize: 50 },
  });
});
