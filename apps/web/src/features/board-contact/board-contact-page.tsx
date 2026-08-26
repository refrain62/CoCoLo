import { Button, Input, ResponsiveTable, Select } from '@cocolo/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type BoardContactApi,
  type BoardContactCreateInput,
  type BoardContactRoleType,
  type BoardContactSummary,
  createBoardContactApi,
} from './board-contact-api.js';

type BoardContactFormState = {
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId: string;
  lineContact: string;
  phone: string;
  contactPreference: 'line' | 'phone' | 'both';
};

const initialForm: BoardContactFormState = {
  roleName: '',
  roleType: 'staff',
  assigneeUserId: '',
  lineContact: '',
  phone: '',
  contactPreference: 'line',
};

const roleTypeLabels: Record<BoardContactRoleType, string> = {
  admin: '管理者',
  staff: 'スタッフ',
  member: '部員',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '通信に失敗しました。';
}

function formatContact(contact: BoardContactSummary, canManage = true) {
  const values: string[] = [];
  if (contact.lineContact) values.push(`LINE: ${contact.lineContact}`);
  if (contact.phone) values.push(`電話: ${contact.phone}`);
  if (values.length > 0) return values.join(' / ');
  return canManage ? '連絡先未設定' : '連絡先は管理者のみ表示';
}

function validateForm(
  fiscalYear: number,
  form: BoardContactFormState,
): BoardContactCreateInput {
  const roleName = form.roleName.trim();
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100)
    throw new Error('年度は2000〜2100の整数で入力してください。');
  if (!roleName || roleName.length > 100)
    throw new Error('役職名は1〜100文字で入力してください。');
  if (form.phone && !/^[0-9+().\-\s]+$/.test(form.phone.trim()))
    throw new Error('電話番号に使用できない文字が含まれています。');
  return {
    fiscalYear,
    roleName,
    roleType: form.roleType,
    assigneeUserId: form.assigneeUserId.trim() || null,
    lineContact: form.lineContact.trim() || null,
    phone: form.phone.trim() || null,
    contactPreference: form.contactPreference,
  };
}

function formFromContact(contact: BoardContactSummary): BoardContactFormState {
  return {
    roleName: contact.roleName,
    roleType: contact.roleType,
    assigneeUserId: contact.assigneeUserId ?? '',
    lineContact: contact.lineContact ?? '',
    phone: contact.phone ?? '',
    contactPreference: contact.contactPreference,
  };
}

function BoardContactTable({
  contacts,
  canManage,
  onEdit,
  onRemove,
}: {
  contacts: BoardContactSummary[];
  canManage: boolean;
  onEdit: (contact: BoardContactSummary) => void;
  onRemove: (contact: BoardContactSummary) => void;
}) {
  if (contacts.length === 0)
    return <p role="status">この年度の役職は登録されていません。</p>;

  return (
    <ResponsiveTable>
      <caption className="visually-hidden">年度役員一覧</caption>
      <thead>
        <tr>
          <th scope="col">役職</th>
          <th scope="col">種別</th>
          <th scope="col">連絡先</th>
          {canManage ? <th scope="col">操作</th> : null}
        </tr>
      </thead>
      <tbody>
        {contacts.map((contact) => (
          <tr key={contact.id}>
            <td data-label="役職">{contact.roleName}</td>
            <td data-label="種別">{roleTypeLabels[contact.roleType]}</td>
            <td data-label="連絡先">{formatContact(contact, canManage)}</td>
            {canManage ? (
              <td data-label="操作">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(contact)}
                >
                  編集
                </Button>{' '}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRemove(contact)}
                >
                  削除
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </ResponsiveTable>
  );
}

// 役職枠と連絡先の編集状態を管理し、表示できる個人情報だけをAPIレスポンスから描画する。
export function BoardContactPage({
  api = createBoardContactApi(),
  canManage = false,
}: {
  api?: BoardContactApi;
  canManage?: boolean;
}) {
  const [fiscalYear, setFiscalYear] = useState(() => new Date().getFullYear());
  const [contacts, setContacts] = useState<BoardContactSummary[]>([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setContacts([]);
    try {
      setContacts(await api.list(fiscalYear));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [api, fiscalYear]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
  }

  function editContact(contact: BoardContactSummary) {
    setForm(formFromContact(contact));
    setEditingId(contact.id);
    setError(null);
    setSuccess(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    let input: BoardContactCreateInput;
    try {
      input = validateForm(fiscalYear, form);
    } catch (validationError) {
      setError(getErrorMessage(validationError));
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) await api.update(editingId, input);
      else await api.create(input);
      resetForm();
      await loadContacts();
      setSuccess(editingId ? '役職を更新しました。' : '役職を登録しました。');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(contact: BoardContactSummary) {
    if (!window.confirm(`「${contact.roleName}」を削除しますか？`)) return;
    setError(null);
    setSuccess(null);
    try {
      await api.remove(contact.id);
      await loadContacts();
      setSuccess('役職を削除しました。');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function copyPreviousYear() {
    setError(null);
    setSuccess(null);
    try {
      await api.copyYear(fiscalYear - 1, fiscalYear);
      await loadContacts();
      setSuccess(`${fiscalYear - 1}年度の役職枠を引き継ぎました。`);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <section aria-labelledby="board-contact-heading">
      <header>
        <h1 id="board-contact-heading">年度役員と連絡先</h1>
        <p>役職枠を管理し、権限に応じて連絡先を確認できます。</p>
      </header>

      <section aria-labelledby="board-contact-year-heading">
        <h2 id="board-contact-year-heading">対象年度</h2>
        <label htmlFor="board-contact-fiscal-year">年度</label>
        <Input
          id="board-contact-fiscal-year"
          inputMode="numeric"
          max="2100"
          min="2000"
          type="number"
          value={fiscalYear}
          onChange={(event) => {
            setFiscalYear(Number(event.target.value));
            setSuccess(null);
          }}
        />
        {canManage ? (
          <Button variant="outline" onClick={() => void copyPreviousYear()}>
            前年度の役職枠を引き継ぐ
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="board-contact-list-heading">
        <h2 id="board-contact-list-heading">役職一覧</h2>
        {isLoading ? <p role="status">読み込み中…</p> : null}
        {!isLoading ? (
          <BoardContactTable
            contacts={contacts}
            canManage={canManage}
            onEdit={editContact}
            onRemove={(contact) => void remove(contact)}
          />
        ) : null}
      </section>

      {canManage ? (
        <section aria-labelledby="board-contact-form-heading">
          <h2 id="board-contact-form-heading">
            {editingId ? '役職を編集' : '役職を登録'}
          </h2>
          <form noValidate onSubmit={save}>
            <div>
              <label htmlFor="board-contact-role-name">役職名</label>
              <Input
                id="board-contact-role-name"
                maxLength={100}
                required
                value={form.roleName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    roleName: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="board-contact-role-type">役職種別</label>
              <Select
                id="board-contact-role-type"
                value={form.roleType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    roleType: event.target.value as BoardContactRoleType,
                  }))
                }
              >
                <option value="admin">管理者</option>
                <option value="staff">スタッフ</option>
                <option value="member">部員</option>
              </Select>
            </div>
            <div>
              <label htmlFor="board-contact-assignee">担当者ID</label>
              <Input
                id="board-contact-assignee"
                maxLength={128}
                value={form.assigneeUserId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assigneeUserId: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="board-contact-line">LINE連絡先</label>
              <Input
                id="board-contact-line"
                maxLength={200}
                value={form.lineContact}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    lineContact: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor="board-contact-phone">電話番号</label>
              <Input
                id="board-contact-phone"
                inputMode="tel"
                maxLength={32}
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <fieldset>
              <legend>表示する連絡先</legend>
              <label>
                <input
                  type="radio"
                  name="board-contact-preference"
                  value="line"
                  checked={form.contactPreference === 'line'}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      contactPreference: 'line',
                    }))
                  }
                />
                LINE
              </label>{' '}
              <label>
                <input
                  type="radio"
                  name="board-contact-preference"
                  value="phone"
                  checked={form.contactPreference === 'phone'}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      contactPreference: 'phone',
                    }))
                  }
                />
                電話
              </label>{' '}
              <label>
                <input
                  type="radio"
                  name="board-contact-preference"
                  value="both"
                  checked={form.contactPreference === 'both'}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      contactPreference: 'both',
                    }))
                  }
                />
                両方
              </label>
            </fieldset>
            {error ? <p role="alert">{error}</p> : null}
            {success ? <p role="status">{success}</p> : null}
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '保存中…' : editingId ? '更新する' : '登録する'}
            </Button>{' '}
            {editingId ? (
              <Button variant="outline" onClick={resetForm}>
                編集を取り消す
              </Button>
            ) : null}
          </form>
        </section>
      ) : null}
    </section>
  );
}

export { formatContact, validateForm };
