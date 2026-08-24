import { describe, expect, it } from 'vitest';
import { toDateTimeLocal, toTokyoIso } from './events-page.js';

describe('予定入力日時', () => {
  it('ISO日時をAsia/Tokyoのdatetime-local値へ変換する', () => {
    expect(toDateTimeLocal('2026-08-25T00:00:00.000Z')).toBe(
      '2026-08-25T09:00',
    );
  });

  it('datetime-local値をAsia/TokyoとしてISO日時へ変換する', () => {
    expect(toTokyoIso('2026-08-25T09:00')).toBe('2026-08-25T00:00:00.000Z');
  });

  it('不正なdatetime-local値を拒否する', () => {
    expect(() => toTokyoIso('not-a-date')).toThrow('日時の形式が不正です。');
  });
});
