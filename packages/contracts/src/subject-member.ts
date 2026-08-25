import { z } from 'zod';

export const subjectMemberIdFields = {
  // memberIdは既存client互換の別名。新規clientはsubjectMemberIdを使う。
  memberId: z.string().uuid().optional(),
  subjectMemberId: z.string().uuid().optional(),
};

export type SubjectMemberSelection = {
  memberId?: string;
  subjectMemberId?: string;
};

export function requireExactlyOneSubjectMemberId(
  value: SubjectMemberSelection,
  context: z.RefinementCtx,
) {
  if (Boolean(value.memberId) === Boolean(value.subjectMemberId))
    context.addIssue({
      code: 'custom',
      path: ['subjectMemberId'],
      message:
        '対象memberはsubjectMemberIdまたはmemberIdの一方だけ指定してください。',
    });
}

export function getSubjectMemberId(value: SubjectMemberSelection) {
  return value.subjectMemberId ?? value.memberId;
}
