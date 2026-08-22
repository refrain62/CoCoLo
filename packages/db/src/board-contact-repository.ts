import { Prisma, type PrismaClient } from '@prisma/client';

export type BoardContactRoleType = 'admin' | 'staff' | 'member';
export type ContactPreference = 'line' | 'phone' | 'both';
export type BoardContactViewerRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type BoardContactRecord = {
  id: string;
  tenantId: string;
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId: string | null;
  lineContact: string | null;
  phone: string | null;
  contactPreference: ContactPreference;
  createdAt: Date;
  updatedAt: Date;
};

export type BoardContactCreateInput = {
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId?: string | null;
  lineContact?: string | null;
  phone?: string | null;
  contactPreference: ContactPreference;
};

export type BoardContactPatchInput = Partial<BoardContactCreateInput>;

export type BoardContactRepositoryInput = {
  tenantId: string;
  actorUserId: string;
  role: BoardContactViewerRole;
};

export class BoardContactConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'BoardContactConflictError';
  }
}

export class BoardContactAuthorizationError extends Error {
  readonly status = 403;

  constructor() {
    super('役員を管理する権限がありません。');
    this.name = 'BoardContactAuthorizationError';
  }
}

type RawBoardContact = {
  id: string;
  tenant_id: string;
  fiscal_year: number;
  role_name: string;
  role_type: string;
  assignee_user_id: string | null;
  line_contact: string | null;
  phone: string | null;
  contact_preference: string;
  created_at: Date;
  updated_at: Date;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const boardContactColumns = Prisma.sql`
  id,
  tenant_id,
  fiscal_year,
  role_name,
  role_type,
  assignee_user_id,
  line_contact,
  phone,
  contact_preference,
  created_at,
  updated_at
`;

function toRecord(row: RawBoardContact): BoardContactRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fiscalYear: row.fiscal_year,
    roleName: row.role_name,
    roleType: row.role_type as BoardContactRoleType,
    assigneeUserId: row.assignee_user_id,
    lineContact: row.line_contact,
    phone: row.phone,
    contactPreference: row.contact_preference as ContactPreference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertManagerRole(role: BoardContactViewerRole) {
  if (role !== 'owner' && role !== 'admin')
    throw new BoardContactAuthorizationError();
}

function auditMetadata(input: {
  fiscalYear: number;
  roleType: BoardContactRoleType;
  contactPreference: ContactPreference;
  assigneeUserId?: string | null;
  lineContact?: string | null;
  phone?: string | null;
}) {
  // 監査ログは個人情報の値を持たず、後から操作種別だけを確認できる形にする。
  return JSON.stringify({
    fiscalYear: input.fiscalYear,
    roleType: input.roleType,
    contactPreference: input.contactPreference,
    hasAssignee: Boolean(input.assigneeUserId),
    hasLineContact: Boolean(input.lineContact),
    hasPhone: Boolean(input.phone),
  });
}

async function setRlsContext(
  client: DatabaseClient,
  input: BoardContactRepositoryInput,
) {
  await client.$executeRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.actorUserId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

async function assertActiveMembership(
  client: DatabaseClient,
  input: BoardContactRepositoryInput,
) {
  // 所属の変更と役員操作を同じtransactionで直列化し、認証直後の権限低下を取りこぼさない。
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${input.tenantId}:${input.actorUserId}`}, 0)
    )
  `;
  const memberships = await client.$queryRaw<Array<{ role: string }>>`
    SELECT role::text AS role
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.actorUserId}
      AND status = 'active'::membership_status
    FOR SHARE
  `;
  const membership = memberships.find((item) => item.role === input.role);
  if (!membership) throw new Error('有効な所属情報が処理中に変更されました。');
}

async function assertAssigneeBelongsToTenant(
  client: DatabaseClient,
  tenantId: string,
  assigneeUserId: string | null | undefined,
) {
  if (!assigneeUserId) return;
  const rows = await client.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id
    FROM tenant_memberships
    WHERE tenant_id = ${tenantId}::uuid
      AND user_id = ${assigneeUserId}
      AND status = 'active'::membership_status
    LIMIT 1
  `;
  if (rows.length === 0)
    throw new BoardContactConflictError(
      '担当者は同じチームの有効な所属から選択してください。',
    );
}

async function lockTenant(client: DatabaseClient, tenantId: string) {
  // 年度引き継ぎと役職名の重複確認を同一テナント内で直列化する。
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))
  `;
}

async function writeAudit(
  client: DatabaseClient,
  input: BoardContactRepositoryInput,
  action: string,
  resourceId: string | null,
  metadata: string,
) {
  await client.$executeRaw`
    INSERT INTO audit_logs (
      id,
      tenant_id,
      actor_user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      app_uuidv7(),
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${action},
      'board_contact',
      ${resourceId}::uuid,
      ${metadata}::jsonb
    )
  `;
}

async function findById(
  client: DatabaseClient,
  tenantId: string,
  boardContactId: string,
) {
  const rows = await client.$queryRaw<RawBoardContact[]>(Prisma.sql`
    SELECT ${boardContactColumns}
    FROM board_contacts
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${boardContactId}::uuid
    FOR UPDATE
  `);
  return rows[0] ? toRecord(rows[0]) : null;
}

async function assertRoleNameAvailable(
  client: DatabaseClient,
  input: {
    tenantId: string;
    fiscalYear: number;
    roleName: string;
    exceptId?: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM board_contacts
    WHERE tenant_id = ${input.tenantId}::uuid
      AND fiscal_year = ${input.fiscalYear}
      AND role_name = ${input.roleName}
      ${input.exceptId ? Prisma.sql`AND id <> ${input.exceptId}::uuid` : Prisma.empty}
    FOR UPDATE
  `);
  if (rows.length > 0)
    throw new BoardContactConflictError(
      '同じ年度に同じ役職名を複数登録できません。',
    );
}

function hasPatchValue(
  patch: BoardContactPatchInput,
  key: keyof BoardContactPatchInput,
) {
  return Object.hasOwn(patch, key);
}

// Prisma schemaの生成モデルに依存せず、将来の役員テーブルをraw SQLで扱うrepositoryを提供する。
// board_contactsの列・制約・RLSはdocs/integration/phase3-board-contact.mdの契約に従って先行migrationで用意する。
export function createBoardContactRepository(client: PrismaClient) {
  return {
    list: async (input: {
      tenantId: string;
      actorUserId: string;
      role: BoardContactViewerRole;
      query: { fiscalYear?: number };
    }) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        const rows = await tx.$queryRaw<RawBoardContact[]>(Prisma.sql`
          SELECT ${boardContactColumns}
          FROM board_contacts
          WHERE tenant_id = ${input.tenantId}::uuid
            ${input.query.fiscalYear === undefined ? Prisma.empty : Prisma.sql`AND fiscal_year = ${input.query.fiscalYear}`}
          ORDER BY fiscal_year DESC, role_name ASC, id ASC
        `);
        return rows.map(toRecord);
      }),

    create: async (input: {
      tenantId: string;
      actorUserId: string;
      role: 'owner' | 'admin';
      contact: BoardContactCreateInput;
    }) =>
      client.$transaction(async (tx) => {
        assertManagerRole(input.role);
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        await lockTenant(tx, input.tenantId);
        await assertRoleNameAvailable(tx, {
          tenantId: input.tenantId,
          fiscalYear: input.contact.fiscalYear,
          roleName: input.contact.roleName,
        });
        await assertAssigneeBelongsToTenant(
          tx,
          input.tenantId,
          input.contact.assigneeUserId,
        );
        const rows = await tx.$queryRaw<RawBoardContact[]>(Prisma.sql`
          INSERT INTO board_contacts (
            id,
            tenant_id,
            fiscal_year,
            role_name,
            role_type,
            assignee_user_id,
            line_contact,
            phone,
            contact_preference
          ) VALUES (
            app_uuidv7(),
            ${input.tenantId}::uuid,
            ${input.contact.fiscalYear},
            ${input.contact.roleName},
            ${input.contact.roleType},
            ${input.contact.assigneeUserId ?? null},
            ${input.contact.lineContact ?? null},
            ${input.contact.phone ?? null},
            ${input.contact.contactPreference}
          )
          RETURNING ${boardContactColumns}
        `);
        const created = rows[0];
        if (!created) throw new Error('役員の登録結果を取得できませんでした。');
        await writeAudit(
          tx,
          input,
          'board_contact.create',
          created.id,
          auditMetadata(input.contact),
        );
        return toRecord(created);
      }),

    update: async (input: {
      tenantId: string;
      actorUserId: string;
      role: 'owner' | 'admin';
      boardContactId: string;
      patch: BoardContactPatchInput;
    }) =>
      client.$transaction(async (tx) => {
        assertManagerRole(input.role);
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        await lockTenant(tx, input.tenantId);
        const current = await findById(
          tx,
          input.tenantId,
          input.boardContactId,
        );
        if (!current) return null;
        const nextFiscalYear = input.patch.fiscalYear ?? current.fiscalYear;
        const nextRoleName = input.patch.roleName ?? current.roleName;
        await assertRoleNameAvailable(tx, {
          tenantId: input.tenantId,
          fiscalYear: nextFiscalYear,
          roleName: nextRoleName,
          exceptId: input.boardContactId,
        });
        if (hasPatchValue(input.patch, 'assigneeUserId'))
          await assertAssigneeBelongsToTenant(
            tx,
            input.tenantId,
            input.patch.assigneeUserId,
          );

        const updates: Prisma.Sql[] = [];
        if (hasPatchValue(input.patch, 'fiscalYear'))
          updates.push(Prisma.sql`fiscal_year = ${input.patch.fiscalYear}`);
        if (hasPatchValue(input.patch, 'roleName'))
          updates.push(Prisma.sql`role_name = ${input.patch.roleName}`);
        if (hasPatchValue(input.patch, 'roleType'))
          updates.push(Prisma.sql`role_type = ${input.patch.roleType}`);
        if (hasPatchValue(input.patch, 'assigneeUserId'))
          updates.push(
            Prisma.sql`assignee_user_id = ${input.patch.assigneeUserId ?? null}`,
          );
        if (hasPatchValue(input.patch, 'lineContact'))
          updates.push(
            Prisma.sql`line_contact = ${input.patch.lineContact ?? null}`,
          );
        if (hasPatchValue(input.patch, 'phone'))
          updates.push(Prisma.sql`phone = ${input.patch.phone ?? null}`);
        if (hasPatchValue(input.patch, 'contactPreference'))
          updates.push(
            Prisma.sql`contact_preference = ${input.patch.contactPreference}`,
          );
        updates.push(Prisma.sql`updated_at = now()`);
        const rows = await tx.$queryRaw<RawBoardContact[]>(Prisma.sql`
          UPDATE board_contacts
          SET ${Prisma.join(updates, ', ')}
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.boardContactId}::uuid
          RETURNING ${boardContactColumns}
        `);
        const updated = rows[0];
        if (!updated) return null;
        const updatedRecord = toRecord(updated);
        await writeAudit(
          tx,
          input,
          'board_contact.update',
          updated.id,
          auditMetadata({
            fiscalYear: updatedRecord.fiscalYear,
            roleType: updatedRecord.roleType,
            contactPreference: updatedRecord.contactPreference,
            assigneeUserId: input.patch.assigneeUserId,
            lineContact: input.patch.lineContact,
            phone: input.patch.phone,
          }),
        );
        return updatedRecord;
      }),

    remove: async (input: {
      tenantId: string;
      actorUserId: string;
      role: 'owner' | 'admin';
      boardContactId: string;
    }) =>
      client.$transaction(async (tx) => {
        assertManagerRole(input.role);
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        await lockTenant(tx, input.tenantId);
        const rows = await tx.$queryRaw<RawBoardContact[]>(Prisma.sql`
          DELETE FROM board_contacts
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.boardContactId}::uuid
          RETURNING ${boardContactColumns}
        `);
        const removed = rows[0];
        if (!removed) return null;
        const removedRecord = toRecord(removed);
        await writeAudit(
          tx,
          input,
          'board_contact.remove',
          removed.id,
          auditMetadata(removedRecord),
        );
        return removedRecord;
      }),

    copyYear: async (input: {
      tenantId: string;
      actorUserId: string;
      role: 'owner' | 'admin';
      fromFiscalYear: number;
      toFiscalYear: number;
    }) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        await lockTenant(tx, input.tenantId);
        await tx.$executeRaw`
          INSERT INTO board_contacts (
            id,
            tenant_id,
            fiscal_year,
            role_name,
            role_type,
            assignee_user_id,
            line_contact,
            phone,
            contact_preference
          )
          SELECT
            app_uuidv7(),
            tenant_id,
            ${input.toFiscalYear},
            role_name,
            role_type,
            NULL,
            NULL,
            NULL,
            'line'
          FROM board_contacts AS source
          WHERE source.tenant_id = ${input.tenantId}::uuid
            AND source.fiscal_year = ${input.fromFiscalYear}
            AND NOT EXISTS (
              SELECT 1
              FROM board_contacts AS target
              WHERE target.tenant_id = source.tenant_id
                AND target.fiscal_year = ${input.toFiscalYear}
                AND target.role_name = source.role_name
            )
        `;
        const rows = await tx.$queryRaw<RawBoardContact[]>(Prisma.sql`
          SELECT ${boardContactColumns}
          FROM board_contacts
          WHERE tenant_id = ${input.tenantId}::uuid
            AND fiscal_year = ${input.toFiscalYear}
          ORDER BY role_name ASC, id ASC
        `);
        await writeAudit(
          tx,
          input,
          'board_contact.copy_year',
          null,
          JSON.stringify({
            fromFiscalYear: input.fromFiscalYear,
            toFiscalYear: input.toFiscalYear,
            copiedCount: rows.length,
          }),
        );
        return rows.map(toRecord);
      }),
  };
}
