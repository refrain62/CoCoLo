import { formatGrade } from '@cocolo/domain';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  createMemberApi,
  type MemberApi,
  MemberApiError,
  type MemberCategory,
  type MemberCreateInput,
  type MemberListFilters,
  type MemberStatus,
  type MemberSummary,
} from './member-api.js';

const emptyFilters: MemberListFilters = {
  q: '',
  category: '',
  status: '',
};

type MemberFormState = {
  name: string;
  kana: string;
  category: MemberCategory;
  gradeLevel: string;
  ageGroup: string;
  status: 'active' | 'suspended';
};

const initialForm: MemberFormState = {
  name: '',
  kana: '',
  category: 'student',
  gradeLevel: '',
  ageGroup: '',
  status: 'active',
};

const statusLabels: Record<MemberStatus, string> = {
  active: '在籍',
  suspended: '停止',
  retired: '退部',
};

function formatMemberCategory(category: MemberCategory) {
  return category === 'student' ? '学生' : '一般';
}

function formatMemberStatus(status: MemberStatus) {
  return statusLabels[status];
}

function validateForm(form: MemberFormState): MemberCreateInput {
  const name = form.name.trim();
  if (!name) throw new Error('氏名を入力してください');
  if (form.category === 'student') {
    if (!form.gradeLevel) throw new Error('学年を入力してください');
    const gradeLevel = Number(form.gradeLevel);
    if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 16)
      throw new Error('学年は1〜16で入力してください');
    return {
      name,
      kana: form.kana.trim() || null,
      category: form.category,
      gradeLevel,
      ageGroup: null,
      status: form.status,
    };
  }

  const ageGroup = form.ageGroup.trim();
  if (!ageGroup) throw new Error('年代を入力してください');
  return {
    name,
    kana: form.kana.trim() || null,
    category: form.category,
    gradeLevel: null,
    ageGroup,
    status: form.status,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof MemberApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '通信に失敗しました。';
}

function MemberTable({ members }: { members: MemberSummary[] }) {
  if (members.length === 0)
    return <p role="status">表示できる部員がいません。</p>;

  return (
    <table>
      <caption className="visually-hidden">部員一覧</caption>
      <thead>
        <tr>
          <th scope="col">氏名</th>
          <th scope="col">ふりがな</th>
          <th scope="col">区分</th>
          <th scope="col">学年・年代</th>
          <th scope="col">状態</th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.id}>
            <td>{member.name}</td>
            <td>{member.kana || '—'}</td>
            <td>{formatMemberCategory(member.category)}</td>
            <td>
              {formatGrade(
                member.category,
                member.gradeLevel,
                member.ageGroup ?? null,
              )}
            </td>
            <td>{formatMemberStatus(member.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MemberForm({
  api,
  onCreated,
}: {
  api: MemberApi;
  onCreated: (member: MemberSummary) => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function updateForm<K extends keyof MemberFormState>(
    key: K,
    value: MemberFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    let input: MemberCreateInput;
    try {
      input = validateForm(form);
    } catch (validationError) {
      setError(getErrorMessage(validationError));
      return;
    }

    setIsSaving(true);
    try {
      const created = await api.create(input);
      onCreated(created);
      setForm(initialForm);
      setSuccess('登録しました');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="member-form-heading">
      <h2 id="member-form-heading">部員登録</h2>
      <form noValidate onSubmit={submit}>
        <div>
          <label htmlFor="member-name">氏名</label>
          <input
            id="member-name"
            aria-required="true"
            maxLength={200}
            value={form.name}
            onChange={(event) => updateForm('name', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="member-kana">ふりがな</label>
          <input
            id="member-kana"
            maxLength={200}
            value={form.kana}
            onChange={(event) => updateForm('kana', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="member-category">区分</label>
          <select
            id="member-category"
            value={form.category}
            onChange={(event) =>
              updateForm('category', event.target.value as MemberCategory)
            }
          >
            <option value="student">学生</option>
            <option value="adult">一般</option>
          </select>
        </div>
        {form.category === 'student' ? (
          <div>
            <label htmlFor="member-grade">学年</label>
            <input
              id="member-grade"
              aria-required="true"
              inputMode="numeric"
              max="16"
              min="1"
              type="number"
              value={form.gradeLevel}
              onChange={(event) => updateForm('gradeLevel', event.target.value)}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="member-age-group">年代</label>
            <input
              id="member-age-group"
              aria-required="true"
              maxLength={100}
              value={form.ageGroup}
              onChange={(event) => updateForm('ageGroup', event.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="member-status">状態</label>
          <select
            id="member-status"
            value={form.status}
            onChange={(event) =>
              updateForm(
                'status',
                event.target.value as MemberFormState['status'],
              )
            }
          >
            <option value="active">在籍</option>
            <option value="suspended">停止</option>
          </select>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {success ? <p role="status">{success}</p> : null}
        <button type="submit" disabled={isSaving}>
          {isSaving ? '登録中…' : '登録する'}
        </button>
      </form>
    </section>
  );
}

export function MemberManagementPage({
  api = createMemberApi(),
}: {
  api?: MemberApi;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const loadMembers = useCallback(
    async (nextFilters: MemberListFilters) => {
      setIsLoading(true);
      setListError(null);
      try {
        setMembers(await api.list(nextFilters));
      } catch (error) {
        setListError(getErrorMessage(error));
      } finally {
        setIsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadMembers(emptyFilters);
  }, [loadMembers]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMembers(filters);
  }

  return (
    <>
      <header>
        <p>環境: {import.meta.env.VITE_APP_ENV ?? 'local'}</p>
        <h1>部員一覧</h1>
        <p>所属チームの部員を確認・登録できます。</p>
      </header>

      <section aria-labelledby="member-filter-heading">
        <h2 id="member-filter-heading">検索・絞り込み</h2>
        <form onSubmit={search}>
          <div>
            <label htmlFor="member-search">検索</label>
            <input
              id="member-search"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="member-filter-category">区分</label>
            <select
              id="member-filter-category"
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.target.value as MemberListFilters['category'],
                }))
              }
            >
              <option value="">すべて</option>
              <option value="student">学生</option>
              <option value="adult">一般</option>
            </select>
          </div>
          <div>
            <label htmlFor="member-filter-status">状態</label>
            <select
              id="member-filter-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as MemberListFilters['status'],
                }))
              }
            >
              <option value="">すべて</option>
              <option value="active">在籍</option>
              <option value="suspended">停止</option>
              <option value="retired">退部</option>
            </select>
          </div>
          <button type="submit">検索</button>
        </form>
      </section>

      <section aria-labelledby="member-list-heading">
        <h2 id="member-list-heading" className="visually-hidden">
          部員一覧結果
        </h2>
        {isLoading ? <p role="status">読み込み中…</p> : null}
        {listError ? <p role="alert">{listError}</p> : null}
        {!isLoading && !listError ? <MemberTable members={members} /> : null}
      </section>

      <section aria-labelledby="member-create-toggle-heading">
        <h2 id="member-create-toggle-heading" className="visually-hidden">
          部員登録操作
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
        >
          部員を登録
        </button>
        {showForm ? (
          <MemberForm api={api} onCreated={setMembersAfterCreate(setMembers)} />
        ) : null}
      </section>
    </>
  );
}

function setMembersAfterCreate(
  setMembers: Dispatch<SetStateAction<MemberSummary[]>>,
) {
  return (member: MemberSummary) => {
    setMembers((current) => [member, ...current]);
  };
}
