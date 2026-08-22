import { describe, expect, it } from 'vitest';
import { formatContact, validateForm } from './board-contact-page.js';

describe('役員連絡先画面', () => {
  it('表示設定済みのAPI投影だけを連絡先として表示する', () => {
    expect(
      formatContact({
        id: 'board-1',
        fiscalYear: 2026,
        roleName: '会計',
        roleType: 'admin',
        contactPreference: 'both',
        phone: '090-0000-0000',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
    ).toBe('電話: 090-0000-0000');
    expect(
      formatContact({
        id: 'board-2',
        fiscalYear: 2026,
        roleName: '会長',
        roleType: 'admin',
        contactPreference: 'line',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
    ).toBe('連絡先未設定');
  });

  it('役職名と電話番号を画面側でも検証する', () => {
    expect(() =>
      validateForm(2026, {
        roleName: '会計',
        roleType: 'admin',
        assigneeUserId: '',
        lineContact: '',
        phone: '090-0000-0000',
        contactPreference: 'phone',
      }),
    ).not.toThrow();
    expect(() =>
      validateForm(2026, {
        roleName: '',
        roleType: 'admin',
        assigneeUserId: '',
        lineContact: '',
        phone: '',
        contactPreference: 'line',
      }),
    ).toThrow('役職名');
  });
});
