import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createRideRepository,
  RideRepositoryForbiddenError,
} from '../src/ride-repository.js';

// package build前でもDB repository単体テストを実行できるよう、domain実装を直接参照する。
vi.mock('@cocolo/domain/ride', async () =>
  import('../../domain/src/ride-domain.ts'),
);

const actor = {
  tenantId: '00000000-0000-7000-8000-000000000001',
  userId: 'manager-1',
  role: 'admin' as const,
};

function createFakePrisma(queryResults: unknown[]) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const audits: unknown[] = [];
  const tx = {
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      queries.push({ sql: strings.join('?'), values });
      return 1;
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values });
      return queryResults.shift() ?? [];
    },
    tenantMembership: {
      findUnique: async () => ({ role: actor.role, status: 'active' }),
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return {
    client: {
      $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) =>
        work(tx),
    } as unknown as PrismaClient,
    queries,
    audits,
  };
}

const planRow = {
  id: '00000000-0000-7000-8000-000000000010',
  tenant_id: actor.tenantId,
  title: '練習試合',
  departure_at: '2026-08-23T00:00:00.000Z',
  pickup_maps_url: null,
  destination_maps_url: null,
  status: 'open',
  created_at: '2026-08-22T00:00:00.000Z',
};

describe('送迎Prisma repository', () => {
  it('tenant条件・パラメータ化SQL・監査を同じtransactionで実行する', async () => {
    const fake = createFakePrisma([
      [
        {
          ...planRow,
          id: '00000000-0000-7000-8000-000000000011',
        },
      ],
    ]);
    const plan = await createRideRepository(fake.client).createPlan(actor, {
      title: '練習試合',
      departureAt: '2026-08-23T09:00:00+09:00',
    });
    expect(plan.tenantId).toBe(actor.tenantId);
    expect(fake.queries.some((query) => query.sql.includes('ride_plans'))).toBe(
      true,
    );
    expect(
      fake.queries.some((query) => query.values.includes(actor.tenantId)),
    ).toBe(true);
    expect(fake.audits).toHaveLength(1);
    expect(fake.audits[0]).toMatchObject({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'ride.plan.create',
    });
  });

  it('担当外memberの乗車希望はINSERT結果を外部へ漏らさず403にする', async () => {
    const fake = createFakePrisma([[planRow], []]);
    await expect(
      createRideRepository(fake.client).createRequest(actor, planRow.id, {
        memberId: '00000000-0000-7000-8000-000000000099',
        passengerCount: 1,
      }),
    ).rejects.toBeInstanceOf(RideRepositoryForbiddenError);
    expect(fake.audits).toHaveLength(0);
  });
});
