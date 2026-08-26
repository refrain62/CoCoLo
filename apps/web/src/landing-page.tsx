import { type ReactNode, useEffect, useState } from 'react';
import './landing-page.css';

type IconName =
  | 'arrow'
  | 'calendar'
  | 'check'
  | 'chevron'
  | 'clip'
  | 'coins'
  | 'heart'
  | 'menu'
  | 'message'
  | 'people'
  | 'route'
  | 'shield'
  | 'sparkle'
  | 'time'
  | 'x'
  | 'bell'
  | 'home'
  | 'cart';

const iconPaths: Record<IconName, ReactNode> = {
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clip: (
    <path d="m21 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 1 1-2.8-2.8l8.9-8.9" />
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v5c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  message: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M8.6 17.5c1.3-.8.8-3.2 2.5-4.2 1.7-1 3.8.5 5.1-.7.8-.7.7-2.7.7-4.6" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3-1.1 3.4A6.5 6.5 0 0 1 6.8 11L3 12l3.8 1a6.5 6.5 0 0 1 4.1 4.6L12 21l1.1-3.4a6.5 6.5 0 0 1 4.1-4.6l3.8-1-3.8-1a6.5 6.5 0 0 1-4.1-4.6Z" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1" />
      <circle cx="19" cy="20" r="1" />
      <path d="M3 4h2l2.5 11h10L21 7H6" />
    </>
  ),
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function Logo() {
  return (
    <a href="#lp-main" className="logo" aria-label="CoCoLo トップへ">
      <span className="logo-mark">
        <span />
        <span />
        <span />
      </span>
      <span>CoCoLo</span>
    </a>
  );
}

const features = [
  {
    icon: 'calendar' as IconName,
    title: '予定・出欠',
    text: '練習やイベントの予定を共有。出欠の回答と締切管理も、スマホで迷わず完了。',
    className: 'feature-coral',
    detail: '回答状況がひと目でわかる',
  },
  {
    icon: 'message' as IconName,
    title: '連絡・回覧',
    text: '大切なお知らせを確実に。資料の添付から確認状況、LINE通知までひとつに。',
    className: 'feature-yellow',
    detail: '「伝えたつもり」をなくせる',
  },
  {
    icon: 'coins' as IconName,
    title: '購買・集金',
    text: '注文のとりまとめや集金状況をすっきり整理。CSV出力で事務作業も軽やかに。',
    className: 'feature-blue',
    detail: '面倒な集計をシンプルに',
  },
  {
    icon: 'route' as IconName,
    title: '送迎サポート',
    text: '送迎希望と提供できる枠を集めて調整。みんなに無理のない運営を支えます。',
    className: 'feature-green',
    detail: '助け合いを、もっと自然に',
  },
];

const faqs = [
  [
    'スマートフォンだけでも使えますか？',
    'はい。保護者の方はもちろん、管理者の方もスマートフォンから主要な操作を行えます。パソコンやタブレットにも対応しています。',
  ],
  [
    '複数のチームやきょうだいを管理できますか？',
    'はい。ひとつのアカウントで複数チームに参加でき、きょうだいそれぞれの予定・回答を切り替えて確認できます。',
  ],
  [
    'ITに詳しくないメンバーでも使えますか？',
    '迷いにくい画面とLINE・Googleログインを採用。導入時の負担をできるだけ小さく設計しています。',
  ],
  [
    'セキュリティは大丈夫ですか？',
    'チームごとのデータ分離、役割に応じた権限管理、非公開での添付保存など、運営データを守る仕組みを多層で設計しています。',
  ],
];

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Logo />
        <nav
          className={open ? 'nav-links open' : 'nav-links'}
          aria-label="メインナビゲーション"
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setOpen(false);
          }}
        >
          <a href="#problems">CoCoLoとは</a>
          <a href="#features">できること</a>
          <a href="#line">LINE連携</a>
          <a href="#security">安心への取り組み</a>
          <a href="#faq">よくある質問</a>
          <div className="mobile-nav-actions">
            <a href="/login" className="btn btn-ghost">
              ログイン
            </a>
            <a href="#contact" className="btn btn-primary">
              無料ではじめる <Icon name="arrow" size={17} />
            </a>
          </div>
        </nav>
        <div className="nav-actions">
          <a href="/login" className="login-link">
            ログイン
          </a>
          <a href="#contact" className="btn btn-primary btn-small">
            無料ではじめる <Icon name="arrow" size={16} />
          </a>
        </div>
        <button
          type="button"
          className="menu-button"
          onClick={() => setOpen(!open)}
          aria-label="メニュー"
          aria-expanded={open}
        >
          <Icon name={open ? 'x' : 'menu'} size={24} />
        </button>
      </div>
    </header>
  );
}

function DashboardMockup() {
  const [tab, setTab] = useState<'week' | 'month'>('week');
  const days: Array<[string, string]> =
    tab === 'week'
      ? [
          ['月', '24'],
          ['火', '25'],
          ['水', '26'],
          ['木', '27'],
          ['金', '28'],
        ]
      : [
          ['土', '05'],
          ['日', '13'],
          ['土', '19'],
          ['日', '27'],
          ['木', '31'],
        ];
  return (
    <div
      className="visual-wrap"
      role="img"
      aria-label="CoCoLoの管理画面イメージ"
    >
      <div className="float-pill pill-top">
        <span className="pill-icon mint">
          <Icon name="check" size={18} />
        </span>
        <span>
          <b>出欠回答が届きました</b>
          <small>たくみさん・参加</small>
        </span>
      </div>
      <div className="dashboard-card">
        <aside className="mock-sidebar">
          <div className="mock-logo">
            <span className="logo-mark mini">
              <span />
              <span />
              <span />
            </span>
          </div>
          {(
            ['home', 'calendar', 'people', 'message', 'cart'] as IconName[]
          ).map((item, i) => (
            <span
              className={i === 1 ? 'side-icon active' : 'side-icon'}
              key={item}
            >
              <Icon name={item} size={18} />
            </span>
          ))}
          <span className="mock-avatar">M</span>
        </aside>
        <main className="mock-main">
          <div className="mock-head">
            <div>
              <small>こんにちは、みさきさん</small>
              <h3>今週の予定</h3>
            </div>
            <span className="notice">
              <Icon name="bell" size={17} />
              <i>2</i>
            </span>
          </div>
          <div className="mock-tabs">
            <button
              type="button"
              className={tab === 'week' ? 'active' : ''}
              onClick={() => setTab('week')}
            >
              今週
            </button>
            <button
              type="button"
              className={tab === 'month' ? 'active' : ''}
              onClick={() => setTab('month')}
            >
              今月
            </button>
          </div>
          <div className="calendar-strip">
            {days.map(([d, n], i) => (
              <div className={i === 2 ? 'day selected' : 'day'} key={d + n}>
                <span>{d}</span>
                <b>{n}</b>
                {i === 2 && <i />}
              </div>
            ))}
          </div>
          <div className="event-card coral">
            <div className="event-time">
              <b>16:30</b>
              <span>18:30</span>
            </div>
            <div className="event-info">
              <div>
                <span className="event-label">練習</span>
                <small>市民グラウンド A面</small>
              </div>
              <div className="attendees">
                <span>YT</span>
                <span>SK</span>
                <span>+12</span>
              </div>
            </div>
          </div>
          <div className="event-card blue">
            <div className="event-time">
              <b>09:00</b>
              <span>12:00</span>
            </div>
            <div className="event-info">
              <div>
                <span className="event-label">交流試合</span>
                <small>中央スポーツセンター</small>
              </div>
              <div className="response-row">
                <span>
                  <i /> 出席 18
                </span>
                <span>未回答 3</span>
              </div>
            </div>
          </div>
        </main>
      </div>
      <div className="float-pill pill-bottom">
        <span className="pill-icon yellow">
          <Icon name="message" size={18} />
        </span>
        <span>
          <b>新しいお知らせ</b>
          <small>週末の持ち物について</small>
        </span>
      </div>
      <div className="doodle doodle-one">✦</div>
      <div className="doodle doodle-two">⌁</div>
    </div>
  );
}

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0);
  useEffect(() => {
    const items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => {
        item.classList.add('visible');
      });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.12 },
    );
    items.forEach((item) => {
      observer.observe(item);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="landing-page"
      data-design-system="cocolo"
      data-line-integration="primary"
    >
      <a className="landing-skip-link" href="#lp-main">
        本文へ移動
      </a>
      <Header />
      <main id="lp-main" tabIndex={-1}>
        <section className="hero">
          <div className="hero-blob blob-one" />
          <div className="hero-blob blob-two" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                LINEとつながる、チーム運営
              </div>
              <h1>
                チームの毎日を、
                <br />
                <em>もっと心地よく。</em>
              </h1>
              <p className="hero-lead">
                予定、出欠、連絡、会計、送迎。
                <br className="desktop-break" />
                ばらばらだった運営をひとつにつないで、
                <br className="desktop-break" />
                みんなの「楽しい！」をもっと増やそう。
              </p>
              <div className="hero-line-note">
                <span className="line-badge" aria-hidden="true">
                  LINE
                </span>
                <span>
                  <strong>通知はLINE、整理はCoCoLo。</strong>
                  <small>
                    LINEグループへの通知から、必要なWeb画面へつながります。
                  </small>
                </span>
              </div>
              <div className="hero-actions">
                <a href="/login" className="btn btn-primary btn-large">
                  無料ではじめる <Icon name="arrow" size={18} />
                </a>
                <a href="#features" className="text-link">
                  できることを見る <span>↓</span>
                </a>
              </div>
              <div className="hero-note">
                <span>
                  <Icon name="check" size={15} /> 初期費用 0円
                </span>
                <span>
                  <Icon name="check" size={15} /> すぐに試せる
                </span>
                <span>
                  <Icon name="check" size={15} /> スマホ対応
                </span>
              </div>
            </div>
            <DashboardMockup />
          </div>
          <div className="wave" />
        </section>

        <section className="trust-strip">
          <div className="container trust-inner">
            <p>
              スポーツクラブ・部活動・地域団体など
              <br className="mobile-only" />
              さまざまなチーム運営に
            </p>
            <div className="trust-items">
              <span>
                <Icon name="people" /> 少年スポーツ
              </span>
              <span>
                <Icon name="sparkle" /> 部活動・サークル
              </span>
              <span>
                <Icon name="heart" /> 地域コミュニティ
              </span>
            </div>
          </div>
        </section>

        <section className="section problems" id="problems">
          <div className="container">
            <div className="section-heading reveal">
              <span className="section-kicker">そんな毎日を変えたい</span>
              <h2>
                チーム運営、こんなことに
                <br className="mobile-only" />
                困っていませんか？
              </h2>
              <p>
                小さな「面倒」の積み重ねが、運営する人の大きな負担に。
                <br />
                CoCoLoなら、ひとつずつやさしく解決できます。
              </p>
            </div>
            <div className="problem-grid reveal">
              <article>
                <span className="problem-icon">
                  <Icon name="message" size={26} />
                </span>
                <div>
                  <h3>連絡があちこちに散らばる</h3>
                  <p>
                    LINE、メール、紙のお便り。誰に何を伝えたのか分からなくなる。
                  </p>
                </div>
              </article>
              <article>
                <span className="problem-icon">
                  <Icon name="time" size={26} />
                </span>
                <div>
                  <h3>出欠確認に時間がかかる</h3>
                  <p>
                    返事を追いかけて、表にまとめて。毎回同じ作業に時間をとられる。
                  </p>
                </div>
              </article>
              <article>
                <span className="problem-icon">
                  <Icon name="coins" size={26} />
                </span>
                <div>
                  <h3>集金・注文の集計が大変</h3>
                  <p>
                    数え間違いや連絡漏れが心配。締切前は確認作業でいっぱいに。
                  </p>
                </div>
              </article>
            </div>
            <div className="bridge reveal">
              <div className="bridge-line" />
              <span className="logo-mark">
                <span />
                <span />
                <span />
              </span>
              <p>
                <b>CoCoLo</b> がまとめてお手伝いします
              </p>
            </div>
          </div>
        </section>

        <section className="section features" id="features">
          <div className="container">
            <div className="section-heading left reveal">
              <span className="section-kicker">WHAT YOU CAN DO</span>
              <h2>
                チームに必要なこと、
                <br />
                ぎゅっとひとつに。
              </h2>
              <p>
                管理する人にも、参加する人にも。
                <br />
                誰もが迷わず使える、シンプルな機能を揃えました。
              </p>
            </div>
            <div className="features-grid">
              {features.map((feature, i) => (
                <article
                  className={`feature-card ${feature.className} reveal`}
                  style={{ transitionDelay: `${i * 60}ms` }}
                  key={feature.title}
                >
                  <div className="feature-top">
                    <span className="feature-icon">
                      <Icon name={feature.icon} size={27} />
                    </span>
                    <span className="feature-number">0{i + 1}</span>
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  <div className="feature-detail">
                    <Icon name="check" size={16} />
                    {feature.detail}
                  </div>
                </article>
              ))}
            </div>
            <div className="all-features reveal">
              <p>
                <span>ほかにも</span> チーム運営にうれしい機能
              </p>
              <div>
                <span>
                  <Icon name="people" /> メンバー管理
                </span>
                <span>
                  <Icon name="clip" /> 資料の共有
                </span>
                <span>
                  <Icon name="bell" /> LINE通知
                </span>
                <span>
                  <Icon name="shield" /> 権限管理
                </span>
              </div>
            </div>
            <div className="line-callout reveal" id="line">
              <span className="line-callout-mark" aria-hidden="true">
                LINE
              </span>
              <div>
                <span className="section-kicker">LINE連携</span>
                <h3>
                  LINEグループへの通知を入口に、運営情報はCoCoLoで整える。
                </h3>
                <p>
                  Botが参加するLINEグループへ通知。予定や出欠、資料の確認状況はCoCoLoで管理し、必要なWeb画面へ迷わず戻れます。
                </p>
              </div>
              <span className="line-callout-arrow" aria-hidden="true">
                <Icon name="arrow" size={20} />
              </span>
            </div>
          </div>
        </section>

        <section className="section howto">
          <div className="container">
            <div className="section-heading reveal">
              <span className="section-kicker">SIMPLE TO START</span>
              <h2>はじめるのは、とてもかんたん。</h2>
              <p>難しい設定や特別な知識は必要ありません。</p>
            </div>
            <div className="steps reveal">
              <article>
                <span className="step-number">1</span>
                <div className="step-visual step-team">
                  <span className="av a">M</span>
                  <span className="av b">K</span>
                  <span className="av c">Y</span>
                  <i>+</i>
                </div>
                <h3>チームをつくる</h3>
                <p>
                  チーム名と基本情報を
                  <br />
                  入力するだけ。
                </p>
              </article>
              <span className="step-arrow">
                <Icon name="chevron" size={25} />
              </span>
              <article>
                <span className="step-number">2</span>
                <div className="step-visual step-invite">
                  <Icon name="message" size={32} />
                  <span>
                    <Icon name="arrow" size={17} />
                  </span>
                </div>
                <h3>LINEでメンバーを招待</h3>
                <p>
                  専用URLを送って、
                  <br />
                  かんたんに参加。
                </p>
              </article>
              <span className="step-arrow">
                <Icon name="chevron" size={25} />
              </span>
              <article>
                <span className="step-number">3</span>
                <div className="step-visual step-smile">
                  <span>☺</span>
                  <i>✦</i>
                </div>
                <h3>すぐに使える</h3>
                <p>
                  予定や連絡を登録して、
                  <br />
                  チーム運営をスタート。
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section security" id="security">
          <div className="container security-card reveal">
            <div className="security-art">
              <div className="shield-ring">
                <Icon name="shield" size={52} />
              </div>
              <span className="orbit o1">
                <Icon name="people" size={18} />
              </span>
              <span className="orbit o2">
                <Icon name="clip" size={18} />
              </span>
              <span className="orbit o3">
                <Icon name="check" size={18} />
              </span>
            </div>
            <div className="security-copy">
              <span className="section-kicker">SECURE &amp; RELIABLE</span>
              <h2>
                大切なチームの情報を、
                <br />
                きちんと守ります。
              </h2>
              <p>
                チームごとのデータ分離、役割に応じた権限管理、非公開の添付ファイル保存など。安心して使い続けられる仕組みを、サービスの土台から大切にしています。
              </p>
              <div className="security-points">
                <span>
                  <Icon name="check" /> チーム単位で安全に管理
                </span>
                <span>
                  <Icon name="check" /> 役割ごとの操作権限
                </span>
                <span>
                  <Icon name="check" /> 安心のログイン方式
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="section faq" id="faq">
          <div className="container faq-layout">
            <div className="faq-intro reveal">
              <span className="section-kicker">FAQ</span>
              <h2>よくある質問</h2>
              <p>CoCoLoについて、よくいただく質問をまとめました。</p>
              <div className="faq-bubble">
                ほかに気になることがあれば、
                <br />
                <a href="#contact">
                  お気軽にお問い合わせください <Icon name="arrow" size={15} />
                </a>
              </div>
            </div>
            <div className="accordion reveal">
              {faqs.map(([q, a], i) => (
                <article
                  className={openFaq === i ? 'faq-item open' : 'faq-item'}
                  key={q}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                    aria-expanded={openFaq === i}
                  >
                    <span>
                      <b>Q</b>
                      {q}
                    </span>
                    <i>＋</i>
                  </button>
                  <div className="faq-answer">
                    <p>{a}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section" id="contact">
          <div className="cta-dots dots-left" />
          <div className="cta-dots dots-right" />
          <div className="container cta-content reveal">
            <span className="cta-icon">
              <Icon name="heart" size={30} />
            </span>
            <p className="cta-kicker">LINE通知で、チームの毎日を変えよう</p>
            <h2>
              運営をもっとラクに。
              <br />
              みんなをもっと笑顔に。
            </h2>
            <p>CoCoLoと一緒に、心地よいチームづくりをはじめませんか？</p>
            <div className="cta-actions">
              <a href="/login" className="btn btn-white btn-large">
                無料ではじめる <Icon name="arrow" size={18} />
              </a>
              <small>クレジットカード不要　・　いつでも解約できます</small>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <div className="container footer-main">
          <div>
            <Logo />
            <p>チームの毎日を、もっと心地よく。</p>
          </div>
          <div className="footer-links">
            <div>
              <b>サービス</b>
              <a href="#features">できること</a>
              <a href="#security">安心への取り組み</a>
              <a href="#faq">よくある質問</a>
            </div>
            <div>
              <b>サポート</b>
              <a href="/login">お問い合わせ</a>
              <a href="#lp-main">お知らせ</a>
              <a href="/manual">ご利用ガイド</a>
            </div>
            <div>
              <b>規約・ポリシー</b>
              <a href="#lp-main">利用規約</a>
              <a href="#lp-main">プライバシーポリシー</a>
              <a href="#lp-main">特定商取引法に基づく表記</a>
            </div>
          </div>
        </div>
        <div className="container footer-bottom">
          <small>© 2026 CoCoLo</small>
          <span>
            Made with <Icon name="heart" size={13} /> for every team.
          </span>
        </div>
      </footer>
    </div>
  );
}
