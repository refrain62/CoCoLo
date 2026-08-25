import type { Prisma } from '@prisma/client';

export type SubjectMemberRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type SubjectMemberActor = {
  tenantId: string;
  actorUserId: string;
  role: SubjectMemberRole;
};

// actorとsubjectの組み合わせを同一transaction内で再認可する。対象memberの存在も隠すため、失敗時はnullだけを返す。
export async function findAuthorizedSubjectMember(
  client: Prisma.TransactionClient,
  actor: SubjectMemberActor,
  subjectMemberId: string,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT m.id
      FROM members m
     WHERE m.tenant_id = ${actor.tenantId}::uuid
       AND m.id = ${subjectMemberId}::uuid
       AND m.status = 'active'::member_status
       AND (
         ${actor.role} <> 'guardian'
         OR EXISTS (
           SELECT 1
            FROM guardian_members gm
            WHERE gm.tenant_id = ${actor.tenantId}::uuid
              AND gm.user_id = ${actor.actorUserId}
              AND gm.member_id = m.id
              AND gm.status = 'active'::member_link_status
         )
       )
     LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
