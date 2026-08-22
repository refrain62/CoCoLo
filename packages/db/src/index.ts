import {
  type MemberCategory,
  type MemberStatus,
  type Prisma,
  PrismaClient,
  type Role,
} from '@prisma/client';

export type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type MemberListQuery = {
  q?: string;
  status?: 'active' | 'suspended' | 'retired';
  category?: 'student' | 'adult';
  page: number;
  pageSize: number;
};
export type MemberCreateInput = {
  name: string;
  kana?: string | null;
  category: 'student' | 'adult';
  gradeLevel?: number | null;
  ageGroup?: string | null;
  status: 'active' | 'suspended';
};
export type MemberRecord = {
  id: string;
  tenantId: string;
  name: string;
  kana: string | null;
  category: 'student' | 'adult';
  gradeLevel: number | null;
  ageGroup: string | null;
  status: 'active' | 'suspended' | 'retired';
  createdAt: Date;
};

const memberSelect = {
  id: true,
  tenantId: true,
  name: true,
  kana: true,
  category: true,
  gradeLevel: true,
  ageGroup: true,
  status: true,
  createdAt: true,
} satisfies Prisma.MemberSelect;

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

// membership検索用のuser contextだけをtransaction内へ設定し、後続のRLS判定に利用する。
async function setUserContext(client: DatabaseClient, userId: string) {
  await client.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

// tenant・user・roleをtransaction-local設定へまとめて入れ、同じtransaction内の全クエリへRLS境界を適用する。
async function setRlsContext(
  client: DatabaseClient,
  input: { tenantId: string; userId: string; role: MemberRole },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

// Prismaのenum型と日時をAPI/DB repositoryの共通recordへ変換する。
function toRecord(member: {
  id: string;
  tenantId: string;
  name: string;
  kana: string | null;
  category: MemberCategory;
  gradeLevel: number | null;
  ageGroup: string | null;
  status: MemberStatus;
  createdAt: Date;
}): MemberRecord {
  return {
    ...member,
    category: member.category as MemberRecord['category'],
    status: member.status as MemberRecord['status'],
  };
}

// 認証時に解決した所属を同じtransactionで再確認し、呼び出し側が任意tenant/roleを注入できないようにする。
async function assertActiveMembership(
  client: Prisma.TransactionClient,
  input: { tenantId: string; userId: string; role: MemberRole },
) {
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: input.tenantId,
        userId: input.userId,
      },
    },
    select: { role: true, status: true },
  });
  if (
    membership?.status !== 'active' ||
    membership?.role !== (input.role as Role)
  )
    throw new Error('active membership context changed');
}

// API serverが利用するPrisma clientを生成する。transaction境界は各repository操作で管理する。
export function createPrismaClient() {
  return new PrismaClient();
}

// RLS context、入力条件、監査ログをrepositoryに閉じ込め、API handlerからDB境界を迂回させない。
export function createMemberRepositories(client: PrismaClient) {
  return {
    membershipRepository: {
      // active所属が複数ある場合はtenantを暗黙選択せず、API側で利用可能な所属なしとして扱う。
      findActiveByUserId: async (userId: string) =>
        client.$transaction(async (tx) => {
          await setUserContext(tx, userId);
          const memberships = await tx.tenantMembership.findMany({
            where: { userId, status: 'active' },
            orderBy: { createdAt: 'asc' },
            select: { tenantId: true, role: true },
          });
          if (memberships.length !== 1) return null;
          const [membership] = memberships;
          if (!membership) return null;
          return {
            tenantId: membership.tenantId,
            role: membership.role as MemberRole,
          };
        }),
    },
    memberRepository: {
      // guardianは担当関係でさらに絞り、検索と監査を同じtransactionで完了させる。
      list: async (input: {
        tenantId: string;
        userId: string;
        role: MemberRole;
        query: MemberListQuery;
      }) =>
        client.$transaction(async (tx) => {
          await setRlsContext(tx, input);
          await assertActiveMembership(tx, input);
          const where: Prisma.MemberWhereInput = {
            tenantId: input.tenantId,
          };
          if (input.query.q)
            where.OR = [
              { name: { contains: input.query.q, mode: 'insensitive' } },
              { kana: { contains: input.query.q, mode: 'insensitive' } },
            ];
          if (input.query.status) where.status = input.query.status;
          if (input.query.category) where.category = input.query.category;
          if (input.role === 'guardian')
            // membershipだけではなくguardian_membersの担当関係も境界条件にする。
            where.guardianLinks = {
              some: { tenantId: input.tenantId, userId: input.userId },
            };
          const members = await tx.member.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (input.query.page - 1) * input.query.pageSize,
            take: input.query.pageSize,
            select: memberSelect,
          });
          // 検索語は個人情報になり得るため保存せず、再現に必要な絞り込み条件だけを監査する。
          await tx.auditLog.createMany({
            data: [
              {
                tenantId: input.tenantId,
                actorUserId: input.userId,
                action: 'member.list',
                resourceType: 'member',
                metadata: {
                  filters: {
                    category: input.query.category ?? null,
                    status: input.query.status ?? null,
                    page: input.query.page,
                    pageSize: input.query.pageSize,
                  },
                },
              },
            ],
          });
          return members.map(toRecord);
        }),
      create: async (
        input: { tenantId: string; actorUserId: string; role: MemberRole },
        member: MemberCreateInput,
      ) =>
        client.$transaction(async (tx) => {
          // 所属再確認、部員作成、監査を一つのtransactionに束ね、片方だけ成功する状態を防ぐ。
          await setRlsContext(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          await assertActiveMembership(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          const created = await tx.member.create({
            data: {
              tenantId: input.tenantId,
              name: member.name,
              kana: member.kana ?? null,
              category: member.category,
              gradeLevel: member.gradeLevel ?? null,
              ageGroup: member.ageGroup ?? null,
              status: member.status,
            },
            select: memberSelect,
          });
          await tx.auditLog.createMany({
            data: [
              {
                tenantId: input.tenantId,
                actorUserId: input.actorUserId,
                action: 'member.create',
                resourceType: 'member',
                resourceId: created.id,
                metadata: { category: member.category },
              },
            ],
          });
          return toRecord(created);
        }),
    },
  };
}
