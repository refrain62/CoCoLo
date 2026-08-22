import type {
  AuthTeamMembership,
  AuthTeamRole,
} from '@cocolo/domain/auth-team-selection';
import type { Prisma, PrismaClient } from '@prisma/client';

export type AuthTeamSelectionRepository = {
  listActiveMemberships: (userId: string) => Promise<AuthTeamMembership[]>;
  findActiveMembership: (
    userId: string,
    tenantId: string,
  ) => Promise<AuthTeamMembership | null>;
};

const uuidv7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const membershipSelect = {
  tenantId: true,
  role: true,
  status: true,
  createdAt: true,
} satisfies Prisma.TenantMembershipSelect;

type SelectedMembership = Prisma.TenantMembershipGetPayload<{
  select: typeof membershipSelect;
}>;

// user_idだけをtransaction-local contextへ設定し、所属一覧のRLS境界をDB側でも適用する。
async function setUserContext(
  client: Prisma.TransactionClient,
  userId: string,
) {
  await client.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

async function setTenantContext(
  client: Prisma.TransactionClient,
  tenantId: string,
) {
  await client.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

async function toMembership(
  client: Prisma.TransactionClient,
  row: SelectedMembership,
): Promise<AuthTeamMembership> {
  // Tenant policyはtenant contextを要求するため、所属確認後に同じtransaction内で設定する。
  await setTenantContext(client, row.tenantId);
  const tenant = await client.tenant.findUnique({
    where: { id: row.tenantId },
    select: { name: true },
  });
  if (!tenant) throw new Error('所属先チームが見つかりません。');
  return {
    tenantId: row.tenantId,
    tenantName: tenant.name,
    role: row.role as AuthTeamRole,
    status: row.status,
    createdAt: row.createdAt,
  };
}

// DB schemaを変更せず、既存TenantMembership/Tenantから選択用の最小read adapterを提供する。
export function createAuthTeamSelectionRepository(
  client: PrismaClient,
): AuthTeamSelectionRepository {
  return {
    listActiveMemberships: (userId) =>
      client.$transaction(async (tx) => {
        await setUserContext(tx, userId);
        const rows = await tx.tenantMembership.findMany({
          where: { userId, status: 'active' },
          orderBy: [{ createdAt: 'asc' }, { tenantId: 'asc' }],
          select: membershipSelect,
        });
        const memberships: AuthTeamMembership[] = [];
        for (const row of rows) memberships.push(await toMembership(tx, row));
        return memberships;
      }),
    findActiveMembership: (userId, tenantId) => {
      if (!uuidv7Pattern.test(tenantId)) return Promise.resolve(null);
      return client.$transaction(async (tx) => {
        await setUserContext(tx, userId);
        // 所属停止と選択確認を直列化し、active確認後に別状態へ変わる窓を狭める。
        await tx.$queryRaw`
          SELECT id
          FROM tenant_memberships
          WHERE user_id = ${userId}
            AND tenant_id = ${tenantId}::uuid
            AND status = 'active'::membership_status
          FOR UPDATE
        `;
        const row = await tx.tenantMembership.findFirst({
          where: { userId, tenantId, status: 'active' },
          select: membershipSelect,
        });
        return row ? toMembership(tx, row) : null;
      });
    },
  };
}
