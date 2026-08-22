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
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type BoardContactPublicRecord = {
  id: string;
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  contactPreference: ContactPreference;
  assigneeUserId?: string;
  lineContact?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
};

export type BoardContactSlot = {
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId: string | null;
  lineContact: string | null;
  phone: string | null;
  contactPreference: ContactPreference;
};

export function isBoardContactManagerRole(
  role: BoardContactViewerRole,
): role is 'owner' | 'admin' {
  return role === 'owner' || role === 'admin';
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

// 連絡先はowner/adminの要求時だけ表示設定に従って投影し、他の役割には役職枠だけを返す。
export function projectBoardContact(
  contact: BoardContactRecord,
  viewerRole: BoardContactViewerRole,
): BoardContactPublicRecord {
  const projected: BoardContactPublicRecord = {
    id: contact.id,
    fiscalYear: contact.fiscalYear,
    roleName: contact.roleName,
    roleType: contact.roleType,
    contactPreference: contact.contactPreference,
    createdAt: isoDate(contact.createdAt),
    updatedAt: isoDate(contact.updatedAt),
  };

  if (!isBoardContactManagerRole(viewerRole)) return projected;

  if (contact.assigneeUserId) projected.assigneeUserId = contact.assigneeUserId;
  if (
    (contact.contactPreference === 'line' ||
      contact.contactPreference === 'both') &&
    contact.lineContact
  )
    projected.lineContact = contact.lineContact;
  if (
    (contact.contactPreference === 'phone' ||
      contact.contactPreference === 'both') &&
    contact.phone
  )
    projected.phone = contact.phone;

  return projected;
}

// 年度引き継ぎは役職枠だけを再利用し、担当者・LINE・電話番号を初期化する。
export function copyBoardContactSlot(
  source: BoardContactRecord,
  toFiscalYear: number,
): BoardContactSlot {
  return {
    fiscalYear: toFiscalYear,
    roleName: source.roleName,
    roleType: source.roleType,
    assigneeUserId: null,
    lineContact: null,
    phone: null,
    contactPreference: 'line',
  };
}

// 監査には変更の有無だけを残し、電話番号・LINE識別子・担当者IDを保存しない。
export function boardContactAuditMetadata(input: {
  fiscalYear: number;
  roleType: BoardContactRoleType;
  contactPreference: ContactPreference;
  assigneeUserId?: string | null;
  lineContact?: string | null;
  phone?: string | null;
}) {
  return {
    fiscalYear: input.fiscalYear,
    roleType: input.roleType,
    contactPreference: input.contactPreference,
    hasAssignee: Boolean(input.assigneeUserId),
    hasLineContact: Boolean(input.lineContact),
    hasPhone: Boolean(input.phone),
  };
}
