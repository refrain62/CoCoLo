import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Section,
  Select,
} from '@cocolo/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  SystemAdminApi,
  SystemAnnouncement,
  SystemFeature,
} from './system-admin-api.js';
import type { SystemAdminRoute } from './system-admin-routes.js';

const announcementStatusLabels: Record<SystemAnnouncement['status'], string> = {
  draft: '下書き',
  published: '公開中',
  archived: 'アーカイブ',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function AnnouncementEditor({
  announcement,
  onSave,
  saving,
}: {
  announcement: SystemAnnouncement;
  onSave: (input: {
    title: string;
    body: string;
    status: SystemAnnouncement['status'];
  }) => Promise<void>;
  saving: boolean;
}) {
  const [title, setTitle] = useState(announcement.title);
  const [body, setBody] = useState(announcement.body);
  const [status, setStatus] = useState<SystemAnnouncement['status']>(
    announcement.status,
  );

  useEffect(() => {
    setTitle(announcement.title);
    setBody(announcement.body);
    setStatus(announcement.status);
  }, [announcement]);

  return (
    <form
      className="system-admin-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ title, body, status });
      }}
    >
      <div className="system-admin-form-grid">
        <label htmlFor={`system-announcement-${announcement.id}-title`}>
          タイトル
          <Input
            id={`system-announcement-${announcement.id}-title`}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label htmlFor={`system-announcement-${announcement.id}-status`}>
          状態
          <Select
            id={`system-announcement-${announcement.id}-status`}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as SystemAnnouncement['status'])
            }
          >
            {Object.entries(announcementStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label htmlFor={`system-announcement-${announcement.id}-body`}>
        本文
        <textarea
          id={`system-announcement-${announcement.id}-body`}
          maxLength={5000}
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="system-admin-form-actions">
        <span>最終更新: {formatDate(announcement.updatedAt)}</span>
        <Button
          type="submit"
          disabled={saving || !title.trim() || !body.trim()}
        >
          {saving ? '保存中…' : '変更を保存'}
        </Button>
      </div>
    </form>
  );
}

function SystemAnnouncementsPage({ api }: { api: SystemAdminApi }) {
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<SystemAnnouncement['status']>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnnouncements(await api.listAnnouncements());
    } catch (requestError) {
      setError(errorMessage(requestError, '全体お知らせを取得できません。'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        status,
      });
      setAnnouncements((current) => [created, ...current]);
      setTitle('');
      setBody('');
      setStatus('draft');
    } catch (requestError) {
      setError(errorMessage(requestError, '全体お知らせを作成できません。'));
    } finally {
      setSaving(false);
    }
  }

  async function updateAnnouncement(
    announcementId: string,
    input: {
      title: string;
      body: string;
      status: SystemAnnouncement['status'];
    },
  ) {
    setSavingId(announcementId);
    setError(null);
    try {
      const updated = await api.updateAnnouncement(announcementId, input);
      setAnnouncements((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      setError(errorMessage(requestError, '全体お知らせを更新できません。'));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="admin-page-stack">
      <header className="admin-route-header">
        <p className="admin-eyebrow">Platform notices</p>
        <h1>全体お知らせ</h1>
        <p>すべてのチームへ届けるお知らせを管理します。</p>
      </header>
      {error ? (
        <Alert variant="destructive" role="alert">
          <strong>全体お知らせを処理できません</strong>
          <span>{error}</span>
        </Alert>
      ) : null}
      <Section
        title="お知らせを作成"
        description="公開中にしたお知らせは、全利用者向けの告知として扱われます。"
      >
        <form
          className="system-admin-form"
          noValidate
          onSubmit={createAnnouncement}
        >
          <div className="system-admin-form-grid">
            <label htmlFor="system-announcement-create-title">
              タイトル
              <Input
                id="system-announcement-create-title"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label htmlFor="system-announcement-create-status">
              状態
              <Select
                id="system-announcement-create-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SystemAnnouncement['status'])
                }
              >
                {Object.entries(announcementStatusLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </Select>
            </label>
          </div>
          <label htmlFor="system-announcement-create-body">
            本文
            <textarea
              id="system-announcement-create-body"
              maxLength={5000}
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="system-admin-form-actions">
            <span>公開前に内容と状態を確認してください。</span>
            <Button
              type="submit"
              disabled={saving || !title.trim() || !body.trim()}
            >
              {saving ? '作成中…' : 'お知らせを作成'}
            </Button>
          </div>
        </form>
      </Section>
      <Section
        title="登録済みのお知らせ"
        description="本文、公開状態を更新できます。アーカイブした内容は利用者へ表示されません。"
        actions={
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '更新中…' : '再読み込み'}
          </Button>
        }
      >
        {loading && announcements.length === 0 ? (
          <div className="admin-loading-state" role="status">
            お知らせを読み込んでいます…
          </div>
        ) : announcements.length === 0 ? (
          <div className="admin-loading-state">
            登録済みのお知らせはありません。
          </div>
        ) : (
          <div className="system-admin-list">
            {announcements.map((announcement) => (
              <Card key={announcement.id}>
                <CardHeader>
                  <div className="system-admin-card-heading">
                    <CardTitle>{announcement.title}</CardTitle>
                    <Badge
                      variant={
                        announcement.status === 'published'
                          ? 'success'
                          : announcement.status === 'archived'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {announcementStatusLabels[announcement.status]}
                    </Badge>
                  </div>
                  <CardDescription>
                    {announcement.publishedAt
                      ? `公開日時: ${formatDate(announcement.publishedAt)}`
                      : `作成日時: ${formatDate(announcement.createdAt)}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AnnouncementEditor
                    announcement={announcement}
                    onSave={(input) =>
                      updateAnnouncement(announcement.id, input)
                    }
                    saving={savingId === announcement.id}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function SystemFeaturesPage({ api }: { api: SystemAdminApi }) {
  const [features, setFeatures] = useState<SystemFeature[]>([]);
  const [reason, setReason] = useState('システム運用上の提供状態変更');
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeatures(await api.listFeatures());
    } catch (requestError) {
      setError(errorMessage(requestError, '提供機能を取得できません。'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFeature(feature: SystemFeature) {
    if (feature.billingType !== 'paid' || !reason.trim()) return;
    setUpdatingKey(feature.key);
    setError(null);
    try {
      const updated = await api.updateFeature(feature.key, {
        enabled: !feature.systemEnabled,
        reason: reason.trim(),
      });
      setFeatures((current) =>
        current.map((item) => (item.key === updated.key ? updated : item)),
      );
    } catch (requestError) {
      setError(errorMessage(requestError, '提供状態を更新できません。'));
    } finally {
      setUpdatingKey(null);
    }
  }

  return (
    <div className="admin-page-stack">
      <header className="admin-route-header">
        <p className="admin-eyebrow">Entitlements</p>
        <h1>有償機能</h1>
        <p>
          システム全体の提供状態を切り替えます。個別チームの契約付与とは分離されています。
        </p>
      </header>
      {error ? (
        <Alert variant="destructive" role="alert">
          <strong>提供状態を処理できません</strong>
          <span>{error}</span>
        </Alert>
      ) : null}
      <Section
        title="提供状態の変更理由"
        description="停止理由は監査ログへ記録されます。再開しても、課金機能は契約・承認状態を満たす場合だけ利用できます。"
      >
        <div className="feature-reason-field">
          <label htmlFor="system-feature-change-reason">変更理由</label>
          <Input
            id="system-feature-change-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </Section>
      <Section
        title="システム全体の機能"
        description="無効にした機能は全チームで利用不可になります。"
        actions={
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '更新中…' : '再読み込み'}
          </Button>
        }
      >
        {loading && features.length === 0 ? (
          <div className="admin-loading-state" role="status">
            提供機能を読み込んでいます…
          </div>
        ) : (
          <div className="feature-card-grid">
            {features.map((feature) => (
              <Card key={feature.key} className="feature-card">
                <CardHeader>
                  <div className="feature-card-heading">
                    <CardTitle>{feature.displayName}</CardTitle>
                    <Badge
                      variant={
                        feature.billingType === 'paid' ? 'outline' : 'secondary'
                      }
                    >
                      {feature.billingType === 'paid' ? '有償' : '無償'}
                    </Badge>
                  </div>
                  <CardDescription>{feature.key}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="feature-card-status">
                    <span className="feature-status-label">
                      システム提供状態
                    </span>
                    <Badge
                      variant={
                        feature.systemEnabled ? 'success' : 'destructive'
                      }
                    >
                      {feature.systemEnabled ? '提供中' : '停止中'}
                    </Badge>
                  </div>
                  <p className="feature-card-reason">
                    {feature.billingType === 'paid'
                      ? '有効化してもチームの契約・承認条件は変わりません。'
                      : 'システム全体の提供可否を管理します。'}
                  </p>
                  <Button
                    className="feature-toggle"
                    variant={feature.systemEnabled ? 'outline' : 'secondary'}
                    disabled={
                      feature.billingType !== 'paid' ||
                      updatingKey === feature.key ||
                      !reason.trim()
                    }
                    aria-pressed={feature.systemEnabled}
                    onClick={() => void toggleFeature(feature)}
                  >
                    {feature.billingType !== 'paid'
                      ? '無償機能は対象外'
                      : updatingKey === feature.key
                        ? '保存中…'
                        : feature.systemEnabled
                          ? '全体提供を停止'
                          : '全体提供を再開'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function SystemAdminPage({
  api,
  onNavigate,
  route,
}: {
  api: SystemAdminApi;
  onNavigate: (path: string) => void;
  route: SystemAdminRoute;
}) {
  if (route === 'notices') return <SystemAnnouncementsPage api={api} />;
  if (route === 'entitlements') return <SystemFeaturesPage api={api} />;

  return (
    <div className="admin-page-stack">
      <Section
        eyebrow="System overview"
        title="システム管理"
        description="全体のお知らせと、有償機能の提供状態を管理する入口です。"
      >
        <div className="admin-hero-card">
          <div>
            <p className="admin-hero-kicker">SYSTEM ADMIN ONLY</p>
            <h1>CoCoLo全体の運用を安全に管理する</h1>
            <p>
              チーム管理とは分離されたシステム管理領域です。操作は監査ログへ記録され、
              課金と利用権限の境界を保ったまま運用します。
            </p>
          </div>
          <Badge variant="success">認証済み</Badge>
        </div>
      </Section>
      <div className="admin-metric-grid system-admin-card-grid">
        <Card>
          <CardHeader>
            <CardTitle>全体お知らせ</CardTitle>
          </CardHeader>
          <CardContent>
            <p>利用者へ告知する内容を管理</p>
            <Button
              variant="outline"
              onClick={() => onNavigate('/admin/notices')}
            >
              管理画面を開く →
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>有償機能</CardTitle>
          </CardHeader>
          <CardContent>
            <p>システム全体の提供状態を管理</p>
            <Button
              variant="outline"
              onClick={() => onNavigate('/admin/entitlements')}
            >
              管理画面を開く →
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
