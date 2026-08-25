import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
type AuthProvider = 'google' | 'line';

export type AuthInvitationErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVITATION_CONFLICT';

export class AuthInvitationError extends Error {
  readonly status: 403 | 404 | 409;
  readonly code: AuthInvitationErrorCode;

  constructor(
    code: AuthInvitationErrorCode,
    message: string,
    status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = 'AuthInvitationError';
    this.code = code;
    this.status = status;
  }
}

export type AuthInvitationRecord = {
  id: string;
  memberId: string;
  role: 'guardian';
  relationship: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
};

export type AuthInvitationRepository = {
  list: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
  }) => Promise<AuthInvitationRecord[]>;
  create: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    memberId: string;
    relationship: string;
    expiresAt: Date;
  }) => Promise<AuthInvitationRecord & { token: string }>;
  revoke: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    invitationId: string;
  }) => Promise<AuthInvitationRecord | null>;
  accept: (input: {
    userId: string;
    provider: AuthProvider;
    token: string;
  }) => Promise<{
    tenantId: string;
    memberId: string;
    role: 'guardian';
    linkStatus: 'active';
  }>;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

async function setConfig(
  client: DatabaseClient,
  input: {
    tenantId: string;
    userId: string;
    role: MemberRole;
    invitationAccepting?: boolean;
    invitationTokenHash?: string;
  },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true),
      set_config('app.invitation_accepting', ${
        input.invitationAccepting ? 'true' : 'false'
      }, true),
      set_config('app.invitation_token_hash', ${
        input.invitationTokenHash ?? ''
      }, true)
  `;
}

async function assertActiveMembership(
  client: DatabaseClient,
  input: {
    tenantId: string;
    userId: string;
    role: 'owner' | 'admin';
  },
) {
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
    },
    select: { role: true, status: true },
  });
  if (membership?.status !== 'active' || membership.role !== input.role)
    throw new AuthInvitationError(
      'FORBIDDEN',
      '招待を操作する権限がありません。',
      403,
    );
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function toRecord(row: {
  id: string;
  memberId: string;
  role: MemberRole;
  relationship: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
}): AuthInvitationRecord {
  if (row.role !== 'guardian')
    throw new AuthInvitationError(
      'INVITATION_CONFLICT',
      '対象member招待のroleが不正です。',
      409,
    );
  return {
    id: row.id,
    memberId: row.memberId,
    role: 'guardian',
    relationship: row.relationship,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
  };
}

const invitationSelect = {
  id: true,
  memberId: true,
  role: true,
  relationship: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
} satisfies Prisma.AuthInvitationSelect;

export function createAuthInvitationRepository(
  client: PrismaClient,
): AuthInvitationRepository {
  return {
    list: (input) =>
      client.$transaction(async (tx) => {
        await setConfig(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        const rows = await tx.authInvitation.findMany({
          where: { tenantId: input.tenantId },
          orderBy: { createdAt: 'desc' },
          select: invitationSelect,
        });
        const now = new Date();
        return rows.map((row) =>
          toRecord({
            ...row,
            status:
              row.status === 'pending' && row.expiresAt <= now
                ? 'expired'
                : row.status,
          }),
        );
      }),

    create: (input) =>
      client.$transaction(async (tx) => {
        await setConfig(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        if (input.expiresAt <= new Date())
          throw new AuthInvitationError(
            'INVITATION_CONFLICT',
            '招待の有効期限が不正です。',
            409,
          );
        const member = await tx.member.findUnique({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.memberId,
            },
          },
          select: { id: true, status: true },
        });
        if (!member || member.status === 'retired')
          throw new AuthInvitationError(
            'NOT_FOUND',
            '招待対象のmemberが見つかりません。',
            404,
          );
        const token = randomBytes(32).toString('base64url');
        const created = await tx.authInvitation.create({
          data: {
            tenantId: input.tenantId,
            memberId: input.memberId,
            role: 'guardian',
            relationship: input.relationship,
            tokenHash: hashToken(token),
            invitedByUserId: input.actorUserId,
            expiresAt: input.expiresAt,
          },
          select: invitationSelect,
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'auth.invitation.create',
            resourceType: 'auth_invitation',
            resourceId: created.id,
            metadata: {
              memberId: input.memberId,
              role: 'guardian',
              relationship: input.relationship,
              expiresAt: input.expiresAt.toISOString(),
            },
          },
        });
        return { ...toRecord(created), token };
      }),

    revoke: (input) =>
      client.$transaction(async (tx) => {
        await setConfig(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        const current = await tx.authInvitation.findUnique({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.invitationId,
            },
          },
          select: { ...invitationSelect, status: true },
        });
        if (!current) return null;
        if (current.status !== 'pending')
          throw new AuthInvitationError(
            'INVITATION_CONFLICT',
            'この招待は取り消せない状態です。',
            409,
          );
        const revoked = await tx.authInvitation.update({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.invitationId,
            },
          },
          data: { status: 'revoked', revokedAt: new Date() },
          select: invitationSelect,
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'auth.invitation.revoke',
            resourceType: 'auth_invitation',
            resourceId: revoked.id,
            metadata: { memberId: revoked.memberId },
          },
        });
        return toRecord(revoked);
      }),

    accept: (input) =>
      client.$transaction(async (tx) => {
        const tokenHash = hashToken(input.token);
        await setConfig(tx, {
          tenantId: '',
          userId: input.userId,
          role: 'guardian',
          invitationTokenHash: tokenHash,
        });
        const invitation = await tx.authInvitation.findUnique({
          where: { tokenHash },
        });
        if (!invitation)
          throw new AuthInvitationError(
            'NOT_FOUND',
            '招待が見つからないか、有効期限が切れています。',
            404,
          );
        if (invitation.role !== 'guardian')
          throw new AuthInvitationError(
            'INVITATION_CONFLICT',
            '招待のroleが不正です。',
            409,
          );

        await setConfig(tx, {
          tenantId: invitation.tenantId,
          userId: input.userId,
          role: 'guardian',
          invitationAccepting: true,
          invitationTokenHash: tokenHash,
        });
        // providerはAPIで検証済みのSupabase app_metadata.providers、subjectは検証済みJWTのsubを保存する。
        const identity = await tx.authIdentity.findFirst({
          where: { userId: input.userId, provider: input.provider },
          select: { id: true, providerSubject: true },
        });
        if (identity && identity.providerSubject !== input.userId)
          throw new AuthInvitationError(
            'INVITATION_CONFLICT',
            'OAuth identityの変更には管理者確認が必要です。',
            409,
          );
        if (identity)
          await tx.authIdentity.update({
            where: { id: identity.id },
            data: { revokedAt: null },
          });
        else
          await tx.authIdentity.create({
            data: {
              userId: input.userId,
              provider: input.provider,
              providerSubject: input.userId,
            },
          });

        const membership = await tx.tenantMembership.findUnique({
          where: {
            tenantId_userId: {
              tenantId: invitation.tenantId,
              userId: input.userId,
            },
          },
          select: { role: true, status: true },
        });
        if (membership && membership.role !== 'guardian')
          throw new AuthInvitationError(
            'INVITATION_CONFLICT',
            '既存の所属roleを招待で変更できません。',
            409,
          );
        await tx.tenantMembership.upsert({
          where: {
            tenantId_userId: {
              tenantId: invitation.tenantId,
              userId: input.userId,
            },
          },
          create: {
            tenantId: invitation.tenantId,
            userId: input.userId,
            role: 'guardian',
            status: 'active',
          },
          update: { status: 'active' },
        });
        const link = await tx.guardianMember.upsert({
          where: {
            tenantId_userId_memberId: {
              tenantId: invitation.tenantId,
              userId: input.userId,
              memberId: invitation.memberId,
            },
          },
          create: {
            tenantId: invitation.tenantId,
            userId: input.userId,
            memberId: invitation.memberId,
            relationship: invitation.relationship,
            linkType: 'guardian',
            status: 'active',
            consentedAt: new Date(),
          },
          update: {
            relationship: invitation.relationship,
            linkType: 'guardian',
            status: 'active',
            consentedAt: new Date(),
          },
          select: { status: true },
        });
        await tx.authInvitation.update({
          where: { id: invitation.id },
          data: {
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId: input.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: invitation.tenantId,
            actorUserId: input.userId,
            action: 'auth.invitation.accept',
            resourceType: 'auth_invitation',
            resourceId: invitation.id,
            metadata: {
              memberId: invitation.memberId,
              provider: input.provider,
            },
          },
        });
        return {
          tenantId: invitation.tenantId,
          memberId: invitation.memberId,
          role: 'guardian' as const,
          linkStatus: link.status as 'active',
        };
      }),
  };
}
