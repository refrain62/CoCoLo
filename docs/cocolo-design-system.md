# CoCoLo デザインシステム

更新日：2026-08-26

## 目的

CoCoLoは、システムに慣れていない人でも「どこを見ればよいか」「次に何をすればよいか」を迷わず理解できる画面をつくる。

公開LPと認証済み管理画面は、同じデザイントークンと共通UIを使い、場所が変わってもCoCoLoらしい温かさと安心感が続く状態を保つ。

LINE連携をサービスの入口として扱うため、LINE Design Systemの基礎方針をCoCoLoのデザイントークンへ取り入れる。

LINEのブランド表現をそのまま複製するのではなく、LINE Greenを主操作の色、白とグレーを情報整理の面、CoCoLoのコーラルとイエローを補助的な差し色として使い分ける。

参照元は[LINE Design System Foundation](https://designsystem.line.me/LDSM/foundation)と[LINE Color Guide](https://designsystem.line.me/LDSM/foundation/color/line-color-guide-ex-en)とする。

## 基本原則

1. **やさしく案内する**：専門用語を減らし、画面の目的と次の行動を近くに置く。
2. **情報を整理して見せる**：1画面1目的、見出し・説明・操作の順で構成する。
3. **色に頼りすぎない**：状態は必ずラベルや文章を併用し、色だけで意味を伝えない。
4. **失敗しても戻れる**：読み込み中、空状態、エラー、権限不足、保存成功を区別し、再試行や戻る導線を示す。
5. **指で押しやすくする**：主要な操作領域は44px以上、キーボードではvisible focusを表示する。

## トークン

トークンの正本は`apps/web/src/styles.css`の`:root`です。共有プリミティブは`packages/ui/src/index.tsx`で、`--cocolo-*`トークンを参照する。

### 色

| トークン | 役割 | 使用例 |
| --- | --- | --- |
| `--cocolo-ink` | 基本文字 | 見出し、本文 |
| `--cocolo-muted` | 補助文字 | 説明、補足、メタ情報 |
| `--cocolo-brand` | 主役の緑 | 主ボタン、リンク、選択状態 |
| `--cocolo-brand-strong` | 濃い緑 | hover、暗い背景、強調文字 |
| `--cocolo-brand-foreground` | LINE Green上の濃色文字 | LINE Greenの塗りに載せる本文・操作ラベル |
| `--cocolo-brand-soft` | 淡い緑 | カード背景、補助アクション |
| `--cocolo-coral` | あたたかい差し色 | バッジ、装飾、重要な視線誘導 |
| `--cocolo-yellow` / `--cocolo-link` / `--cocolo-navy` | 補助色 | 視線誘導、リンク、暗い背景 |
| `--cocolo-coral-ink` | 差し色の本文用濃色 | 明るい背景上の小さな文字 |
| `--cocolo-danger` / `--cocolo-success` | 状態の意味色 | エラー、成功 |
| `--cocolo-line` | 境界線 | カード、入力、表 |
| `--cocolo-focus` | フォーカス | キーボード操作時の輪郭 |

コーラルは明るい背景上の本文色として使用せず、文字には必ず`--cocolo-coral-ink`を使う。状態色を使う場合も、ラベルや文章を省略しない。

### LINE連携を前提にした適用方針

| 適用対象 | 方針 |
| --- | --- |
| 主操作 | `--cocolo-brand`へLINE Green（`#06C755`）を割り当て、開始、保存、接続などの主操作に使う |
| 補助操作 | 白背景とグレーの境界線を基本にし、主操作と競合する色を増やさない |
| LINE連携 | LINEへの通知やログインはLINE Greenのバッジと短い説明を組み合わせ、色だけで連携状態を伝えない |
| CoCoLoの個性 | コーラルとイエローは視線誘導と状態補助に限定し、主ボタンへ常用しない |
| 文字 | OSのシステムフォントを優先し、本文は12px未満を避ける。見出しと本文の階層をサイズと太さで分ける |
| 形 | 余白は4px基準、一般部品の角丸は8pxまたは12px、大きなまとまりは20pxを基準にする |

LINE Greenはブランドとの接続を示す色であり、通知の成功や業務状態を表す色とは分けて扱う。

LINE Green（`#06C755`）の塗りに白文字を常用するとコントラストが不足するため、通常状態の文字には`--cocolo-brand-foreground`を使う。濃い緑の背景で白文字を使う場合は`--cocolo-brand-strong`を使う。

### 形・余白・動き

- 余白は`--cocolo-space-*`の4px基準で選び、画面固有の細かな値を増やさない。
- 入力と主要ボタンは`--cocolo-control-height`以上にする。
- 小さな部品は`--cocolo-radius-sm`、カードは`--cocolo-radius-md`、大きなまとまりは`--cocolo-radius-lg`を使う。
- 浮き上がりは`--cocolo-shadow-sm`を基本とし、ダイアログなど重要な層だけ`--cocolo-shadow-md`を使う。
- hoverの移動や色の変化は`--cocolo-transition-fast`に揃え、`prefers-reduced-motion`では動きを止める。

## コンポーネントの使い分け

管理画面では、ボタン、カード、バッジ、入力、select、table、dialog、alert、empty state、sectionを`packages/ui`から利用する。

画面固有CSSはレイアウトと情報の並べ方に限定し、独自の色・角丸・フォーカス表現を追加しない。新しい状態や部品が必要な場合は、先に共有プリミティブまたはトークンへ追加する。

管理画面のナビゲーションは、roleとfeature契約で表示可否を決める。見えない機能を色やdisabledだけで予告せず、利用できる操作だけをメニューへ表示する。

## 画面構成

### 公開LP

「気づく → 見る → 戻る」の流れで、課題、使い方、機能、LINEとの役割分担、利用開始を説明する。

ヒーローでは「LINEグループへ通知、整理はCoCoLo」という役割分担と、利用開始の主操作を同じ視界に置く。

機能紹介では、LINEを連絡の入口、CoCoLoを予定、出欠、資料、権限の整理場所として説明する。

公開LPでは、個人LINEへの通知、LINEグループの自動接続、LINEメッセージへの返信だけで業務状態が確定するとは説明しない。

### 管理画面

画面上部にチームとrole、左側または上部に現在利用できるメニュー、本文に画面の目的・説明・操作・状態を配置する。ダッシュボードは概要と次の行動に集中し、詳細操作は専用画面へ分ける。

## 受け入れチェック

- 390px、430px、768px、1280px以上で横スクロールが発生しない。
- キーボード操作で現在位置が見え、主要操作が44px以上ある。
- loading、empty、error、success、forbidden、disabled、未契約を区別できる。
- 色を識別しにくい条件でも、文章とラベルだけで意味が分かる。
- `pnpm test`、`pnpm lint`、`pnpm build`、`git diff --check`が成功する。
