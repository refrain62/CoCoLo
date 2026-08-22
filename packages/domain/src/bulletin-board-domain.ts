export type BulletinBoardRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type AnnouncementStatus = 'published' | 'archived';

export type BulletinAttachmentMetadata = {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  byteSize: number;
};

export type AnnouncementRecord = {
  id: string;
  tenantId: string;
  authorUserId: string;
  title: string;
  body: string;
  status: AnnouncementStatus;
  publishedAt: Date;
  attachments: BulletinAttachmentMetadata[];
  readAt: Date | null;
};

export type AnnouncementSummary = {
  id: string;
  title: string;
  status: AnnouncementStatus;
  publishedAt: Date;
  attachmentCount: number;
  readAt: Date | null;
  isAuthor: boolean;
};

export type UnreadMember = {
  userId: string;
  role: BulletinBoardRole;
};

// 掲載操作は管理系三役に限定し、guardianへ権限を暗黙付与しない。
export function canPublishAnnouncement(role: BulletinBoardRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

// 未読者一覧は掲載者本人だけが見られる。役割ではなく発行者IDで判定する。
export function canViewUnreadMembers(
  actorUserId: string,
  authorUserId: string,
): boolean {
  return actorUserId === authorUserId;
}

// 公開済みだけを利用者へ表示し、将来のアーカイブ状態を誤って既読扱いにしない。
export function canReadAnnouncement(status: AnnouncementStatus): boolean {
  return status === 'published';
}
