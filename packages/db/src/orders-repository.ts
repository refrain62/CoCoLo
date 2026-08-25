import { createHash } from 'node:crypto';
import {
  calculateLineAmount,
  calculateOrderTotal,
  createOrdersCsv,
  isOrdersManager,
  type OrderCsvRow,
  type OrderEntry,
  type OrderLine,
  type OrderProduct,
  OrdersDomainError,
  type OrdersRole,
  type OrdersSummary,
  type PaymentStatus,
  type PurchaseCampaign,
  type PurchaseCampaignStatus,
  summarizeOrders,
  transitionCampaignStatus,
  validateOrderSelection,
  validateProduct,
} from '@cocolo/domain/orders';
import { Prisma, type PrismaClient } from '@prisma/client';
import { findAuthorizedSubjectMember } from './subject-member-access.js';
import { uuidv7 } from './uuidv7.js';

export type OrdersActor = {
  tenantId: string;
  actorUserId: string;
  role: OrdersRole;
};

export type OrdersMember = {
  id: string;
  tenantId: string;
  name: string;
  status: 'active' | 'suspended' | 'retired';
};

export type OrderProductInput = {
  name: string;
  unitPrice: number;
  imageUrl?: string | null;
  options: Array<{ name: string; values: string[] }>;
  requiresBackNumber?: boolean;
  requiresBackName?: boolean;
};

export type OrderCampaignInput = {
  title: string;
  deadline: string;
  products: OrderProductInput[];
};

export type OrderEntryInput = {
  memberId: string;
  ordererName: string;
  lines: Array<{
    productId: string;
    quantity: number;
    selectedOptions: Record<string, string>;
    backNumber?: string | null;
    backName?: string | null;
  }>;
};

export type OrdersAuditRecord = {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type OrdersRepository = {
  listCampaigns: (
    input: OrdersActor & { status?: PurchaseCampaignStatus },
  ) => Promise<PurchaseCampaign[]>;
  getCampaign: (
    input: OrdersActor & { orderId: string },
  ) => Promise<PurchaseCampaign>;
  createCampaign: (
    input: OrdersActor & { idempotencyKey?: string | null },
    campaign: OrderCampaignInput,
  ) => Promise<PurchaseCampaign>;
  addProduct: (
    input: OrdersActor & { orderId: string; idempotencyKey?: string | null },
    product: OrderProductInput,
  ) => Promise<OrderProduct>;
  updateCampaignStatus: (
    input: OrdersActor & {
      orderId: string;
      status: PurchaseCampaignStatus;
      idempotencyKey?: string | null;
    },
  ) => Promise<PurchaseCampaign>;
  createEntry: (
    input: OrdersActor & {
      orderId: string;
      idempotencyKey?: string | null;
      entry: OrderEntryInput;
    },
  ) => Promise<OrderEntry>;
  listEntries: (
    input: OrdersActor & { orderId: string; paymentStatus?: PaymentStatus },
  ) => Promise<OrderEntry[]>;
  updatePayment: (
    input: OrdersActor & {
      orderId: string;
      entryId: string;
      status: PaymentStatus;
      idempotencyKey?: string | null;
    },
  ) => Promise<OrderEntry>;
  summarize: (
    input: OrdersActor & { orderId: string },
  ) => Promise<OrdersSummary>;
  exportCsv: (input: OrdersActor & { orderId: string }) => Promise<string>;
  listAuditLogs: (tenantId: string) => Promise<OrdersAuditRecord[]>;
};

export type OrdersRepositorySeed = {
  campaigns?: PurchaseCampaign[];
  entries?: OrderEntry[];
  members?: OrdersMember[];
  guardianAssignments?: Array<{
    userId: string;
    memberId: string;
    tenantId: string;
  }>;
  now?: () => Date;
  idGenerator?: () => string;
};

export class OrdersRepositoryError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'OrdersRepositoryError';
  }
}

/** 注文系テーブルへ接続しないテスト用adapter。 */
export function createInMemoryOrdersRepository(
  seed: OrdersRepositorySeed = {},
): OrdersRepository {
  const now = seed.now ?? (() => new Date());
  const createId = seed.idGenerator ?? uuidv7;
  const campaigns = new Map<string, PurchaseCampaign>();
  const entries = new Map<string, OrderEntry>();
  const members = new Map<string, OrdersMember>();
  const assignments = new Set<string>();
  const audits: OrdersAuditRecord[] = [];
  const idempotency = new Map<string, { hash: string; resourceId: string }>();

  for (const campaign of seed.campaigns ?? [])
    campaigns.set(campaign.id, clone(campaign));
  for (const entry of seed.entries ?? []) entries.set(entry.id, clone(entry));
  for (const member of seed.members ?? [])
    members.set(member.id, clone(member));
  for (const assignment of seed.guardianAssignments ?? [])
    assignments.add(
      `${assignment.tenantId}:${assignment.userId}:${assignment.memberId}`,
    );

  function requireManager(role: OrdersRole) {
    if (!isOrdersManager(role))
      throw new OrdersRepositoryError(
        'FORBIDDEN',
        '共同購買の管理権限がありません。',
      );
  }

  function requireViewer(role: OrdersRole) {
    if (role === 'staff')
      throw new OrdersRepositoryError(
        'FORBIDDEN',
        '共同購買を閲覧する権限がありません。',
      );
  }

  function requireCampaign(actor: OrdersActor, orderId: string) {
    const campaign = campaigns.get(orderId);
    if (!campaign || campaign.tenantId !== actor.tenantId)
      throw new OrdersRepositoryError(
        'NOT_FOUND',
        '募集案件が見つかりません。',
      );
    return campaign;
  }

  function requireOpen(campaign: PurchaseCampaign) {
    if (campaign.status !== 'open')
      throw new OrdersRepositoryError(
        'CONFLICT',
        '募集案件が注文を受け付けていません。',
      );
    if (Date.parse(campaign.deadline) <= now().getTime())
      throw new OrdersRepositoryError('CONFLICT', '注文締切を過ぎています。');
  }

  function requireMember(actor: OrdersActor, memberId: string) {
    const member = members.get(memberId);
    if (!member || member.tenantId !== actor.tenantId)
      throw new OrdersRepositoryError(
        'NOT_FOUND',
        '対象部員が見つかりません。',
      );
    if (member.status !== 'active')
      throw new OrdersRepositoryError(
        'CONFLICT',
        '停止または退部した部員は注文できません。',
      );
    if (
      actor.role === 'guardian' &&
      !assignments.has(`${actor.tenantId}:${actor.actorUserId}:${memberId}`)
    )
      throw new OrdersRepositoryError(
        'FORBIDDEN',
        '担当部員の注文だけを登録できます。',
      );
    return member;
  }

  function rememberIdempotency(
    actor: OrdersActor,
    key: string | null | undefined,
    input: unknown,
    resourceId: string,
  ) {
    if (!key) return null;
    const scope = `${actor.tenantId}:${actor.actorUserId}:${key}`;
    const hash = requestHash(input);
    const previous = idempotency.get(scope);
    if (previous && previous.hash !== hash)
      throw new OrdersRepositoryError(
        'CONFLICT',
        '同じIdempotency-Keyで内容を変更できません。',
      );
    if (previous) return previous.resourceId;
    idempotency.set(scope, { hash, resourceId });
    return null;
  }

  function addAudit(
    actor: OrdersActor,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ) {
    audits.push({
      id: createId(),
      tenantId: actor.tenantId,
      actorUserId: actor.actorUserId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: now().toISOString(),
    });
  }

  return {
    async listCampaigns(input) {
      requireViewer(input.role);
      const result = [...campaigns.values()]
        .filter(
          (campaign) =>
            campaign.tenantId === input.tenantId &&
            (!input.status || campaign.status === input.status),
        )
        .sort(compareCreated)
        .map(clone);
      addAudit(input, 'orders.campaign.list', 'order', null, {
        status: input.status ?? null,
      });
      return result;
    },

    async getCampaign(input) {
      requireViewer(input.role);
      const campaign = requireCampaign(input, input.orderId);
      addAudit(input, 'orders.campaign.view', 'order', campaign.id, {
        containsPersonalData: false,
      });
      return clone(campaign);
    },

    async createCampaign(input, value) {
      requireManager(input.role);
      const normalized = normalizeCampaign(value);
      if (Date.parse(normalized.deadline) <= now().getTime())
        throw new OrdersRepositoryError(
          'INVALID_INPUT',
          '注文締切は現在より後に設定してください。',
        );
      const id = createId();
      const replayId = rememberIdempotency(
        input,
        input.idempotencyKey,
        normalized,
        id,
      );
      if (replayId) {
        const replay = campaigns.get(replayId);
        if (!replay)
          throw new OrdersRepositoryError(
            'CONFLICT',
            '冪等キーの結果を復元できません。',
          );
        return clone(replay);
      }
      const createdAt = now().toISOString();
      const campaign: PurchaseCampaign = {
        id,
        tenantId: input.tenantId,
        title: normalized.title,
        deadline: normalized.deadline,
        status: 'open',
        products: normalized.products.map((product) => ({
          ...product,
          id: createId(),
          campaignId: id,
        })),
        createdAt,
      };
      campaigns.set(id, campaign);
      addAudit(input, 'orders.campaign.create', 'order', id, {
        productCount: campaign.products.length,
        deadline: campaign.deadline,
      });
      return clone(campaign);
    },

    async addProduct(input, value) {
      requireManager(input.role);
      const campaign = requireCampaign(input, input.orderId);
      if (campaign.status !== 'open')
        throw new OrdersRepositoryError(
          'CONFLICT',
          '締切済みの募集案件は変更できません。',
        );
      const normalized = normalizeProduct(value);
      const id = createId();
      const replayId = rememberIdempotency(
        input,
        input.idempotencyKey,
        { orderId: input.orderId, product: normalized },
        id,
      );
      if (replayId) {
        const replay = campaign.products.find(
          (product) => product.id === replayId,
        );
        if (!replay)
          throw new OrdersRepositoryError(
            'CONFLICT',
            '冪等キーの結果を復元できません。',
          );
        return clone(replay);
      }
      const product: OrderProduct = {
        ...normalized,
        id,
        campaignId: campaign.id,
      };
      campaign.products.push(product);
      addAudit(input, 'orders.product.create', 'order_product', id, {
        orderId: campaign.id,
        optionCount: product.options.length,
      });
      return clone(product);
    },

    async updateCampaignStatus(input) {
      requireManager(input.role);
      const campaign = requireCampaign(input, input.orderId);
      const nextStatus = transitionCampaignStatus(
        campaign.status,
        input.status,
      );
      const replayId = rememberIdempotency(
        input,
        input.idempotencyKey,
        { orderId: input.orderId, status: input.status },
        campaign.id,
      );
      if (replayId) return clone(campaign);
      const previousStatus = campaign.status;
      campaign.status = nextStatus;
      addAudit(input, 'orders.campaign.status.update', 'order', campaign.id, {
        previousStatus,
        nextStatus,
      });
      return clone(campaign);
    },

    async createEntry(input) {
      if (input.role !== 'guardian')
        throw new OrdersRepositoryError(
          'FORBIDDEN',
          '保護者の注文権限がありません。',
        );
      const campaign = requireCampaign(input, input.orderId);
      requireOpen(campaign);
      const member = requireMember(input, input.entry.memberId);
      const normalizedLines: OrderLine[] = input.entry.lines.map((line) => {
        const product = campaign.products.find(
          (candidate) => candidate.id === line.productId,
        );
        if (!product)
          throw new OrdersRepositoryError(
            'NOT_FOUND',
            '募集案件に属さない商品です。',
          );
        try {
          const selection = validateOrderSelection(product, line);
          return {
            id: createId(),
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
      const normalized = {
        memberId: member.id,
        ordererName: input.entry.ordererName.trim(),
        lines: normalizedLines.map(({ id: _id, ...line }) => line),
      };
      if (!normalized.ordererName)
        throw new OrdersRepositoryError(
          'INVALID_INPUT',
          '注文者名を入力してください。',
        );
      const id = createId();
      const replayId = rememberIdempotency(
        input,
        input.idempotencyKey,
        normalized,
        id,
      );
      if (replayId) {
        const replay = entries.get(replayId);
        if (!replay)
          throw new OrdersRepositoryError(
            'CONFLICT',
            '冪等キーの結果を復元できません。',
          );
        return clone(replay);
      }
      const entry: OrderEntry = {
        id,
        tenantId: input.tenantId,
        campaignId: campaign.id,
        ordererUserId: input.actorUserId,
        ordererName: normalized.ordererName,
        memberId: member.id,
        memberName: member.name,
        lines: normalizedLines,
        totalAmount: calculateOrderTotal(normalizedLines),
        paymentStatus: 'unpaid',
        paymentConfirmedAt: null,
        paymentConfirmedBy: null,
        createdAt: now().toISOString(),
      };
      entries.set(id, entry);
      addAudit(input, 'orders.entry.create', 'order_entry', id, {
        orderId: campaign.id,
        subjectMemberId: member.id,
        lineCount: entry.lines.length,
        totalAmount: entry.totalAmount,
        personalDataFields: [
          'ordererName',
          'subjectMemberId',
          'memberName',
          'backName',
        ],
      });
      return clone(entry);
    },

    async listEntries(input) {
      if (input.role === 'staff')
        throw new OrdersRepositoryError(
          'FORBIDDEN',
          '注文を閲覧する権限がありません。',
        );
      const campaign = requireCampaign(input, input.orderId);
      const result = [...entries.values()]
        .filter(
          (entry) =>
            entry.tenantId === input.tenantId &&
            entry.campaignId === campaign.id &&
            (!input.paymentStatus ||
              entry.paymentStatus === input.paymentStatus) &&
            (input.role !== 'guardian' ||
              entry.ordererUserId === input.actorUserId),
        )
        .sort(compareCreated)
        .map(clone);
      addAudit(input, 'orders.entry.view', 'order_entry', campaign.id, {
        scope: input.role === 'guardian' ? 'self' : 'tenant',
        containsPersonalData: true,
      });
      return result;
    },

    async updatePayment(input) {
      requireManager(input.role);
      const campaign = requireCampaign(input, input.orderId);
      const entry = entries.get(input.entryId);
      if (
        !entry ||
        entry.tenantId !== input.tenantId ||
        entry.campaignId !== campaign.id
      )
        throw new OrdersRepositoryError(
          'NOT_FOUND',
          '注文明細が見つかりません。',
        );
      const replayId = rememberIdempotency(
        input,
        input.idempotencyKey,
        {
          orderId: input.orderId,
          entryId: input.entryId,
          status: input.status,
        },
        entry.id,
      );
      if (replayId) return clone(entry);
      const previousStatus = entry.paymentStatus;
      entry.paymentStatus = input.status;
      entry.paymentConfirmedAt =
        input.status === 'paid' ? now().toISOString() : null;
      entry.paymentConfirmedBy =
        input.status === 'paid' ? input.actorUserId : null;
      addAudit(input, 'orders.payment.update', 'order_entry', entry.id, {
        orderId: entry.campaignId,
        previousStatus,
        nextStatus: entry.paymentStatus,
        totalAmount: entry.totalAmount,
        personalDataFields: ['subjectMemberId', 'ordererName'],
      });
      return clone(entry);
    },

    async summarize(input) {
      requireManager(input.role);
      const campaign = requireCampaign(input, input.orderId);
      const campaignEntries = [...entries.values()].filter(
        (entry) =>
          entry.tenantId === input.tenantId && entry.campaignId === campaign.id,
      );
      let summary: OrdersSummary;
      try {
        summary = summarizeOrders(campaignEntries);
      } catch (error) {
        if (error instanceof OrdersDomainError)
          throw new OrdersRepositoryError('INVALID_INPUT', error.message);
        throw error;
      }
      addAudit(input, 'orders.summary.view', 'order', campaign.id, {
        totalOrders: summary.totalOrders,
        totalAmount: summary.totalAmount,
        containsPersonalData: true,
      });
      return clone(summary);
    },

    async exportCsv(input) {
      requireManager(input.role);
      const campaign = requireCampaign(input, input.orderId);
      const rows: OrderCsvRow[] = [];
      for (const entry of [...entries.values()]
        .filter(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.campaignId === campaign.id,
        )
        .sort(compareCreated)) {
        for (const line of entry.lines) {
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
        }
      }
      addAudit(input, 'orders.csv.export', 'order', campaign.id, {
        rowCount: rows.length,
        columns: [
          'orderId',
          'campaignTitle',
          'ordererName',
          'memberName',
          'productName',
          'amount',
          'paymentStatus',
        ],
        containsPersonalData: true,
      });
      return createOrdersCsv(rows);
    },

    async listAuditLogs(tenantId) {
      return audits.filter((audit) => audit.tenantId === tenantId).map(clone);
    },
  };
}

type PrismaOrdersOptions = {
  now?: () => Date;
  createId?: () => string;
  auditActor?: OrdersActor;
};

type PurchaseOrderRow = {
  id: string;
  tenant_id: string;
  title: string;
  deadline: Date;
  status: PurchaseCampaignStatus;
  created_at: Date;
};

type OrderProductRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  name: string;
  unit_price: bigint;
  image_url: string | null;
  options: unknown;
  requires_back_number: boolean;
  requires_back_name: boolean;
  created_at: Date;
};

type OrderEntryRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  orderer_user_id: string;
  orderer_name: string;
  member_id: string;
  member_name: string;
  total_amount: bigint;
  payment_status: PaymentStatus;
  payment_confirmed_at: Date | null;
  payment_confirmed_by: string | null;
  created_at: Date;
};

type OrderLineRow = {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: bigint;
  quantity: number;
  selected_options: unknown;
  back_number: string | null;
  back_name: string | null;
  amount: bigint;
};

type AuditRow = {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: unknown;
  created_at: Date;
};

type OrdersDatabaseClient = PrismaClient | Prisma.TransactionClient;

const orderProductColumns = Prisma.sql`
  id, tenant_id, order_id, name, unit_price, image_url, options,
  requires_back_number, requires_back_name, created_at
`;

async function setOrdersRlsContext(
  client: OrdersDatabaseClient,
  input: OrdersActor,
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.actorUserId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

// 所属変更と注文操作を同じtransaction内で直列化し、認証時のroleを再検証する。
async function assertOrdersActiveMembership(
  client: Prisma.TransactionClient,
  input: OrdersActor,
) {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${input.tenantId}:${input.actorUserId}`}, 0)
    )
  `;
  const rows = await client.$queryRaw<Array<{ role: string; status: string }>>`
    SELECT role::text AS role, status::text AS status
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.actorUserId}
    FOR SHARE
  `;
  const membership = rows[0];
  if (membership?.status !== 'active' || membership.role !== input.role)
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '有効な所属情報が処理中に変更されました。',
    );
}

function requireOrdersViewer(role: OrdersRole) {
  if (role === 'staff')
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '共同購買を閲覧する権限がありません。',
    );
}

function requireOrdersManager(role: OrdersRole) {
  if (!isOrdersManager(role))
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '共同購買の管理権限がありません。',
    );
}

function requireOrdersGuardian(role: OrdersRole) {
  if (role !== 'guardian')
    throw new OrdersRepositoryError(
      'FORBIDDEN',
      '保護者の注文権限がありません。',
    );
}

async function ordersTransaction<T>(
  client: PrismaClient,
  input: OrdersActor,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  try {
    return await client.$transaction(async (tx) => {
      await setOrdersRlsContext(tx, input);
      await assertOrdersActiveMembership(tx, input);
      return work(tx);
    });
  } catch (error) {
    throw mapOrdersDatabaseError(error);
  }
}

function mapOrdersDatabaseError(error: unknown): unknown {
  if (error instanceof OrdersRepositoryError) return error;
  if (error instanceof OrdersDomainError)
    return new OrdersRepositoryError('INVALID_INPUT', error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return new OrdersRepositoryError(
        'CONFLICT',
        '注文データが同時に変更されたため、再試行してください。',
      );
    if (error.code === 'P2025' || error.code === 'P2003')
      return new OrdersRepositoryError(
        'NOT_FOUND',
        '注文対象が見つかりません。',
      );
    if (error.code === 'P2010')
      return new OrdersRepositoryError(
        'CONFLICT',
        '注文データの状態または整合性が不正です。',
      );
  }
  return error;
}

function normalizeIdempotencyKey(key: string | null | undefined) {
  if (key == null || key === '') return null;
  if (typeof key !== 'string' || key.length > 128)
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      'Idempotency-Keyは128文字以内で指定してください。',
    );
  return key;
}

async function claimOrdersIdempotency(
  client: Prisma.TransactionClient,
  input: OrdersActor,
  key: string | null | undefined,
  request: unknown,
  resourceType: string,
  resourceId: string,
) {
  const normalizedKey = normalizeIdempotencyKey(key);
  if (!normalizedKey) return null;
  const requestHashValue = requestHash(request);
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`orders-idempotency:${input.tenantId}:${input.actorUserId}:${normalizedKey}`}, 0)
    )
  `;
  const previous = await client.$queryRaw<
    Array<{
      request_hash: string;
      resource_type: string;
      resource_id: string;
    }>
  >`
    SELECT request_hash, resource_type, resource_id
    FROM order_idempotency_keys
    WHERE tenant_id = ${input.tenantId}::uuid
      AND actor_user_id = ${input.actorUserId}
      AND idempotency_key = ${normalizedKey}
    FOR UPDATE
  `;
  const existing = previous[0];
  if (existing) {
    if (
      existing.request_hash !== requestHashValue ||
      existing.resource_type !== resourceType
    )
      throw new OrdersRepositoryError(
        'CONFLICT',
        '同じIdempotency-Keyで内容を変更できません。',
      );
    return existing.resource_id;
  }
  await client.$executeRaw`
    INSERT INTO order_idempotency_keys (
      id, tenant_id, actor_user_id, idempotency_key, request_hash,
      resource_type, resource_id
    ) VALUES (
      ${uuidv7()}::uuid,
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${normalizedKey},
      ${requestHashValue},
      ${resourceType},
      ${resourceId}::uuid
    )
  `;
  return null;
}

async function writeOrdersAudit(
  client: Prisma.TransactionClient,
  input: OrdersActor,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
) {
  await client.$executeRaw`
    INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
    ) VALUES (
      ${uuidv7()}::uuid,
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${action},
      ${resourceType},
      CAST(${resourceId} AS uuid),
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

function safeBigIntToNumber(value: bigint, label: string) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      `${label}がAPIの安全整数範囲を超えています。`,
    );
  return Number(value);
}

function numberToOrderBigInt(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new OrdersRepositoryError('INVALID_INPUT', `${label}が不正です。`);
  return BigInt(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredOptions(value: unknown): OrderProductInput['options'] {
  if (
    !Array.isArray(value) ||
    value.some(
      (option) =>
        !isRecord(option) ||
        !Array.isArray(option.values) ||
        option.values.some((item) => typeof item !== 'string'),
    )
  )
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '保存された商品の選択肢が不正です。',
    );
  return value as OrderProductInput['options'];
}

function parseSelectedOptions(value: unknown): Record<string, string> {
  if (
    !isRecord(value) ||
    Object.values(value).some((item) => typeof item !== 'string')
  )
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '保存された商品の選択値が不正です。',
    );
  return value as Record<string, string>;
}

function toOrderProduct(row: OrderProductRow): OrderProduct {
  const normalized = normalizeProduct({
    name: row.name,
    unitPrice: safeBigIntToNumber(row.unit_price, '単価'),
    imageUrl: row.image_url,
    options: parseStoredOptions(row.options),
    requiresBackNumber: row.requires_back_number,
    requiresBackName: row.requires_back_name,
  });
  return { ...normalized, id: row.id, campaignId: row.order_id };
}

async function findPurchaseOrder(
  client: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  forUpdate = false,
) {
  const rows = await client.$queryRaw<PurchaseOrderRow[]>(Prisma.sql`
    SELECT id, tenant_id, title, deadline, status::text AS status, created_at
    FROM purchase_orders
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${orderId}::uuid
    ${forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
  return rows[0] ?? null;
}

async function findOrderProducts(
  client: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
) {
  const rows = await client.$queryRaw<OrderProductRow[]>(Prisma.sql`
    SELECT ${orderProductColumns}
    FROM order_products
    WHERE tenant_id = ${tenantId}::uuid
      AND order_id = ${orderId}::uuid
    ORDER BY created_at ASC, id ASC
  `);
  return rows.map(toOrderProduct);
}

async function requirePurchaseCampaign(
  client: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  forUpdate = false,
) {
  const row = await findPurchaseOrder(client, tenantId, orderId, forUpdate);
  if (!row)
    throw new OrdersRepositoryError('NOT_FOUND', '募集案件が見つかりません。');
  return row;
}

async function toPurchaseCampaign(
  client: Prisma.TransactionClient,
  row: PurchaseOrderRow,
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    deadline: row.deadline.toISOString(),
    status: row.status,
    products: await findOrderProducts(client, row.tenant_id, row.id),
    createdAt: row.created_at.toISOString(),
  } satisfies PurchaseCampaign;
}

async function findOrderEntry(
  client: Prisma.TransactionClient,
  input: OrdersActor,
  orderId: string,
  entryId: string,
  forUpdate = false,
) {
  const guardianFilter =
    input.role === 'guardian'
      ? Prisma.sql`
        AND oe.orderer_user_id = ${input.actorUserId}
        AND EXISTS (
          SELECT 1
          FROM guardian_members gm
          WHERE gm.tenant_id = oe.tenant_id
            AND gm.user_id = ${input.actorUserId}
            AND gm.member_id = oe.member_id
        )
      `
      : Prisma.empty;
  const rows = await client.$queryRaw<OrderEntryRow[]>(Prisma.sql`
    SELECT
      oe.id, oe.tenant_id, oe.order_id, oe.orderer_user_id, oe.orderer_name,
      oe.member_id, m.name AS member_name, oe.total_amount,
      oe.payment_status::text AS payment_status,
      oe.payment_confirmed_at, oe.payment_confirmed_by, oe.created_at
    FROM order_entries oe
    JOIN members m
      ON m.tenant_id = oe.tenant_id
     AND m.id = oe.member_id
    WHERE oe.tenant_id = ${input.tenantId}::uuid
      AND oe.order_id = ${orderId}::uuid
      AND oe.id = ${entryId}::uuid
      ${guardianFilter}
    ${forUpdate ? Prisma.sql`FOR UPDATE OF oe` : Prisma.empty}
  `);
  return rows[0] ?? null;
}

async function findOrderLines(
  client: Prisma.TransactionClient,
  tenantId: string,
  entryId: string,
) {
  const rows = await client.$queryRaw<OrderLineRow[]>`
    SELECT id, product_id, product_name, unit_price, quantity,
           selected_options, back_number, back_name, amount
    FROM order_lines
    WHERE tenant_id = ${tenantId}::uuid
      AND order_entry_id = ${entryId}::uuid
    ORDER BY id ASC
  `;
  return rows.map(
    (row) =>
      ({
        id: row.id,
        productId: row.product_id,
        productName: row.product_name,
        unitPrice: safeBigIntToNumber(row.unit_price, '単価'),
        quantity: row.quantity,
        selectedOptions: parseSelectedOptions(row.selected_options),
        backNumber: row.back_number,
        backName: row.back_name,
        amount: safeBigIntToNumber(row.amount, '明細金額'),
      }) satisfies OrderLine,
  );
}

async function toOrderEntry(
  client: Prisma.TransactionClient,
  row: OrderEntryRow,
): Promise<OrderEntry> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    campaignId: row.order_id,
    ordererUserId: row.orderer_user_id,
    ordererName: row.orderer_name,
    memberId: row.member_id,
    memberName: row.member_name,
    lines: await findOrderLines(client, row.tenant_id, row.id),
    totalAmount: safeBigIntToNumber(row.total_amount, '注文合計'),
    paymentStatus: row.payment_status,
    paymentConfirmedAt: row.payment_confirmed_at?.toISOString() ?? null,
    paymentConfirmedBy: row.payment_confirmed_by,
    createdAt: row.created_at.toISOString(),
  };
}

async function findOrderEntries(
  client: Prisma.TransactionClient,
  input: OrdersActor & { orderId: string; paymentStatus?: PaymentStatus },
) {
  const guardianFilter =
    input.role === 'guardian'
      ? Prisma.sql`
        AND oe.orderer_user_id = ${input.actorUserId}
        AND EXISTS (
          SELECT 1
          FROM guardian_members gm
          WHERE gm.tenant_id = oe.tenant_id
            AND gm.user_id = ${input.actorUserId}
            AND gm.member_id = oe.member_id
        )
      `
      : Prisma.empty;
  const rows = await client.$queryRaw<OrderEntryRow[]>(Prisma.sql`
    SELECT
      oe.id, oe.tenant_id, oe.order_id, oe.orderer_user_id, oe.orderer_name,
      oe.member_id, m.name AS member_name, oe.total_amount,
      oe.payment_status::text AS payment_status,
      oe.payment_confirmed_at, oe.payment_confirmed_by, oe.created_at
    FROM order_entries oe
    JOIN members m
      ON m.tenant_id = oe.tenant_id
     AND m.id = oe.member_id
    WHERE oe.tenant_id = ${input.tenantId}::uuid
      AND oe.order_id = ${input.orderId}::uuid
      AND (${input.paymentStatus ?? null}::payment_status IS NULL
        OR oe.payment_status = ${input.paymentStatus ?? null}::payment_status)
      ${guardianFilter}
    ORDER BY oe.created_at ASC, oe.id ASC
  `);
  return Promise.all(rows.map((row) => toOrderEntry(client, row)));
}

async function requireAssignedActiveMember(
  client: Prisma.TransactionClient,
  input: OrdersActor,
  memberId: string,
) {
  const members = await client.$queryRaw<
    Array<{ id: string; name: string; status: string }>
  >`
    SELECT id, name, status::text AS status
    FROM members
    WHERE tenant_id = ${input.tenantId}::uuid
      AND id = ${memberId}::uuid
    FOR UPDATE
  `;
  const member = members[0];
  if (!member)
    throw new OrdersRepositoryError('NOT_FOUND', '対象部員が見つかりません。');
  if (member.status !== 'active')
    throw new OrdersRepositoryError(
      'CONFLICT',
      '停止または退部した部員は注文できません。',
    );
  if ((await findAuthorizedSubjectMember(client, input, memberId)) === null)
    throw new OrdersRepositoryError('NOT_FOUND', '対象部員が見つかりません。');
  return member;
}

function normalizeOrdererName(value: string) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 200)
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '注文者名は1〜200文字で入力してください。',
    );
  return name;
}

// 注文系の全DB操作をtransaction-local RLS contextの中で実行する永続adapter。
export function createPrismaOrdersRepository(
  client: PrismaClient,
  options: PrismaOrdersOptions = {},
): OrdersRepository {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? uuidv7;
  const auditActor = options.auditActor;

  return {
    listCampaigns: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersViewer(input.role);
        const rows = await tx.$queryRaw<PurchaseOrderRow[]>(Prisma.sql`
          SELECT id, tenant_id, title, deadline, status::text AS status, created_at
          FROM purchase_orders
          WHERE tenant_id = ${input.tenantId}::uuid
            AND (${input.status ?? null}::purchase_order_status IS NULL
              OR status = ${input.status ?? null}::purchase_order_status)
          ORDER BY created_at ASC, id ASC
        `);
        const campaigns = await Promise.all(
          rows.map((row) => toPurchaseCampaign(tx, row)),
        );
        await writeOrdersAudit(
          tx,
          input,
          'orders.campaign.list',
          'order',
          null,
          {
            status: input.status ?? null,
          },
        );
        return campaigns;
      }),

    getCampaign: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersViewer(input.role);
        const row = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          input.orderId,
        );
        const campaign = await toPurchaseCampaign(tx, row);
        await writeOrdersAudit(
          tx,
          input,
          'orders.campaign.view',
          'order',
          row.id,
          {
            containsPersonalData: false,
          },
        );
        return campaign;
      }),

    createCampaign: (input, value) => {
      const normalized = normalizeCampaign(value);
      if (Date.parse(normalized.deadline) <= now().getTime())
        throw new OrdersRepositoryError(
          'INVALID_INPUT',
          '注文締切は現在より後に設定してください。',
        );
      return ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        const orderId = createId();
        const replayId = await claimOrdersIdempotency(
          tx,
          input,
          input.idempotencyKey,
          normalized,
          'order',
          orderId,
        );
        if (replayId) {
          const replay = await findPurchaseOrder(tx, input.tenantId, replayId);
          if (!replay)
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toPurchaseCampaign(tx, replay);
        }
        await tx.$executeRaw`
          INSERT INTO purchase_orders (id, tenant_id, title, deadline, status)
          VALUES (
            ${orderId}::uuid,
            ${input.tenantId}::uuid,
            ${normalized.title},
            ${new Date(normalized.deadline)},
            'open'::purchase_order_status
          )
        `;
        for (const product of normalized.products) {
          const productId = createId();
          await tx.$executeRaw`
            INSERT INTO order_products (
              id, tenant_id, order_id, name, unit_price, image_url, options,
              requires_back_number, requires_back_name
            ) VALUES (
              ${productId}::uuid,
              ${input.tenantId}::uuid,
              ${orderId}::uuid,
              ${product.name},
              ${numberToOrderBigInt(product.unitPrice, '単価')},
              ${product.imageUrl},
              ${JSON.stringify(product.options)}::jsonb,
              ${product.requiresBackNumber},
              ${product.requiresBackName}
            )
          `;
        }
        const row = await requirePurchaseCampaign(tx, input.tenantId, orderId);
        await writeOrdersAudit(
          tx,
          input,
          'orders.campaign.create',
          'order',
          orderId,
          {
            productCount: normalized.products.length,
            deadline: normalized.deadline,
          },
        );
        return toPurchaseCampaign(tx, row);
      });
    },

    addProduct: (input, value) => {
      const normalized = normalizeProduct(value);
      return ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        const campaign = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          input.orderId,
          true,
        );
        if (campaign.status !== 'open')
          throw new OrdersRepositoryError(
            'CONFLICT',
            '締切済みの募集案件は変更できません。',
          );
        const productId = createId();
        const replayId = await claimOrdersIdempotency(
          tx,
          input,
          input.idempotencyKey,
          { orderId: input.orderId, product: normalized },
          'order_product',
          productId,
        );
        if (replayId) {
          const replayRows = await tx.$queryRaw<OrderProductRow[]>(Prisma.sql`
            SELECT ${orderProductColumns}
            FROM order_products
            WHERE tenant_id = ${input.tenantId}::uuid
              AND order_id = ${input.orderId}::uuid
              AND id = ${replayId}::uuid
          `);
          if (!replayRows[0])
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toOrderProduct(replayRows[0]);
        }
        await tx.$executeRaw`
          INSERT INTO order_products (
            id, tenant_id, order_id, name, unit_price, image_url, options,
            requires_back_number, requires_back_name
          ) VALUES (
            ${productId}::uuid,
            ${input.tenantId}::uuid,
            ${input.orderId}::uuid,
            ${normalized.name},
            ${numberToOrderBigInt(normalized.unitPrice, '単価')},
            ${normalized.imageUrl},
            ${JSON.stringify(normalized.options)}::jsonb,
            ${normalized.requiresBackNumber},
            ${normalized.requiresBackName}
          )
        `;
        const products = await findOrderProducts(
          tx,
          input.tenantId,
          input.orderId,
        );
        const product = products.find(
          (candidate) => candidate.id === productId,
        );
        if (!product) throw new Error('商品の登録に失敗しました。');
        await writeOrdersAudit(
          tx,
          input,
          'orders.product.create',
          'order_product',
          productId,
          { orderId: input.orderId, optionCount: product.options.length },
        );
        return product;
      });
    },

    updateCampaignStatus: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        const campaign = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          input.orderId,
          true,
        );
        const replayId = await claimOrdersIdempotency(
          tx,
          input,
          input.idempotencyKey,
          { orderId: input.orderId, status: input.status },
          'order',
          campaign.id,
        );
        if (replayId) {
          const replay = await requirePurchaseCampaign(
            tx,
            input.tenantId,
            replayId,
          );
          return toPurchaseCampaign(tx, replay);
        }
        let nextStatus: PurchaseCampaignStatus;
        try {
          nextStatus = transitionCampaignStatus(campaign.status, input.status);
        } catch (error) {
          throw mapOrdersDatabaseError(error);
        }
        await tx.$executeRaw`
          UPDATE purchase_orders
          SET status = ${nextStatus}::purchase_order_status
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${campaign.id}::uuid
        `;
        const updated = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          campaign.id,
        );
        await writeOrdersAudit(
          tx,
          input,
          'orders.campaign.status.update',
          'order',
          campaign.id,
          { previousStatus: campaign.status, nextStatus },
        );
        return toPurchaseCampaign(tx, updated);
      }),

    createEntry: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersGuardian(input.role);
        const campaign = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          input.orderId,
        );
        if (
          campaign.status !== 'open' ||
          campaign.deadline.getTime() <= now().getTime()
        )
          throw new OrdersRepositoryError(
            'CONFLICT',
            '募集案件が注文を受け付けていません。',
          );
        const member = await requireAssignedActiveMember(
          tx,
          input,
          input.entry.memberId,
        );
        const products = await findOrderProducts(
          tx,
          input.tenantId,
          input.orderId,
        );
        const normalizedLines: OrderLine[] = input.entry.lines.map((line) => {
          const product = products.find(
            (candidate) => candidate.id === line.productId,
          );
          if (!product)
            throw new OrdersRepositoryError(
              'NOT_FOUND',
              '募集案件に属さない商品です。',
            );
          try {
            const selection = validateOrderSelection(product, line);
            return {
              id: createId(),
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
        const ordererName = normalizeOrdererName(input.entry.ordererName);
        const normalized = {
          memberId: member.id,
          ordererName,
          lines: normalizedLines.map(({ id: _id, ...line }) => line),
        };
        const entryId = createId();
        const replayId = await claimOrdersIdempotency(
          tx,
          input,
          input.idempotencyKey,
          normalized,
          'order_entry',
          entryId,
        );
        if (replayId) {
          const replay = await findOrderEntry(
            tx,
            input,
            input.orderId,
            replayId,
          );
          if (!replay)
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toOrderEntry(tx, replay);
        }
        const totalAmount = calculateOrderTotal(normalizedLines);
        await tx.$executeRaw`
          INSERT INTO order_entries (
            id, tenant_id, order_id, orderer_user_id, orderer_name,
            member_id, total_amount, payment_status
          ) VALUES (
            ${entryId}::uuid,
            ${input.tenantId}::uuid,
            ${input.orderId}::uuid,
            ${input.actorUserId},
            ${ordererName},
            ${member.id}::uuid,
            ${numberToOrderBigInt(totalAmount, '注文合計')},
            'unpaid'::payment_status
          )
        `;
        for (const line of normalizedLines) {
          await tx.$executeRaw`
            INSERT INTO order_lines (
              id, tenant_id, order_entry_id, product_id, product_name,
              unit_price, quantity, selected_options, back_number, back_name, amount
            ) VALUES (
              ${line.id}::uuid,
              ${input.tenantId}::uuid,
              ${entryId}::uuid,
              ${line.productId}::uuid,
              ${line.productName},
              ${numberToOrderBigInt(line.unitPrice, '単価')},
              ${line.quantity},
              ${JSON.stringify(line.selectedOptions)}::jsonb,
              ${line.backNumber},
              ${line.backName},
              ${numberToOrderBigInt(line.amount, '明細金額')}
            )
          `;
        }
        const row = await findOrderEntry(tx, input, input.orderId, entryId);
        if (!row) throw new Error('注文の登録に失敗しました。');
        await writeOrdersAudit(
          tx,
          input,
          'orders.entry.create',
          'order_entry',
          entryId,
          {
            orderId: input.orderId,
            subjectMemberId: member.id,
            lineCount: normalizedLines.length,
            totalAmount,
            personalDataFields: [
              'ordererName',
              'subjectMemberId',
              'memberName',
              'backName',
            ],
          },
        );
        return toOrderEntry(tx, row);
      }),

    listEntries: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersViewer(input.role);
        await requirePurchaseCampaign(tx, input.tenantId, input.orderId);
        const entries = await findOrderEntries(tx, input);
        await writeOrdersAudit(
          tx,
          input,
          'orders.entry.view',
          'order_entry',
          input.orderId,
          {
            scope: input.role === 'guardian' ? 'self' : 'tenant',
            containsPersonalData: true,
          },
        );
        return entries;
      }),

    updatePayment: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        await requirePurchaseCampaign(tx, input.tenantId, input.orderId);
        const entry = await findOrderEntry(
          tx,
          input,
          input.orderId,
          input.entryId,
          true,
        );
        if (!entry)
          throw new OrdersRepositoryError(
            'NOT_FOUND',
            '注文明細が見つかりません。',
          );
        const replayId = await claimOrdersIdempotency(
          tx,
          input,
          input.idempotencyKey,
          {
            orderId: input.orderId,
            entryId: input.entryId,
            status: input.status,
          },
          'order_entry',
          entry.id,
        );
        if (replayId) {
          const replay = await findOrderEntry(
            tx,
            input,
            input.orderId,
            replayId,
          );
          if (!replay)
            throw new OrdersRepositoryError(
              'CONFLICT',
              '冪等キーの結果を復元できません。',
            );
          return toOrderEntry(tx, replay);
        }
        const confirmedAt = input.status === 'paid' ? now() : null;
        await tx.$executeRaw`
          UPDATE order_entries
          SET payment_status = ${input.status}::payment_status,
              payment_confirmed_at = ${confirmedAt},
              payment_confirmed_by = ${input.status === 'paid' ? input.actorUserId : null}
          WHERE tenant_id = ${input.tenantId}::uuid
            AND order_id = ${input.orderId}::uuid
            AND id = ${entry.id}::uuid
        `;
        const updated = await findOrderEntry(
          tx,
          input,
          input.orderId,
          entry.id,
        );
        if (!updated) throw new Error('支払状態の更新に失敗しました。');
        await writeOrdersAudit(
          tx,
          input,
          'orders.payment.update',
          'order_entry',
          entry.id,
          {
            orderId: input.orderId,
            previousStatus: entry.payment_status,
            nextStatus: input.status,
            totalAmount: safeBigIntToNumber(entry.total_amount, '注文合計'),
            personalDataFields: ['subjectMemberId', 'ordererName'],
          },
        );
        return toOrderEntry(tx, updated);
      }),

    summarize: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        await requirePurchaseCampaign(tx, input.tenantId, input.orderId);
        const entries = await findOrderEntries(tx, {
          ...input,
        });
        const summary = summarizeOrders(entries);
        await writeOrdersAudit(
          tx,
          input,
          'orders.summary.view',
          'order',
          input.orderId,
          {
            totalOrders: summary.totalOrders,
            totalAmount: summary.totalAmount,
            containsPersonalData: true,
          },
        );
        return summary;
      }),

    exportCsv: (input) =>
      ordersTransaction(client, input, async (tx) => {
        requireOrdersManager(input.role);
        const campaign = await requirePurchaseCampaign(
          tx,
          input.tenantId,
          input.orderId,
        );
        const campaignRecord = await toPurchaseCampaign(tx, campaign);
        const entries = await findOrderEntries(tx, { ...input });
        const rows: OrderCsvRow[] = [];
        for (const entry of entries)
          for (const line of entry.lines)
            rows.push({
              orderId: entry.id,
              campaignTitle: campaignRecord.title,
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
        await writeOrdersAudit(
          tx,
          input,
          'orders.csv.export',
          'order',
          campaign.id,
          {
            rowCount: rows.length,
            columns: [
              'orderId',
              'campaignTitle',
              'ordererName',
              'memberName',
              'productName',
              'amount',
              'paymentStatus',
            ],
            containsPersonalData: true,
          },
        );
        return createOrdersCsv(rows);
      }),

    listAuditLogs: (tenantId) => {
      if (!auditActor || auditActor.tenantId !== tenantId)
        return Promise.reject(
          new OrdersRepositoryError(
            'FORBIDDEN',
            '監査ログ参照には認証済みのactor contextが必要です。',
          ),
        );
      return ordersTransaction(client, auditActor, async (tx) => {
        if (auditActor.role !== 'owner')
          throw new OrdersRepositoryError(
            'FORBIDDEN',
            '監査ログを閲覧できる権限がありません。',
          );
        const rows = await tx.$queryRaw<AuditRow[]>`
          SELECT id, tenant_id, actor_user_id, action, resource_type,
                 resource_id, metadata, created_at
          FROM audit_logs
          WHERE tenant_id = ${tenantId}::uuid
          ORDER BY created_at ASC, id ASC
        `;
        return rows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          actorUserId: row.actor_user_id,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          metadata: isRecord(row.metadata) ? row.metadata : {},
          createdAt: row.created_at.toISOString(),
        }));
      });
    },
  };
}

function normalizeCampaign(value: OrderCampaignInput) {
  if (
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.trim().length > 200
  )
    throw new OrdersRepositoryError(
      'INVALID_INPUT',
      '募集案件名は1〜200文字で入力してください。',
    );
  if (!Number.isFinite(Date.parse(value.deadline)))
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
    deadline: new Date(value.deadline).toISOString(),
    products: value.products.map(normalizeProduct),
  };
}

function normalizeProduct(
  value: OrderProductInput,
): Omit<OrderProduct, 'id' | 'campaignId'> {
  try {
    return validateProduct(value);
  } catch (error) {
    if (error instanceof OrdersDomainError)
      throw new OrdersRepositoryError('INVALID_INPUT', error.message);
    throw error;
  }
}

function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compareCreated(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
) {
  return `${left.createdAt}:${left.id}`.localeCompare(
    `${right.createdAt}:${right.id}`,
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
