import type { Prisma, PrismaClient } from '@prisma/client';

export type SystemAnnouncementStatus = 'draft' | 'published' | 'archived';

export type SystemAnnouncementRecord = {
  id: string;
  title: string;
  body: string;
  status: SystemAnnouncementStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SystemFeatureRecord = {
  key: string;
  billingType: 'free' | 'paid';
  displayName: string;
  systemEnabled: boolean;
};

export type SystemAdminRepository = {
  listAnnouncements(actorUserId: string): Promise<SystemAnnouncementRecord[]>;
  createAnnouncement(input: {
    actorUserId: string;
    title: string;
    body: string;
    status: SystemAnnouncementStatus;
  }): Promise<SystemAnnouncementRecord>;
  updateAnnouncement(input: {
    actorUserId: string;
    announcementId: string;
    title?: string;
    body?: string;
    status?: SystemAnnouncementStatus;
  }): Promise<SystemAnnouncementRecord | null>;
  listFeatures(actorUserId: string): Promise<SystemFeatureRecord[]>;
  setFeatureEnabled(input: {
    actorUserId: string;
    featureKey: string;
    enabled: boolean;
    reason: string;
  }): Promise<SystemFeatureRecord>;
};

export class SystemAdminRepositoryError extends Error {
  readonly status: 403 | 404 | 409;
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

  constructor(
    code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT',
    message: string,
    status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = 'SystemAdminRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function setSystemAdminContext(
  client: Prisma.TransactionClient,
  actorUserId: string,
) {
  return client.$queryRaw`
    SELECT
      set_config('app.tenant_id', '', true),
      set_config('app.user_id', ${actorUserId}, true),
      set_config('app.role', 'system_admin', true)
  `;
}

function assertActorUserId(actorUserId: string) {
  if (!actorUserId.trim())
    throw new SystemAdminRepositoryError(
      'FORBIDDEN',
      'system adminの利用者IDが必要です。',
      403,
    );
}

function assertAnnouncementText(
  value: string,
  field: string,
  maxLength?: number,
) {
  if (!value.trim() || (maxLength !== undefined && value.length > maxLength))
    throw new SystemAdminRepositoryError(
      'CONFLICT',
      `${field}の値が不正です。`,
      409,
    );
}

function assertAnnouncementStatus(
  status: string,
): asserts status is SystemAnnouncementStatus {
  if (status !== 'draft' && status !== 'published' && status !== 'archived')
    throw new SystemAdminRepositoryError(
      'CONFLICT',
      'お知らせの状態が不正です。',
      409,
    );
}

function toAnnouncementRecord(row: {
  id: string;
  title: string;
  body: string;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SystemAnnouncementRecord {
  assertAnnouncementStatus(row.status);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFeatureRecord(row: {
  key: string;
  billingType: string;
  displayName: string;
  systemEnabled: boolean;
}): SystemFeatureRecord {
  if (row.billingType !== 'free' && row.billingType !== 'paid')
    throw new SystemAdminRepositoryError(
      'CONFLICT',
      'featureの課金区分が不正です。',
      409,
    );
  return {
    key: row.key,
    billingType: row.billingType,
    displayName: row.displayName,
    systemEnabled: row.systemEnabled,
  };
}

function createAuditData(input: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata: Prisma.InputJsonValue;
}) {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
  };
}

export function createSystemAdminRepository(
  client: PrismaClient,
): SystemAdminRepository {
  return {
    listAnnouncements: async (actorUserId) => {
      assertActorUserId(actorUserId);
      return client.$transaction(async (tx) => {
        await setSystemAdminContext(tx, actorUserId);
        const rows = await tx.systemAnnouncement.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toAnnouncementRecord);
      });
    },
    createAnnouncement: async (input) => {
      assertActorUserId(input.actorUserId);
      assertAnnouncementText(input.title, 'タイトル', 200);
      assertAnnouncementText(input.body, '本文');
      assertAnnouncementStatus(input.status);
      return client.$transaction(async (tx) => {
        await setSystemAdminContext(tx, input.actorUserId);
        const now = new Date();
        const row = await tx.systemAnnouncement.create({
          data: {
            title: input.title,
            body: input.body,
            status: input.status,
            publishedAt: input.status === 'published' ? now : null,
            createdByUserId: input.actorUserId,
          },
        });
        await tx.systemAuditLog.create({
          data: createAuditData({
            actorUserId: input.actorUserId,
            action: 'system_announcement.created',
            resourceType: 'system_announcement',
            resourceId: row.id,
            metadata: {
              status: input.status,
            },
          }),
        });
        return toAnnouncementRecord(row);
      });
    },
    updateAnnouncement: async (input) => {
      assertActorUserId(input.actorUserId);
      if (input.title !== undefined)
        assertAnnouncementText(input.title, 'タイトル', 200);
      if (input.body !== undefined) assertAnnouncementText(input.body, '本文');
      if (input.status !== undefined) assertAnnouncementStatus(input.status);
      return client.$transaction(async (tx) => {
        await setSystemAdminContext(tx, input.actorUserId);
        const existing = await tx.systemAnnouncement.findUnique({
          where: { id: input.announcementId },
        });
        if (!existing) return null;
        const nextStatus = input.status ?? existing.status;
        const data: Prisma.SystemAnnouncementUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.body !== undefined) data.body = input.body;
        if (input.status !== undefined) data.status = input.status;
        if (nextStatus === 'published' && existing.publishedAt === null)
          data.publishedAt = new Date();
        const row = await tx.systemAnnouncement.update({
          where: { id: input.announcementId },
          data,
        });
        await tx.systemAuditLog.create({
          data: createAuditData({
            actorUserId: input.actorUserId,
            action: 'system_announcement.updated',
            resourceType: 'system_announcement',
            resourceId: row.id,
            metadata: {
              status: row.status,
              changedFields: Object.keys(data),
            },
          }),
        });
        return toAnnouncementRecord(row);
      });
    },
    listFeatures: async (actorUserId) => {
      assertActorUserId(actorUserId);
      return client.$transaction(async (tx) => {
        await setSystemAdminContext(tx, actorUserId);
        const rows = await tx.featureDefinition.findMany({
          orderBy: { key: 'asc' },
          select: {
            key: true,
            billingType: true,
            displayName: true,
            systemEnabled: true,
          },
        });
        return rows.map(toFeatureRecord);
      });
    },
    setFeatureEnabled: async (input) => {
      assertActorUserId(input.actorUserId);
      if (!input.reason.trim() || input.reason.length > 500)
        throw new SystemAdminRepositoryError(
          'CONFLICT',
          '機能変更理由が不正です。',
          409,
        );
      return client.$transaction(async (tx) => {
        await setSystemAdminContext(tx, input.actorUserId);
        const existing = await tx.featureDefinition.findUnique({
          where: { key: input.featureKey },
          select: {
            key: true,
            billingType: true,
            displayName: true,
            systemEnabled: true,
          },
        });
        if (!existing)
          throw new SystemAdminRepositoryError(
            'NOT_FOUND',
            '指定されたfeatureが見つかりません。',
            404,
          );
        const row = await tx.featureDefinition.update({
          where: { key: input.featureKey },
          data: { systemEnabled: input.enabled },
          select: {
            key: true,
            billingType: true,
            displayName: true,
            systemEnabled: true,
          },
        });
        await tx.systemAuditLog.create({
          data: createAuditData({
            actorUserId: input.actorUserId,
            action: 'feature.system_enabled.updated',
            resourceType: 'feature_definition',
            metadata: {
              featureKey: input.featureKey,
              billingType: existing.billingType,
              enabled: input.enabled,
              reason: input.reason,
            },
          }),
        });
        return toFeatureRecord(row);
      });
    },
  };
}
