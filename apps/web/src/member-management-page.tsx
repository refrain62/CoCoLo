import { formatGrade } from '@cocolo/domain';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { AuthInvitationApi } from './features/auth-invitations/auth-invitation-api.js';
import {
  createMemberApi,
  type MemberApi,
  MemberApiError,
  type MemberCategory,
  type MemberCreateInput,
  type MemberListFilters,
  type MemberStatus,
  type MemberSummary,
  type MemberUpdateInput,
  type PromotionSummary,
} from './member-api.js';

const emptyFilters: MemberListFilters = {
  q: '',
  category: '',
  status: '',
};

const defaultMemberApi = createMemberApi();

type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';

function canManageMembers(role: MemberRole | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

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

// UI入力をAPI契約と同じ区分排他・範囲条件へ正規化し、送信前に利用者へ即時通知する。
function validateForm(form: MemberFormState): MemberCreateInput {
  const name = form.name.trim();
  if (!name) throw new Error('氏名を入力してください。');
  if (form.category === 'student') {
    if (!form.gradeLevel) throw new Error('学年を入力してください。');
    const gradeLevel = Number(form.gradeLevel);
    if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 16)
      throw new Error('学年は1〜16で入力してください。');
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
  if (!ageGroup) throw new Error('年代を入力してください。');
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

function toMemberFormState(member: MemberSummary): MemberFormState {
  return {
    name: member.name,
    kana: member.kana ?? '',
    category: member.category,
    gradeLevel: member.gradeLevel == null ? '' : String(member.gradeLevel),
    ageGroup: member.ageGroup ?? '',
    status: member.status === 'suspended' ? 'suspended' : 'active',
  };
}

function MemberEditForm({
  member,
  api,
  canManage,
  onUpdated,
  onRetired,
}: {
  member: MemberSummary;
  api: MemberApi;
  canManage: boolean;
  onUpdated: (member: MemberSummary) => void;
  onRetired: (member: MemberSummary) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(() => toMemberFormState(member));
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
    let input: MemberUpdateInput;
    try {
      input = validateForm(form);
    } catch (validationError) {
      setError(getErrorMessage(validationError));
      return;
    }

    setIsSaving(true);
    try {
      const updated = await api.update(member.id, input);
      onUpdated(updated);
      setForm(toMemberFormState(updated));
      setSuccess('更新しました。');
      setIsEditing(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function retire() {
    if (!window.confirm('この部員を退部にしますか？')) return;
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const retired = await api.retire(member.id);
      onRetired(retired);
      setSuccess('退部にしました。');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      {canManage && member.status !== 'retired' ? (
        <button
          type="button"
          onClick={() => {
            setForm(toMemberFormState(member));
            setIsEditing((current) => !current);
            setError(null);
            setSuccess(null);
          }}
        >
          {isEditing ? '編集を閉じる' : '編集'}
        </button>
      ) : null}
      {canManage && member.status !== 'retired' ? (
        <button type="button" disabled={isSaving} onClick={() => void retire()}>
          退部
        </button>
      ) : null}
      {canManage && isEditing ? (
        <form noValidate onSubmit={submit}>
          <label htmlFor={`member-edit-name-${member.id}`}>氏名</label>
          <input
            id={`member-edit-name-${member.id}`}
            maxLength={200}
            value={form.name}
            onChange={(event) => updateForm('name', event.target.value)}
          />
          <label htmlFor={`member-edit-kana-${member.id}`}>ふりがな</label>
          <input
            id={`member-edit-kana-${member.id}`}
            maxLength={200}
            value={form.kana}
            onChange={(event) => updateForm('kana', event.target.value)}
          />
          <label htmlFor={`member-edit-category-${member.id}`}>区分</label>
          <select
            id={`member-edit-category-${member.id}`}
            value={form.category}
            onChange={(event) =>
              updateForm('category', event.target.value as MemberCategory)
            }
          >
            <option value="student">学生</option>
            <option value="adult">一般</option>
          </select>
          {form.category === 'student' ? (
            <>
              <label htmlFor={`member-edit-grade-${member.id}`}>学年</label>
              <input
                id={`member-edit-grade-${member.id}`}
                inputMode="numeric"
                max="16"
                min="1"
                type="number"
                value={form.gradeLevel}
                onChange={(event) =>
                  updateForm('gradeLevel', event.target.value)
                }
              />
            </>
          ) : (
            <>
              <label htmlFor={`member-edit-age-group-${member.id}`}>年代</label>
              <input
                id={`member-edit-age-group-${member.id}`}
                maxLength={100}
                value={form.ageGroup}
                onChange={(event) => updateForm('ageGroup', event.target.value)}
              />
            </>
          )}
          <label htmlFor={`member-edit-status-${member.id}`}>状態</label>
          <select
            id={`member-edit-status-${member.id}`}
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
          {error ? <p role="alert">{error}</p> : null}
          {success ? <p role="status">{success}</p> : null}
          <button type="submit" disabled={isSaving}>
            {isSaving ? '更新中…' : '更新する'}
          </button>
        </form>
      ) : null}
      {!isEditing && error ? <p role="alert">{error}</p> : null}
      {!isEditing && success ? <p role="status">{success}</p> : null}
    </div>
  );
}

function MemberTable({
  members,
  api,
  canManage,
  onUpdated,
  onRetired,
}: {
  members: MemberSummary[];
  api: MemberApi;
  canManage: boolean;
  onUpdated: (member: MemberSummary) => void;
  onRetired: (member: MemberSummary) => void;
}) {
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
          <th scope="col">操作</th>
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
            <td>
              {canManage ? (
                <MemberEditForm
                  api={api}
                  canManage={canManage}
                  member={member}
                  onRetired={onRetired}
                  onUpdated={onUpdated}
                />
              ) : (
                <span>閲覧のみ</span>
              )}
            </td>
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
  // 入力中の状態はフォーム内に閉じ込め、API成功時だけ親の一覧へ新しい部員を反映する。
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
      setSuccess('登録しました。');
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

function PromotionPanel({ api }: { api: MemberApi }) {
  const [fiscalYear, setFiscalYear] = useState(() =>
    String(new Date().getFullYear()),
  );
  const [preview, setPreview] = useState<PromotionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function readFiscalYear() {
    const parsed = Number(fiscalYear);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100)
      throw new Error('対象年度は2000〜2100の整数で入力してください');
    return parsed;
  }

  async function previewPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    let year: number;
    try {
      year = readFiscalYear();
    } catch (validationError) {
      setError(getErrorMessage(validationError));
      return;
    }

    setIsSubmitting(true);
    try {
      setPreview(await api.promote({ mode: 'preview', fiscalYear: year }));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function executePromotion() {
    if (!preview) return;
    if (
      !window.confirm(
        '表示された対象件数を確認し、年度繰り上げを実行しますか？',
      )
    )
      return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const result = await api.promote(
        { mode: 'execute', fiscalYear: preview.fiscalYear },
        crypto.randomUUID(),
      );
      setPreview(result);
      setSuccess(`${result.promotedCount}名の年度繰り上げを完了しました。`);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="promotion-heading">
      <h2 id="promotion-heading">年度繰り上げ</h2>
      <p>
        オーナーまたは管理者向けの操作です。在籍中の学生だけを対象にし、一般・停止・退部・学年未設定は対象外です。
      </p>
      <p>
        学年が17以上の場合は「OB /
        院生」と表示します。卒業・留年は自動判定せず、退部者も変更しません。
      </p>
      <form onSubmit={previewPromotion}>
        <label htmlFor="promotion-fiscal-year">対象年度</label>
        <input
          id="promotion-fiscal-year"
          inputMode="numeric"
          max="2100"
          min="2000"
          type="number"
          value={fiscalYear}
          onChange={(event) => {
            setFiscalYear(event.target.value);
            setPreview(null);
            setError(null);
          }}
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '確認中…' : '対象件数を確認'}
        </button>
      </form>
      {preview ? (
        <div aria-live="polite">
          <p>
            {preview.fiscalYear}年度の対象件数: {preview.previewCount}名
          </p>
          <button
            type="button"
            disabled={isSubmitting || preview.status === 'completed'}
            onClick={() => void executePromotion()}
          >
            {preview.status === 'completed' ? '実行済み' : '確認して実行'}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
    </section>
  );
}

// 部員一覧・検索・登録の画面状態を管理し、データ取得の認可はMemberApi/APIへ委譲する。
function InvitationPanel({
  api,
  members,
}: {
  api: AuthInvitationApi;
  members: MemberSummary[];
}) {
  const activeMembers = members.filter((member) => member.status === 'active');
  const [memberId, setMemberId] = useState(activeMembers[0]?.id ?? '');
  const [linkType, setLinkType] = useState<'self' | 'guardian'>('guardian');
  const [relationship, setRelationship] = useState('保護者');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!activeMembers.some((member) => member.id === memberId))
      setMemberId(activeMembers[0]?.id ?? '');
  }, [activeMembers, memberId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberId || !relationship.trim() || isSubmitting) return;
    setError(null);
    setInviteUrl(null);
    setIsSubmitting(true);
    try {
      const result = await api.create({
        memberId,
        role: 'guardian',
        linkType,
        relationship: relationship.trim(),
        expiresInHours: 72,
      });
      setInviteUrl(result.inviteUrl);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="member-invitation-heading">
      <h2 id="member-invitation-heading">メンバーを招待</h2>
      <p>本人または保護者を招待できます。招待URLは発行後72時間で失効します。</p>
      {activeMembers.length === 0 ? (
        <p role="status">招待できる在籍中の部員がいません。</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="invitation-member">対象部員</label>
          <select
            id="invitation-member"
            required
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            {activeMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <label htmlFor="invitation-link-type">連携する人</label>
          <select
            id="invitation-link-type"
            required
            value={linkType}
            onChange={(event) => {
              const next = event.target.value as 'self' | 'guardian';
              setLinkType(next);
              if (next === 'self') setRelationship('本人');
              else if (relationship === '本人') setRelationship('保護者');
            }}
          >
            <option value="self">本人</option>
            <option value="guardian">保護者</option>
          </select>
          <label htmlFor="invitation-relationship">続柄</label>
          <input
            id="invitation-relationship"
            maxLength={100}
            required
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
          />
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '発行中…' : '招待URLを発行'}
          </button>
        </form>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {inviteUrl ? (
        <div aria-live="polite">
          <label htmlFor="invitation-url">招待URL</label>
          <input id="invitation-url" readOnly value={inviteUrl} />
          <p>このURLを招待する人へ共有してください。</p>
        </div>
      ) : null}
    </section>
  );
}

export function MemberManagementPage({
  api = defaultMemberApi,
  invitationApi,
  role = null,
}: {
  api?: MemberApi;
  invitationApi?: AuthInvitationApi;
  role?: MemberRole | null;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const canManage = canManageMembers(role);
  const canInvite = role === 'owner' || role === 'admin';

  // 初回表示と検索を同じ経路にし、loading/error状態を必ずリクエスト単位で更新する。
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

  function replaceMember(updated: MemberSummary) {
    setMembers((current) =>
      current.map((member) => (member.id === updated.id ? updated : member)),
    );
  }

  const environment =
    import.meta.env.VITE_APP_ENV ??
    (import.meta.env.DEV ? 'local' : '環境未設定');

  return (
    <>
      <header>
        <p>接続環境: {environment}</p>
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
        {!isLoading && !listError ? (
          <MemberTable
            api={api}
            canManage={canManage}
            members={members}
            onRetired={replaceMember}
            onUpdated={replaceMember}
          />
        ) : null}
      </section>

      {canInvite && invitationApi ? (
        <InvitationPanel api={invitationApi} members={members} />
      ) : null}

      {canManage ? (
        <>
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
              <MemberForm
                api={api}
                onCreated={setMembersAfterCreate(setMembers)}
              />
            ) : null}
          </section>

          <PromotionPanel api={api} />
        </>
      ) : (
        <p className="app-permission-note" role="status">
          部員情報は閲覧できます。登録・編集・退部・年度繰り上げは管理権限が必要です。
        </p>
      )}
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
