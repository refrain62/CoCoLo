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

async function setUserContext(client: DatabaseClient, userId: string) {
  await client.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

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

export function createPrismaClient() {
  return new PrismaClient();
}

export function createMemberRepositories(client: PrismaClient) {
  return {
    membershipRepository: {
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
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: input.userId,
              action: 'member.list',
              resourceType: 'member',
              metadata: { query: input.query },
            },
          });
          return members.map(toRecord);
        }),
      create: async (
        input: { tenantId: string; actorUserId: string; role: MemberRole },
        member: MemberCreateInput,
      ) =>
        client.$transaction(async (tx) => {
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
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: input.actorUserId,
              action: 'member.create',
              resourceType: 'member',
              resourceId: created.id,
              metadata: { category: member.category },
            },
          });
          return toRecord(created);
        }),
    },
  };
}
