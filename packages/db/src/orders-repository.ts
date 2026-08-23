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

/**
 * 注文系テーブルを追加する前でも、APIと認可境界を実行できる分離adapter。
 * Prisma schemaへモデルを追加する段階では、このrepositoryのメソッド契約をSQL adapterへ移す。
 */
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
        memberId: member.id,
        lineCount: entry.lines.length,
        totalAmount: entry.totalAmount,
        personalDataFields: [
          'ordererName',
          'memberId',
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
        personalDataFields: ['memberId', 'ordererName'],
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
      const summary = summarizeOrders(campaignEntries);
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
