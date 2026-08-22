export class BoardContactValidationError extends Error {
  readonly details: unknown;

  constructor(message: string, details: unknown = {}) {
    super(message);
    this.name = 'BoardContactValidationError';
    this.details = details;
  }
}

export type BoardContactRoleType = 'admin' | 'staff' | 'member';
export type ContactPreference = 'line' | 'phone' | 'both';

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

export type BoardContactListQuery = { fiscalYear?: number };

export type CopyBoardContactYearInput = {
  fromFiscalYear: number;
  toFiscalYear: number;
};

const allowedCreateKeys = new Set([
  'fiscalYear',
  'roleName',
  'roleType',
  'assigneeUserId',
  'lineContact',
  'phone',
  'contactPreference',
]);

const allowedPatchKeys = new Set(allowedCreateKeys);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
) {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0)
    throw new BoardContactValidationError('入力値が不正です。', {
      unrecognizedKeys: unknownKeys,
    });
}

function readFiscalYear(value: unknown, fieldName: string): number {
  const year =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new BoardContactValidationError('年度が不正です。', {
      [fieldName]: '2000〜2100の整数を指定してください。',
    });
  return year;
}

function readRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  if (typeof value !== 'string')
    throw new BoardContactValidationError('入力値が不正です。', {
      [fieldName]: '文字列を指定してください。',
    });
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    throw new BoardContactValidationError('入力値が不正です。', {
      [fieldName]: `1〜${maxLength}文字で指定してください。`,
    });
  return normalized;
}

function readNullableString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  pattern?: RegExp,
) {
  if (value === null) return null;
  const normalized = readRequiredString(value, fieldName, maxLength);
  if (pattern && !pattern.test(normalized))
    throw new BoardContactValidationError('入力値が不正です。', {
      [fieldName]: '使用できない文字が含まれています。',
    });
  return normalized;
}

function readOptionalNullableString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  pattern?: RegExp,
) {
  if (value === undefined) return undefined;
  return readNullableString(value, fieldName, maxLength, pattern);
}

function readRoleType(value: unknown): BoardContactRoleType {
  if (value !== 'admin' && value !== 'staff' && value !== 'member')
    throw new BoardContactValidationError('役職種別が不正です。');
  return value;
}

function readContactPreference(value: unknown): ContactPreference {
  if (value !== 'line' && value !== 'phone' && value !== 'both')
    throw new BoardContactValidationError('連絡先表示設定が不正です。');
  return value;
}

const phonePattern = /^[0-9+().\-\s]+$/;

export function parseBoardContactCreateInput(
  input: unknown,
): BoardContactCreateInput {
  if (!isRecord(input))
    throw new BoardContactValidationError('JSON入力が不正です。');
  rejectUnknownKeys(input, allowedCreateKeys);
  return {
    fiscalYear: readFiscalYear(input.fiscalYear, 'fiscalYear'),
    roleName: readRequiredString(input.roleName, 'roleName', 100),
    roleType: readRoleType(input.roleType),
    assigneeUserId: readOptionalNullableString(
      input.assigneeUserId,
      'assigneeUserId',
      128,
    ),
    lineContact: readOptionalNullableString(
      input.lineContact,
      'lineContact',
      200,
    ),
    phone: readOptionalNullableString(input.phone, 'phone', 32, phonePattern),
    contactPreference:
      input.contactPreference === undefined
        ? 'line'
        : readContactPreference(input.contactPreference),
  };
}

export function parseBoardContactPatchInput(
  input: unknown,
): BoardContactPatchInput {
  if (!isRecord(input))
    throw new BoardContactValidationError('JSON入力が不正です。');
  rejectUnknownKeys(input, allowedPatchKeys);
  if (Object.keys(input).length === 0)
    throw new BoardContactValidationError(
      '更新項目を1つ以上指定してください。',
    );

  const output: BoardContactPatchInput = {};
  if ('fiscalYear' in input)
    output.fiscalYear = readFiscalYear(input.fiscalYear, 'fiscalYear');
  if ('roleName' in input)
    output.roleName = readRequiredString(input.roleName, 'roleName', 100);
  if ('roleType' in input) output.roleType = readRoleType(input.roleType);
  if ('assigneeUserId' in input)
    output.assigneeUserId = readNullableString(
      input.assigneeUserId,
      'assigneeUserId',
      128,
    );
  if ('lineContact' in input)
    output.lineContact = readNullableString(
      input.lineContact,
      'lineContact',
      200,
    );
  if ('phone' in input)
    output.phone = readNullableString(input.phone, 'phone', 32, phonePattern);
  if ('contactPreference' in input)
    output.contactPreference = readContactPreference(input.contactPreference);
  return output;
}

export function parseBoardContactListQuery(
  query: Record<string, string>,
): BoardContactListQuery {
  const unknownKeys = Object.keys(query).filter((key) => key !== 'fiscalYear');
  if (unknownKeys.length > 0)
    throw new BoardContactValidationError('入力値が不正です。', {
      unrecognizedKeys: unknownKeys,
    });
  return query.fiscalYear === undefined
    ? {}
    : { fiscalYear: readFiscalYear(query.fiscalYear, 'fiscalYear') };
}

export function parseCopyBoardContactYearInput(
  input: unknown,
): CopyBoardContactYearInput {
  if (!isRecord(input))
    throw new BoardContactValidationError('JSON入力が不正です。');
  const keys = new Set(['fromFiscalYear', 'toFiscalYear']);
  rejectUnknownKeys(input, keys);
  const fromFiscalYear = readFiscalYear(input.fromFiscalYear, 'fromFiscalYear');
  const toFiscalYear = readFiscalYear(input.toFiscalYear, 'toFiscalYear');
  if (fromFiscalYear === toFiscalYear)
    throw new BoardContactValidationError(
      '引き継ぎ元と引き継ぎ先の年度は異なる必要があります。',
    );
  return { fromFiscalYear, toFiscalYear };
}

export function parseBoardContactId(value: string) {
  const id = value.trim();
  if (
    !/^\b[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(
      id,
    )
  )
    throw new BoardContactValidationError('役員IDが不正です。');
  return id;
}
