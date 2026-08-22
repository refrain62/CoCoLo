import type { MemberRole } from '@cocolo/contracts/member';

export const lineManagerRoles = new Set<MemberRole>(['owner', 'admin']);
export const lineNotificationRoles = new Set<MemberRole>([
  'owner',
  'admin',
  'staff',
]);

export function canManageLineConnection(role: MemberRole): boolean {
  return lineManagerRoles.has(role);
}

export function canEnqueueLineNotification(role: MemberRole): boolean {
  return lineNotificationRoles.has(role);
}
