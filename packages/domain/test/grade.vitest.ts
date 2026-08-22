import { describe, expect, it } from 'vitest';
import { formatGrade, isPromotionCandidate } from '../src/index.js';

describe('domain', () => {
  it('学年表示を仕様どおりに変換する', () => {
    expect(formatGrade('student', 1, null)).toBe('小1');
    expect(formatGrade('student', 9, null)).toBe('中3');
    expect(formatGrade('adult', null, '30代')).toBe('30代');
  });

  it('年度繰り上げ対象を学生かつ在籍中に限定する', () => {
    expect(
      isPromotionCandidate({
        category: 'student',
        gradeLevel: 9,
        status: 'active',
      }),
    ).toBe(true);
    expect(
      isPromotionCandidate({
        category: 'adult',
        gradeLevel: null,
        status: 'active',
      }),
    ).toBe(false);
  });
});
