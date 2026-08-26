import './landing-page.css';

const painPoints = [
  {
    number: '01',
    title: 'どれが最新？',
    description:
      '変更連絡が会話の途中に流れ、集合時間や持ち物を何度も探してしまう。',
  },
  {
    number: '02',
    title: '誰が回答済み？',
    description:
      '返信やスタンプを拾い集め、未回答の家庭を別のメモで管理している。',
  },
  {
    number: '03',
    title: '資料はどこ？',
    description:
      '回覧や申込書が別々のトークに埋もれ、必要なときに見つからない。',
  },
] as const;

const features = [
  {
    icon: 'calendar',
    status: '順次提供',
    title: '予定・出欠',
    description: '日時、場所、締切、回答状況をひとつの予定画面で確認。',
  },
  {
    icon: 'bulletin',
    status: '順次提供',
    title: '回覧・添付',
    description: 'お知らせと資料をまとめ、既読・未読の状況も整理。',
  },
  {
    icon: 'car',
    status: '順次提供',
    title: '送迎管理',
    description: '乗車希望と配車状況を整理し、管理者の確認後に共有。',
  },
  {
    icon: 'wallet',
    status: '順次提供',
    title: '注文・集金',
    description: '注文内容と現金・振込の確認状態をメンバー単位で管理。',
  },
  {
    icon: 'users',
    status: '順次提供',
    title: 'メンバー・役員',
    description: '所属や年度ごとの役割を整理し、運営の引き継ぎを支援。',
  },
  {
    icon: 'bell',
    status: '順次提供',
    title: 'LINE通知',
    description:
      '予定の作成や回覧の掲載をLINE通知へ登録し、対象画面への導線を用意。',
  },
] as const;

const roles = [
  {
    label: '運営者',
    title: '集計と確認を、画面ごとに。',
    description: '未回答・未読・支払い状況を目的別に把握できます。',
  },
  {
    label: '保護者',
    title: 'わが家に必要な情報へ、迷わず。',
    description:
      '担当する子どもの予定や回答、注文をひとつの場所で確認できます。',
  },
  {
    label: 'スタッフ',
    title: '必要な運用だけ、すっきり。',
    description: '権限に応じた機能で、予定や回覧の運用に集中できます。',
  },
] as const;

const steps = [
  {
    number: '01',
    label: '気づく',
    title: 'いつもの場所で、通知に気づく。',
    description: 'LINEは、予定や回覧が届いたことを知らせる入口に。',
  },
  {
    number: '02',
    label: '見る',
    title: 'CoCoLoで、必要な情報を見る。',
    description: '日時、場所、回答、資料を、目的ごとの画面で確認。',
  },
  {
    number: '03',
    label: '戻る',
    title: 'あとから、同じ場所に戻れる。',
    description: '会話をさかのぼらなくても、最新の状態を見つけられます。',
  },
] as const;

function FeatureIcon({ name }: { name: (typeof features)[number]['icon'] }) {
  const glyphs = {
    calendar: '予',
    bulletin: '回',
    car: '送',
    wallet: '集',
    users: '人',
    bell: '通',
  } as const;

  return <span aria-hidden="true">{glyphs[name]}</span>;
}

export function LandingPage() {
  return (
    <div className="landing-page" data-design-system="cocolo">
      <a className="landing-skip-link" href="#landing-main">
        本文へ移動
      </a>

      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a
            className="landing-brand"
            href="/"
            aria-label="CoCoLo トップページ"
          >
            <span className="landing-brand-mark" aria-hidden="true">
              C
            </span>
            CoCoLo
          </a>
          <span className="landing-header-tagline">みんなの連絡帳</span>
          <nav className="landing-nav" aria-label="トップページメニュー">
            <a href="#challenge">課題</a>
            <a href="#how">使い方</a>
            <a href="#line-and-cocolo">LINEとの使い分け</a>
            <a href="#features">できること</a>
          </nav>
          <a className="landing-header-cta" href="/login">
            ログイン
          </a>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-kicker">
                <span>CoCoLo</span> みんなの連絡帳
              </p>
              <h1 id="landing-hero-title">
                伝えたいことが、
                <span>ちゃんと届く。</span>
                <em>必要なときに、戻れる。</em>
              </h1>
              <p className="landing-hero-lead">
                大切な連絡が、チャットに埋もれないように。
                部活やクラブの連絡を、気軽にやりとりできる場所へ。
                LINEは通知の入口に、確定した情報はCoCoLoに整理。
                探す、聞き直す、集計し直す時間を減らします。
              </p>
              <div className="landing-actions">
                <a
                  className="landing-button landing-button-primary"
                  href="/login"
                >
                  利用中の方はログイン
                  <span aria-hidden="true">↗</span>
                </a>
                <a
                  className="landing-button landing-button-secondary"
                  href="#how"
                >
                  まずは使い方を見る
                </a>
              </div>
              <ul
                className="landing-topic-list"
                aria-label="CoCoLoで整理できる情報"
              >
                <li>
                  <span aria-hidden="true">○</span> 予定
                </li>
                <li>
                  <span aria-hidden="true">○</span> 出欠
                </li>
                <li>
                  <span aria-hidden="true">○</span> 回覧
                </li>
                <li>
                  <span aria-hidden="true">○</span> 送迎
                </li>
                <li>
                  <span aria-hidden="true">○</span> 注文・集金
                </li>
              </ul>
            </div>
            <figure className="landing-hero-visual">
              <div className="landing-hero-image-wrap">
                <img
                  src="/assets/cocolo-hero-organized-communication.webp"
                  alt="CoCoLoで予定や連絡を整理したイメージ"
                  width="1400"
                  height="933"
                  fetchPriority="high"
                />
                <div className="landing-hero-sticker landing-hero-sticker-top">
                  <span className="landing-sticker-dot" aria-hidden="true" />
                  今日の予定
                  <strong>3件</strong>
                </div>
                <div className="landing-hero-sticker landing-hero-sticker-bottom">
                  <span aria-hidden="true">✓</span>
                  みんなの回答がまとまりました
                </div>
              </div>
              <figcaption>
                <span aria-hidden="true">✦</span>
                ばらばらの連絡を、目的ごとの情報へ。
              </figcaption>
            </figure>
          </div>
          <div className="landing-container landing-hero-note">
            <span>
              <strong>01</strong> むずかしい操作は、できるだけ少なく
            </span>
            <span>
              <strong>02</strong> 必要な情報は、いつも同じ場所に
            </span>
            <span>
              <strong>03</strong> 役割に合わせて、見やすく
            </span>
          </div>
        </section>

        <section
          className="landing-section landing-challenge"
          id="challenge"
          aria-labelledby="challenge-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">THE CHALLENGE</p>
              <h2 id="challenge-title">その連絡、あとから見つけられますか？</h2>
              <p>
                チャットはすぐに伝えられる一方で、チーム運営の情報は会話の流れに埋もれがちです。
              </p>
            </div>
            <div className="landing-pain-grid">
              {painPoints.map((point) => (
                <article className="landing-pain-card" key={point.number}>
                  <span>{point.number}</span>
                  <h3>{point.title}</h3>
                  <p>{point.description}</p>
                </article>
              ))}
            </div>
            <p className="landing-challenge-answer">
              <span aria-hidden="true">↗</span>
              CoCoLoは、情報ごとに決まった居場所をつくります。
            </p>
          </div>
        </section>

        <section
          className="landing-section landing-how"
          id="how"
          aria-labelledby="how-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading-centered">
              <p className="landing-eyebrow">HOW COCOLO WORKS</p>
              <h2 id="how-title">いつもの連絡に、戻れる場所を。</h2>
              <p>
                新しいことをたくさん覚えなくても大丈夫。気づいて、見て、あとから戻る。それだけです。
              </p>
            </div>
            <div className="landing-step-grid">
              {steps.map((step, index) => (
                <article className="landing-step-card" key={step.number}>
                  <div className="landing-step-topline">
                    <span>{step.number}</span>
                    {index < steps.length - 1 ? (
                      <i aria-hidden="true">→</i>
                    ) : null}
                  </div>
                  <p className="landing-step-label">{step.label}</p>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-handoff"
          id="line-and-cocolo"
          aria-labelledby="handoff-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading-centered">
              <p className="landing-eyebrow">LINE × CoCoLo</p>
              <h2 id="handoff-title">LINEをやめずに、情報の迷子をなくす。</h2>
              <p>
                得意な役割を分けるから、いつもの連絡手段を活かしながら、最新情報へ戻れます。
              </p>
            </div>
            <div className="landing-handoff-flow">
              <article className="landing-handoff-card landing-handoff-card-line">
                <p className="landing-handoff-label">LINE</p>
                <h3>通知に気づく</h3>
                <p>
                  LINE連携を設定したチームでは、予定の作成や回覧の掲載を知らせる通知を登録できます。
                </p>
                <ul>
                  <li>いつもの場所で気づける</li>
                  <li>対象画面への入口になる</li>
                </ul>
              </article>
              <div className="landing-flow-arrow" aria-hidden="true">
                ↗
              </div>
              <article className="landing-handoff-card landing-handoff-card-cocolo">
                <p className="landing-handoff-label">CoCoLo</p>
                <h3>詳細を確認し、最新状態を残す</h3>
                <p>
                  予定、回答、割当、既読、集金状態を、目的別の画面で確認します。
                </p>
                <ul>
                  <li>返信の波に埋もれない</li>
                  <li>必要な情報へ戻りやすい</li>
                </ul>
              </article>
            </div>
            <p className="landing-handoff-note">
              LINEへの返信だけでは出欠などは確定しません。最新の回答状況はCoCoLoで確認できます。
            </p>
          </div>
        </section>

        <section
          className="landing-section landing-features"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">FEATURES</p>
              <h2 id="features-title">
                チーム運営に必要な情報を、目的ごとに整理。
              </h2>
              <p>
                ひとつの長い会話ではなく、確認したい内容ごとに入口を分けます。
              </p>
            </div>
            <div className="landing-feature-grid">
              {features.map((feature) => (
                <article className="landing-feature-card" key={feature.title}>
                  <span className="landing-feature-icon">
                    <FeatureIcon name={feature.icon} />
                  </span>
                  <span className="landing-feature-status">
                    {feature.status}
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
            <p className="landing-availability-note">
              各機能は、公開環境での受入検証を進めながら順次提供しています。利用可否はチームごとの契約・設定によっても異なります。
            </p>
          </div>
        </section>

        <section
          className="landing-section landing-roles"
          aria-labelledby="roles-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading-centered">
              <p className="landing-eyebrow">FOR EVERY ROLE</p>
              <h2 id="roles-title">運営する人にも、受け取る人にも。</h2>
              <p>
                役割に応じて見せる範囲を分け、必要な作業に集中できるようにします。
              </p>
            </div>
            <div className="landing-role-grid">
              {roles.map((role) => (
                <article className="landing-role-card" key={role.label}>
                  <p>{role.label}</p>
                  <h3>{role.title}</h3>
                  <span>{role.description}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-trust"
          aria-labelledby="trust-title"
        >
          <div className="landing-container landing-trust-grid">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">THOUGHTFUL BY DESIGN</p>
              <h2 id="trust-title">チームの情報だから、見せる範囲を丁寧に。</h2>
              <p>
                連絡を便利にするだけでなく、誰に何を見せるかもチーム運営の一部として設計します。
              </p>
            </div>
            <div className="landing-trust-panel">
              <p className="landing-trust-panel-label">CoCoLoの考え方</p>
              <ul className="landing-trust-list">
                <li>
                  <span aria-hidden="true">01</span>
                  <div>
                    <strong>役割に応じた表示</strong>
                    <p>運営者、スタッフ、保護者に必要な情報を分けます。</p>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">02</span>
                  <div>
                    <strong>チーム単位で整理</strong>
                    <p>所属するチームを境界に、情報を取り扱います。</p>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">03</span>
                  <div>
                    <strong>必要最小限の共有</strong>
                    <p>グループ通知へ不要な個人情報を載せない方針です。</p>
                  </div>
                </li>
              </ul>
              <p className="landing-trust-panel-note">
                便利さと安心を、どちらもあきらめないために。
              </p>
            </div>
          </div>
        </section>

        <section
          className="landing-final-cta"
          aria-labelledby="final-cta-title"
        >
          <div className="landing-container landing-final-cta-inner">
            <div>
              <p className="landing-eyebrow">ONE PLACE, ONE TEAM</p>
              <h2 id="final-cta-title">
                連絡を探す時間を、チームを支える時間へ。
              </h2>
              <p>
                散らばりがちな情報を整理して、保護者も運営者も、それぞれに必要な最新情報を確認できる場所を。
              </p>
            </div>
            <div className="landing-actions">
              <a className="landing-button landing-button-light" href="/login">
                利用中の方はログイン <span aria-hidden="true">↗</span>
              </a>
              <a
                className="landing-button landing-button-outline-light"
                href="/manual"
              >
                操作マニュアルを見る
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div>
            <a
              className="landing-brand landing-brand-footer"
              href="/"
              aria-label="CoCoLo トップページ"
            >
              <span className="landing-brand-mark" aria-hidden="true">
                C
              </span>
              CoCoLo
            </a>
            <p>部活・クラブの予定、回答、連絡をひとつの場所へ。</p>
          </div>
          <nav aria-label="フッターメニュー">
            <a href="#features">できること</a>
            <a href="/manual">操作マニュアル</a>
            <a href="/login">ログイン</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
