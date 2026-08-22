import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberRepositories } from '@cocolo/db';

test('部員一覧の監査metadataへ検索語を保存しない', async () => {
  type AuditEntry = { metadata: unknown };
  type Transaction = {
    $queryRaw: () => Promise<unknown[]>;
    $executeRaw: () => Promise<number>;
    tenantMembership: {
      findUnique: () => Promise<{ role: string; status: string }>;
    };
    member: { findMany: () => Promise<unknown[]> };
    auditLog: {
      createMany: (input: { data: AuditEntry[] }) => Promise<{ count: number }>;
    };
  };
  const auditEntries: AuditEntry[] = [];
  const transaction: Transaction = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    tenantMembership: {
      findUnique: async () => ({ role: 'owner', status: 'active' }),
    },
    member: {
      findMany: async () => [],
    },
    auditLog: {
      createMany: async ({ data }: { data: AuditEntry[] }) => {
        auditEntries.push(...data);
        return { count: data.length };
      },
    },
  };
  const repositories = createMemberRepositories({
    $transaction: async (
      callback: (transaction: Transaction) => Promise<unknown>,
    ) => callback(transaction),
  } as unknown as Parameters<typeof createMemberRepositories>[0]);
  const searchTerm = '監査対象の個人名';

  await repositories.memberRepository.list({
    tenantId: 'tenant-a',
    userId: 'owner-a',
    role: 'owner',
    query: { q: searchTerm, page: 1, pageSize: 50 },
  });

  assert.equal(auditEntries.length, 1);
  const auditEntry = auditEntries[0];
  assert.ok(auditEntry);
  assert.equal(JSON.stringify(auditEntry.metadata).includes(searchTerm), false);
  assert.deepEqual(auditEntry.metadata, {
    filters: { category: null, status: null, page: 1, pageSize: 50 },
  });
});
