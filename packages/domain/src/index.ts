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

export function isPromotionCandidate(input: {
  category: MemberCategory;
  gradeLevel: number | null;
  status: 'active' | 'suspended' | 'retired';
}): boolean {
  return (
    input.category === 'student' &&
    input.status === 'active' &&
    input.gradeLevel !== null
  );
}
