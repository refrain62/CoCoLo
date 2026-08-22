export type MemberCategory = 'student' | 'adult';

export function formatGrade(
  category: MemberCategory,
  gradeLevel: number | null,
  ageGroup: string | null,
): string {
  if (category === 'adult') {
    return ageGroup ?? '一般';
  }

  if (gradeLevel === null || !Number.isInteger(gradeLevel) || gradeLevel < 1) {
    return '未設定';
  }
  if (gradeLevel <= 6) return `小${gradeLevel}`;
  if (gradeLevel <= 9) return `中${gradeLevel - 6}`;
  if (gradeLevel <= 12) return `高${gradeLevel - 9}`;
  if (gradeLevel <= 16) return `大${gradeLevel - 12}`;
  return 'OB / 院生';
}

export type PromotionMember = {
  id: string;
  category: MemberCategory;
  gradeLevel: number | null;
  status: 'active' | 'suspended' | 'retired';
};

export type PromotionCandidate = PromotionMember & {
  category: 'student';
  gradeLevel: number;
  status: 'active';
};

export function isPromotionCandidate(
  input: PromotionMember,
): input is PromotionCandidate {
  return (
    input.category === 'student' &&
    input.status === 'active' &&
    input.gradeLevel !== null
  );
}

export type PromotionChange = {
  id: string;
  fromGradeLevel: number;
  toGradeLevel: number;
};

export function planPromotion(members: PromotionMember[]) {
  const candidates = members.filter(isPromotionCandidate);
  if (candidates.some((member) => member.gradeLevel >= 99))
    throw new Error('学年の上限を超える部員が含まれています');
  return {
    previewCount: candidates.length,
    changes: candidates.map((member) => ({
      id: member.id,
      fromGradeLevel: member.gradeLevel,
      toGradeLevel: member.gradeLevel + 1,
    })),
  };
}
