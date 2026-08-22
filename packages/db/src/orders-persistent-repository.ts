import { createHash } from 'node:crypto';
import { createUuidV7 } from '@cocolo/domain/line';
import {
  calculateLineAmount,
  calculateOrderTotal,
  createOrdersCsv,
  isOrdersManager,
  type OrderCsvRow,
  type OrderEntry,
  type OrderLine,
  type OrderOption,
  type OrderProduct,
  OrdersDomainError,
  type PaymentStatus,
  type PurchaseCampaign,
  type PurchaseCampaignStatus,
  summarizeOrders,
  transitionCampaignStatus,
  validateOrderSelection,
  validateProduct,
} from '@cocolo/domain/orders';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  OrderCampaignInput,
  OrderProductInput,
  OrdersActor,
  OrdersAuditRecord,
  OrdersRepository,
} from './orders-repository.js';
import { OrdersRepositoryError } from './orders-repository.js';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

function toNumber(value: bigint | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error('注文金額が安全な整数範囲を超えています。');
  return number;
}

function toOptions(value: Prisma.JsonValue): OrderOption[] {
  if (!Array.isArray(value)) throw new Error('商品の選択肢が不正です。');
  return value.map((option) => {
    if (
      !option ||
      typeof option !== 'object' ||
      Array.isArray(option) ||
      typeof option.name !== 'string' ||
      !Array.isArray(option.values) ||
      !option.values.every((item) => typeof item === 'string')
    )
      throw new Error('商品の選択肢が不正です。');
    return { name: option.name, values: option.values };
  });
}

function toProduct(row: {
  id: string;
  orderId: string;
  name: string;
  unitPrice: bigint;
  imageUrl: string | null;
  options: Prisma.JsonValue;
  requiresBackNumber: boolean;
  requiresBackName: boolean;
}): OrderProduct {
  return {
    id: row.id,
    campaignId: row.orderId,
    name: row.name,
    unitPrice: toNumber(row.unitPrice),
    imageUrl: row.imageUrl,
    options: toOptions(row.options),
    requiresBackNumber: row.requiresBackNumber,
    requiresBackName: row.requiresBackName,
  };
}

function toCampaign(row: {
  id: string;
  tenantId: string;
  title: string;
  deadline: Date;
  status: PurchaseCampaignStatus;
  createdAt: Date;
  products: Array<{
    id: string;
    orderId: string;
    name: string;
    unitPrice: bigint;
    imageUrl: string | null;
    options: Prisma.JsonValue;
    requiresBackNumber: boolean;
    requiresBackName: boolean;
  }>;
}): PurchaseCampaign {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    deadline: row.deadline.toISOString(),
    status: row.status,
    products: row.products.map(toProduct),
    createdAt: row.createdAt.toISOString(),
  };
}

function toLine(row: {
  id: string;
  productId: string;
  productName: string;
  unitPrice: bigint;
  quantity: number;
  selectedOptions: Prisma.JsonValue;
  backNumber: string | null;
  backName: string | null;
  amount: bigint;
}): OrderLine {
  if (
    !row.selectedOptions ||
    typeof row.selectedOptions !== 'object' ||
    Array.isArray(row.selectedOptions)
  )
    throw new Error('注文の選択肢が不正です。');
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    unitPrice: toNumber(row.unitPrice),
    quantity: row.quantity,
    selectedOptions: row.selectedOptions as Record<string, string>,
    backNumber: row.backNumber,
    backName: row.backName,
    amount: toNumber(row.amount),
  };
}

function toEntry(row: {
  id: string;
  tenantId: string;
  orderId: string;
  ordererUserId: string;
  ordererName: string;
  memberId: string;
  totalAmount: bigint;
  paymentStatus: PaymentStatus;
  paymentConfirmedAt: Date | null;
  paymentConfirmedBy: string | null;
  createdAt: Date;
  member: { name: string };
  lines: Array<Parameters<typeof toLine>[0]>;
}): OrderEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    campaignId: row.orderId,
    ordererUserId: row.ordererUserId,
    ordererName: row.ordererName,
    memberId: row.memberId,
    memberName: row.member.name,
    lines: row.lines.map(toLine),
    totalAmount: toNumber(row.totalAmount),
    paymentStatus: row.paymentStatus,
    paymentConfirmedAt: row.paymentConfirmedAt?.toISOString() ?? null,
    paymentConfirmedBy: row.paymentConfirmedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

async function setRlsContext(
  client: DatabaseClient,
  actor: OrdersActor,
): Promise<void> {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${actor.tenantId}, true),
      set_config('app.user_id', ${actor.actorUserId}, true),
      set_config('app.role', ${actor.role}, true)
  `;
}

async function assertActiveMembership(
  client: Prisma.TransactionClient,
  actor: OrdersActor,
): Promise<void> {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`orders:${actor.tenantId}:${actor.actorUserId}`}, 0)
    )
  `;
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: actor.tenantId,
        userId: actor.actorUserId,
      },
    },
    select: { role: true, status: true },
  });
  if (membership?.status !== 'active' || membership.role !== actor.role)
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '有効な所属情報が処理中に変更されました。',
    );
}

async function withActor<T>(
  client: PrismaClient,
  actor: OrdersActor,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await setRlsContext(transaction, actor);
    await assertActiveMembership(transaction, actor);
    return work(transaction);
  });
}

function requireManager(actor: OrdersActor): void {
  if (!isOrdersManager(actor.role))
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '共同購買の管理権限がありません。',
    );
}

function requireViewer(actor: OrdersActor): void {
  if (actor.role === 'staff')
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '共同購買を閲覧する権限がありません。',
    );
}

function normalizeCampaign(value: OrderCampaignInput) {
  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.trim().length > 200
  )
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '募集案件名は1〜200文字で入力してください。',
    );
  const deadline = new Date(value.deadline);
  if (Number.isNaN(deadline.getTime()))
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '注文締切の日時が不正です。',
    );
  if (!Array.isArray(value.products) || value.products.length === 0)
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '商品を1件以上登録してください。',
    );
  return {
    title: value.title.trim(),
    deadline,
    products: value.products.map(normalizeProduct),
  };
}

function normalizeProduct(value: OrderProductInput) {
  try {
    return validateProduct(value);
  } catch (error) {
    if (error instanceof OrdersDomainError)
      throw new OrdersRepositoryError('INVALID_INPUT', error.message);
    throw error;
  }
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function reserveIdempotency(
  client: Prisma.TransactionClient,
  input: {
    actor: OrdersActor;
    key: string | null | undefined;
    request: unknown;
    resourceType: string;
    resourceId: string;
  },
): Promise<string | null> {
  if (!input.key) return null;
  const key = input.key.trim();
  const hash = requestHash(input.request);
  await client.$executeRaw`
    INSERT INTO order_idempotency_keys (
      id, tenant_id, actor_user_id, idempotency_key, request_hash,
      resource_type, resource_id
    ) VALUES (
      ${createUuidV7()}::uuid, ${input.actor.tenantId}::uuid,
      ${input.actor.actorUserId}, ${key}, ${hash},
      ${input.resourceType}, ${input.resourceId}::uuid
    )
    ON CONFLICT (tenant_id, actor_user_id, idempotency_key) DO NOTHING
  `;
  const existing = await client.orderIdempotencyKey.findUnique({
    where: {
      tenantId_actorUserId_idempotencyKey: {
        tenantId: input.actor.tenantId,
        actorUserId: input.actor.actorUserId,
        idempotencyKey: key,
      },
    },
    select: { requestHash: true, resourceId: true },
  });
  if (!existing)
    throw new OrdersRepositoryError('CONFLICT', '冪等キーを保存できません。');
  if (existing.requestHash !== hash)
    throw new OrdersRepositoryError(
      'CONFLICT',
      '同じIdempotency-Keyで内容を変更できません。',
    );
  return existing.resourceId === input.resourceId ? null : existing.resourceId;
}

async function writeAudit(
  client: Prisma.TransactionClient,
  input: {
    actor: OrdersActor;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata: Record<string, unknown>;
  },
) {
  await client.auditLog.create({
    data: {
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

async function findCampaign(
  client: Prisma.TransactionClient,
  actor: OrdersActor,
  orderId: string,
) {
  const campaign = await client.purchaseOrder.findFirst({
    where: { tenantId: actor.tenantId, id: orderId },
    include: { products: { orderBy: { createdAt: 'asc' } } },
  });
  if (!campaign)
    throw new OrdersRepositoryError('NOT_FOUND', '募集案件が見つかりません。');
  return campaign;
}

async function findEntries(
  client: Prisma.TransactionClient,
  actor: OrdersActor,
  orderId: string,
  paymentStatus?: PaymentStatus,
) {
  const rows = await client.orderEntry.findMany({
    where: {
      tenantId: actor.tenantId,
      orderId,
      paymentStatus,
      ...(actor.role === 'guardian'
        ? { ordererUserId: actor.actorUserId }
        : {}),
    },
    include: {
      member: { select: { name: true } },
      lines: { orderBy: { id: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toEntry);
}

// 注文の全操作をPrisma transactionとRLS contextへ閉じ込め、メモリadapterとの差し替え点を固定する。
export function createPrismaOrdersRepository(
  client: PrismaClient,
): OrdersRepository {
  return {
    listCampaigns: (actor) =>
      withActor(client, actor, async (tx) => {
        requireViewer(actor);
        const rows = await tx.purchaseOrder.findMany({
          where: { tenantId: actor.tenantId, status: actor.status },
          include: { products: { orderBy: { createdAt: 'asc' } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        await writeAudit(tx, {
          actor,
          action: 'orders.campaign.list',
          resourceType: 'order',
          metadata: { status: actor.status ?? null },
        });
        return rows.map(toCampaign);
      }),

    getCampaign: (input) =>
      withActor(client, input, async (tx) => {
        requireViewer(input);
        const campaign = toCampaign(
          await findCampaign(tx, input, input.orderId),
        );
        await writeAudit(tx, {
          actor: input,
          action: 'orders.campaign.view',
          resourceType: 'order',
          resourceId: campaign.id,
          metadata: { containsPersonalData: false },
        });
        return campaign;
      }),

    createCampaign: (input, value) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        const normalized = normalizeCampaign(value);
        if (normalized.deadline <= new Date())
          throw new OrdersRepositoryError(
            'INVALID_INPUT',
            '注文締切は現在より後に設定してください。',
          );
        const id = createUuidV7();
        const replayId = await reserveIdempotency(tx, {
          actor: input,
          key: input.idempotencyKey,
          request: normalized,
          resourceType: 'order',
          resourceId: id,
        });
        if (replayId)
          return toCampaign(await findCampaign(tx, input, replayId));
        await tx.purchaseOrder.create({
          data: {
            id,
            tenantId: input.tenantId,
            title: normalized.title,
            deadline: normalized.deadline,
            products: {
              create: normalized.products.map((product) => ({
                id: createUuidV7(),
                tenantId: input.tenantId,
                name: product.name,
                unitPrice: BigInt(product.unitPrice),
                imageUrl: product.imageUrl,
                options: product.options as Prisma.InputJsonValue,
                requiresBackNumber: product.requiresBackNumber,
                requiresBackName: product.requiresBackName,
              })),
            },
          },
        });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.campaign.create',
          resourceType: 'order',
          resourceId: id,
          metadata: {
            productCount: normalized.products.length,
            deadline: normalized.deadline.toISOString(),
          },
        });
        return toCampaign(await findCampaign(tx, input, id));
      }),

    addProduct: (input, value) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        const campaign = await findCampaign(tx, input, input.orderId);
        if (campaign.status !== 'open')
          throw new OrdersRepositoryError(
            'CONFLICT',
            '締切済みの募集案件は変更できません。',
          );
        const product = normalizeProduct(value);
        const id = createUuidV7();
        const replayId = await reserveIdempotency(tx, {
          actor: input,
          key: input.idempotencyKey,
          request: { orderId: input.orderId, product },
          resourceType: 'order_product',
          resourceId: id,
        });
        if (replayId) {
          const replay = await tx.orderProduct.findFirst({
            where: {
              tenantId: input.tenantId,
              id: replayId,
              orderId: input.orderId,
            },
          });
          if (!replay)
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toProduct(replay);
        }
        const created = await tx.orderProduct.create({
          data: {
            id,
            tenantId: input.tenantId,
            orderId: input.orderId,
            name: product.name,
            unitPrice: BigInt(product.unitPrice),
            imageUrl: product.imageUrl,
            options: product.options as Prisma.InputJsonValue,
            requiresBackNumber: product.requiresBackNumber,
            requiresBackName: product.requiresBackName,
          },
        });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.product.create',
          resourceType: 'order_product',
          resourceId: id,
          metadata: {
            orderId: input.orderId,
            optionCount: product.options.length,
          },
        });
        return toProduct(created);
      }),

    updateCampaignStatus: (input) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        const campaign = await findCampaign(tx, input, input.orderId);
        const nextStatus = transitionCampaignStatus(
          campaign.status,
          input.status,
        );
        const replayId = await reserveIdempotency(tx, {
          actor: input,
          key: input.idempotencyKey,
          request: { orderId: input.orderId, status: input.status },
          resourceType: 'order',
          resourceId: campaign.id,
        });
        if (replayId)
          return toCampaign(await findCampaign(tx, input, replayId));
        await tx.purchaseOrder.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: campaign.id } },
          data: { status: nextStatus },
        });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.campaign.status.update',
          resourceType: 'order',
          resourceId: campaign.id,
          metadata: { previousStatus: campaign.status, nextStatus },
        });
        return toCampaign(await findCampaign(tx, input, campaign.id));
      }),

    createEntry: (input) =>
      withActor(client, input, async (tx) => {
        if (input.role !== 'guardian')
          throw new OrdersRepositoryError(
            'FORBIDDEN',
            '保護者の注文権限がありません。',
          );
        const campaign = await findCampaign(tx, input, input.orderId);
        if (campaign.status !== 'open' || campaign.deadline <= new Date())
          throw new OrdersRepositoryError(
            'CONFLICT',
            '注文締切を過ぎています。',
          );
        const member = await tx.member.findFirst({
          where: {
            tenantId: input.tenantId,
            id: input.entry.memberId,
            status: 'active',
            guardianLinks: {
              some: { tenantId: input.tenantId, userId: input.actorUserId },
            },
          },
          select: { id: true, name: true },
        });
        if (!member)
          throw new OrdersRepositoryError(
            'FORBIDDEN',
            '担当部員の注文だけを登録できます。',
          );
        const orderLines = input.entry.lines.map((line) => {
          const productRow = campaign.products.find(
            (item) => item.id === line.productId,
          );
          if (!productRow)
            throw new OrdersRepositoryError(
              'NOT_FOUND',
              '募集案件に属さない商品です。',
            );
          const product = toProduct(productRow);
          try {
            const selection = validateOrderSelection(product, line);
            return {
              productId: product.id,
              productName: product.name,
              unitPrice: product.unitPrice,
              quantity: line.quantity,
              ...selection,
              amount: calculateLineAmount(product.unitPrice, line.quantity),
            };
          } catch (error) {
            if (error instanceof OrdersDomainError)
              throw new OrdersRepositoryError('INVALID_INPUT', error.message);
            throw error;
          }
        });
        const ordererName = input.entry.ordererName.trim();
        if (!ordererName || ordererName.length > 200)
          throw new OrdersRepositoryError(
            'INVALID_INPUT',
            '注文者名を入力してください。',
          );
        const totalAmount = calculateOrderTotal(orderLines);
        const id = createUuidV7();
        const normalized = {
          memberId: member.id,
          ordererName,
          lines: orderLines,
        };
        const replayId = await reserveIdempotency(tx, {
          actor: input,
          key: input.idempotencyKey,
          request: normalized,
          resourceType: 'order_entry',
          resourceId: id,
        });
        if (replayId) {
          const replay = await tx.orderEntry.findFirst({
            where: { tenantId: input.tenantId, id: replayId },
            include: { member: { select: { name: true } }, lines: true },
          });
          if (!replay)
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toEntry(replay);
        }
        await tx.orderEntry.create({
          data: {
            id,
            tenantId: input.tenantId,
            orderId: campaign.id,
            ordererUserId: input.actorUserId,
            ordererName,
            memberId: member.id,
            totalAmount: BigInt(totalAmount),
            lines: {
              create: orderLines.map((line) => ({
                id: createUuidV7(),
                tenantId: input.tenantId,
                productId: line.productId,
                productName: line.productName,
                unitPrice: BigInt(line.unitPrice),
                quantity: line.quantity,
                selectedOptions: line.selectedOptions as Prisma.InputJsonValue,
                backNumber: line.backNumber,
                backName: line.backName,
                amount: BigInt(line.amount),
              })),
            },
          },
        });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.entry.create',
          resourceType: 'order_entry',
          resourceId: id,
          metadata: {
            orderId: campaign.id,
            memberId: member.id,
            lineCount: orderLines.length,
            totalAmount,
            personalDataFields: [
              'ordererName',
              'memberId',
              'memberName',
              'backName',
            ],
          },
        });
        const created = await tx.orderEntry.findFirstOrThrow({
          where: { tenantId: input.tenantId, id },
          include: { member: { select: { name: true } }, lines: true },
        });
        return toEntry(created);
      }),

    listEntries: (input) =>
      withActor(client, input, async (tx) => {
        if (input.role === 'staff')
          throw new OrdersRepositoryError(
            'FORBIDDEN',
            '注文を閲覧する権限がありません。',
          );
        await findCampaign(tx, input, input.orderId);
        const entries = await findEntries(
          tx,
          input,
          input.orderId,
          input.paymentStatus,
        );
        await writeAudit(tx, {
          actor: input,
          action: 'orders.entry.view',
          resourceType: 'order',
          resourceId: input.orderId,
          metadata: {
            scope: input.role === 'guardian' ? 'self' : 'tenant',
            containsPersonalData: true,
          },
        });
        return entries;
      }),

    updatePayment: (input) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        const campaign = await findCampaign(tx, input, input.orderId);
        const entry = await tx.orderEntry.findFirst({
          where: {
            tenantId: input.tenantId,
            id: input.entryId,
            orderId: campaign.id,
          },
        });
        if (!entry)
          throw new OrdersRepositoryError(
            'NOT_FOUND',
            '注文明細が見つかりません。',
          );
        const replayId = await reserveIdempotency(tx, {
          actor: input,
          key: input.idempotencyKey,
          request: {
            orderId: input.orderId,
            entryId: input.entryId,
            status: input.status,
          },
          resourceType: 'order_entry',
          resourceId: entry.id,
        });
        if (replayId) {
          const replay = await tx.orderEntry.findFirstOrThrow({
            where: { tenantId: input.tenantId, id: replayId },
            include: { member: { select: { name: true } }, lines: true },
          });
          return toEntry(replay);
        }
        await tx.orderEntry.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: entry.id } },
          data: {
            paymentStatus: input.status,
            paymentConfirmedAt: input.status === 'paid' ? new Date() : null,
            paymentConfirmedBy:
              input.status === 'paid' ? input.actorUserId : null,
          },
        });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.payment.update',
          resourceType: 'order_entry',
          resourceId: entry.id,
          metadata: {
            orderId: entry.orderId,
            previousStatus: entry.paymentStatus,
            nextStatus: input.status,
            totalAmount: toNumber(entry.totalAmount),
            personalDataFields: ['memberId', 'ordererName'],
          },
        });
        const updated = await tx.orderEntry.findFirstOrThrow({
          where: { tenantId: input.tenantId, id: entry.id },
          include: { member: { select: { name: true } }, lines: true },
        });
        return toEntry(updated);
      }),

    summarize: (input) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        await findCampaign(tx, input, input.orderId);
        const summary = summarizeOrders(
          await findEntries(tx, input, input.orderId),
        );
        await writeAudit(tx, {
          actor: input,
          action: 'orders.summary.view',
          resourceType: 'order',
          resourceId: input.orderId,
          metadata: {
            totalOrders: summary.totalOrders,
            totalAmount: summary.totalAmount,
            containsPersonalData: true,
          },
        });
        return summary;
      }),

    exportCsv: (input) =>
      withActor(client, input, async (tx) => {
        requireManager(input);
        const campaign = toCampaign(
          await findCampaign(tx, input, input.orderId),
        );
        const rows: OrderCsvRow[] = [];
        for (const entry of await findEntries(tx, input, input.orderId))
          for (const line of entry.lines)
            rows.push({
              orderId: entry.id,
              campaignTitle: campaign.title,
              ordererName: entry.ordererName,
              memberName: entry.memberName,
              productName: line.productName,
              selectedOptions: Object.entries(line.selectedOptions)
                .map(([name, value]) => `${name}=${value}`)
                .join(' / '),
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: line.amount,
              paymentStatus:
                entry.paymentStatus === 'paid' ? '支払済み' : '未払い',
              paymentConfirmedAt: entry.paymentConfirmedAt ?? '',
            });
        await writeAudit(tx, {
          actor: input,
          action: 'orders.csv.export',
          resourceType: 'order',
          resourceId: campaign.id,
          metadata: { rowCount: rows.length, containsPersonalData: true },
        });
        return createOrdersCsv(rows);
      }),

    listAuditLogs: async (tenantId): Promise<OrdersAuditRecord[]> => {
      const rows = await client.auditLog.findMany({
        where: {
          tenantId,
          resourceType: { in: ['order', 'order_product', 'order_entry'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        actorUserId: row.actorUserId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  };
}
