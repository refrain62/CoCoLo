import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGrade } from '../dist/index.js';

test('学年を仕様どおりに表示する', () => {
  assert.equal(formatGrade('student', 1, null), '小1');
  assert.equal(formatGrade('student', 9, null), '中3');
  assert.equal(formatGrade('student', 16, null), '大4');
  assert.equal(formatGrade('student', 17, null), 'OB / 院生');
  assert.equal(formatGrade('adult', null, '30代'), '30代');
});
