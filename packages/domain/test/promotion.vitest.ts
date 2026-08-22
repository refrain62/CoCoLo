import { describe, expect, it } from 'vitest';
import { planPromotion } from '../src/index.js';

describe('年度繰り上げ', () => {
  it('在籍中の学生だけを一度だけ +1 する計画を作る', () => {
    expect(
      planPromotion([
        { id: 'student', category: 'student', gradeLevel: 9, status: 'active' },
        {
          id: 'suspended',
          category: 'student',
          gradeLevel: 9,
          status: 'suspended',
        },
        {
          id: 'retired',
          category: 'student',
          gradeLevel: 9,
          status: 'retired',
        },
        { id: 'adult', category: 'adult', gradeLevel: null, status: 'active' },
        {
          id: 'unset',
          category: 'student',
          gradeLevel: null,
          status: 'active',
        },
      ]),
    ).toEqual({
      previewCount: 1,
      changes: [{ id: 'student', fromGradeLevel: 9, toGradeLevel: 10 }],
    });
  });

  it('DB上限を超える学年を安全に拒否する', () => {
    expect(() =>
      planPromotion([
        {
          id: 'overflow',
          category: 'student',
          gradeLevel: 99,
          status: 'active',
        },
      ]),
    ).toThrow('学年の上限を超える部員が含まれています');
  });
});
