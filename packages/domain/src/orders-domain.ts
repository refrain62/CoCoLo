export type OrdersRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type PurchaseCampaignStatus = 'open' | 'closed' | 'completed';
export type PaymentStatus = 'unpaid' | 'paid';

export type OrderOption = {
  name: string;
  values: string[];
};

export type OrderProduct = {
  id: string;
  campaignId: string;
  name: string;
  unitPrice: number;
  imageUrl: string | null;
  options: OrderOption[];
  requiresBackNumber: boolean;
  requiresBackName: boolean;
};

export type PurchaseCampaign = {
  id: string;
  tenantId: string;
  title: string;
  deadline: string;
  status: PurchaseCampaignStatus;
  products: OrderProduct[];
  createdAt: string;
};

export type OrderLine = {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  selectedOptions: Record<string, string>;
  backNumber: string | null;
  backName: string | null;
  amount: number;
};

export type OrderEntry = {
  id: string;
  tenantId: string;
  campaignId: string;
  ordererUserId: string;
  ordererName: string;
  memberId: string;
  memberName: string;
  lines: OrderLine[];
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: string | null;
  createdAt: string;
};

export type OrdersSummary = {
  totalOrders: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  byProduct: Array<{
    productId: string;
    productName: string;
    selectedOptions: Record<string, string>;
    quantity: number;
    amount: number;
  }>;
  unpaid: Array<{
    entryId: string;
    ordererName: string;
    memberName: string;
    amount: number;
  }>;
};

export type OrderCsvRow = {
  orderId: string;
  campaignTitle: string;
  ordererName: string;
  memberName: string;
  productName: string;
  selectedOptions: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  paymentStatus: string;
  paymentConfirmedAt: string;
};

export class OrdersDomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'INVALID_STATE'
      | 'CONFLICT',
  ) {
    super(message);
    this.name = 'OrdersDomainError';
  }
}

export function isOrdersManager(role: OrdersRole) {
  return role === 'owner' || role === 'admin';
}

export function calculateLineAmount(unitPrice: number, quantity: number) {
  assertMoney(unitPrice, '単価');
  assertQuantity(quantity);
  const amount = unitPrice * quantity;
  if (!Number.isSafeInteger(amount))
    throw new OrdersDomainError('明細金額が上限を超えています。', 'INVALID_INPUT');
  return amount;
}

export function calculateOrderTotal(lines: Array<Pick<OrderLine, 'amount'>>) {
  const total = lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.amount) || line.amount < 0)
      throw new OrdersDomainError('明細金額が不正です。', 'INVALID_INPUT');
    const next = sum + line.amount;
    if (!Number.isSafeInteger(next))
      throw new OrdersDomainError('注文金額が上限を超えています。', 'INVALID_INPUT');
    return next;
  }, 0);
  return total;
}

export function validateProduct(product: {
  name: string;
  unitPrice: number;
  options: OrderOption[];
  imageUrl?: string | null;
  requiresBackNumber?: boolean;
  requiresBackName?: boolean;
}) {
  const name = requireText(product.name, '商品名', 200);
  assertMoney(product.unitPrice, '単価');
  if (!Array.isArray(product.options) || product.options.length > 20)
    throw new OrdersDomainError('商品の選択肢が多すぎます。', 'INVALID_INPUT');

  const optionNames = new Set<string>();
  const options = product.options.map((option) => {
    const optionName = requireText(option.name, '選択肢名', 100);
    if (optionNames.has(optionName))
      throw new OrdersDomainError('同じ選択肢名を重複登録できません。', 'INVALID_INPUT');
    optionNames.add(optionName);
    if (!Array.isArray(option.values) || option.values.length === 0)
      throw new OrdersDomainError('選択肢には値を1つ以上登録してください。', 'INVALID_INPUT');
    const values = option.values.map((value) => requireText(value, '選択肢の値', 100));
    if (new Set(values).size !== values.length)
      throw new OrdersDomainError('選択肢の値を重複登録できません。', 'INVALID_INPUT');
    return { name: optionName, values };
  });

  return {
    name,
    unitPrice: product.unitPrice,
    options,
    imageUrl: product.imageUrl ?? null,
    requiresBackNumber: product.requiresBackNumber ?? false,
    requiresBackName: product.requiresBackName ?? false,
  };
}

export function validateOrderSelection(
  product: Pick<OrderProduct, 'options' | 'requiresBackNumber' | 'requiresBackName'>,
  input: {
    quantity: number;
    selectedOptions?: Record<string, string>;
    backNumber?: string | null;
    backName?: string | null;
  },
) {
  assertQuantity(input.quantity);
  const selectedOptions = input.selectedOptions ?? {};
  const registeredOptions = new Map(product.options.map((option) => [option.name, option.values]));
  for (const [name, value] of Object.entries(selectedOptions)) {
    const values = registeredOptions.get(name);
    if (!values || !values.includes(value))
      throw new OrdersDomainError('登録済みでない選択肢は指定できません。', 'INVALID_INPUT');
  }
  for (const option of product.options) {
    if (!selectedOptions[option.name])
      throw new OrdersDomainError(`選択肢「${option.name}」を指定してください。`, 'INVALID_INPUT');
  }

  const backNumber = input.backNumber == null ? null : requireText(input.backNumber, '背番号', 20);
  const backName = input.backName == null ? null : requireText(input.backName, '背ネーム', 40);
  if (product.requiresBackNumber && !backNumber)
    throw new OrdersDomainError('背番号を入力してください。', 'INVALID_INPUT');
  if (product.requiresBackName && !backName)
    throw new OrdersDomainError('背ネームを入力してください。', 'INVALID_INPUT');
  if (!product.requiresBackNumber && backNumber)
    throw new OrdersDomainError('この商品では背番号を指定できません。', 'INVALID_INPUT');
  if (!product.requiresBackName && backName)
    throw new OrdersDomainError('この商品では背ネームを指定できません。', 'INVALID_INPUT');

  return { selectedOptions: { ...selectedOptions }, backNumber, backName };
}

export function transitionCampaignStatus(
  current: PurchaseCampaignStatus,
  next: PurchaseCampaignStatus,
) {
  const allowed =
    (current === 'open' && next === 'closed') ||
    (current === 'closed' && next === 'completed');
  if (!allowed)
    throw new OrdersDomainError('募集案件の状態遷移が不正です。', 'INVALID_STATE');
  return next;
}

export function summarizeOrders(entries: OrderEntry[]): OrdersSummary {
  const byProduct = new Map<string, OrdersSummary['byProduct'][number]>();
  let totalAmount = 0;
  let paidAmount = 0;
  const unpaid: OrdersSummary['unpaid'] = [];
  for (const entry of entries) {
    totalAmount += entry.totalAmount;
    if (entry.paymentStatus === 'paid') paidAmount += entry.totalAmount;
    else
      unpaid.push({
        entryId: entry.id,
        ordererName: entry.ordererName,
        memberName: entry.memberName,
        amount: entry.totalAmount,
      });
    for (const line of entry.lines) {
      const optionKey = JSON.stringify(line.selectedOptions);
      const key = `${line.productId}:${optionKey}`;
      const current = byProduct.get(key);
      if (current) {
        current.quantity += line.quantity;
        current.amount += line.amount;
      } else {
        byProduct.set(key, {
          productId: line.productId,
          productName: line.productName,
          selectedOptions: { ...line.selectedOptions },
          quantity: line.quantity,
          amount: line.amount,
        });
      }
    }
  }
  return {
    totalOrders: entries.length,
    totalAmount,
    paidAmount,
    unpaidAmount: totalAmount - paidAmount,
    byProduct: [...byProduct.values()],
    unpaid,
  };
}

export function createOrdersCsv(rows: OrderCsvRow[]) {
  const header = [
    '注文ID',
    '募集案件名',
    '注文者名',
    '対象部員名',
    '商品名',
    '選択肢',
    '数量',
    '単価',
    '金額',
    '支払状態',
    '支払確認日時',
  ];
  const lines = [header, ...rows.map((row) => [
    row.orderId,
    row.campaignTitle,
    row.ordererName,
    row.memberName,
    row.productName,
    row.selectedOptions,
    row.quantity,
    row.unitPrice,
    row.amount,
    row.paymentStatus,
    row.paymentConfirmedAt,
  ])];
  // CSVは表計算ソフトで開かれるため、式に解釈される先頭文字を文字列化する。
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\n')}\n`;
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function requireText(value: string, label: string, maxLength: number) {
  if (typeof value !== 'string')
    throw new OrdersDomainError(`${label}が不正です。`, 'INVALID_INPUT');
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength)
    throw new OrdersDomainError(`${label}は1〜${maxLength}文字で入力してください。`, 'INVALID_INPUT');
  return text;
}

function assertMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)
    throw new OrdersDomainError(`${label}は0〜1000000000円の整数で入力してください。`, 'INVALID_INPUT');
}

function assertQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000)
    throw new OrdersDomainError('数量は1〜10000の整数で入力してください。', 'INVALID_INPUT');
}
