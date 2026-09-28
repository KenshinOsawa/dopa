# Google カレンダー連携の OAuth 設定（配布する人向け）

dopa はサーバーを持たないので、Google カレンダーにはブラウザから直接接続します
（Google Identity Services の token model）。そのための **OAuth クライアント ID（ウェブアプリ）** が 1 つ要ります。
クライアント ID は公開して問題ない値です（クライアントシークレットは使いません）。

## いまの状態（設定済み）

| 項目 | 値 |
| --- | --- |
| GCP プロジェクト | `dopa-510015`（個人の Google アカウント） |
| API | Google Calendar API（有効） |
| OAuth 同意画面 | ユーザーの種類「外部」・公開ステータス「テスト中」 |
| スコープ | `https://www.googleapis.com/auth/calendar.events` のみ |
| OAuth クライアント | 種類「ウェブ アプリケーション」 |
| 承認済みの JavaScript 生成元 | `https://kenshinosawa.github.io` / `http://localhost:5173` / `http://localhost:4173` |
| クライアント ID の置き場所 | 手元: `.env.local` の `VITE_GOOGLE_CLIENT_ID`（コミットしない）／公開ビルド: GitHub の Actions 変数 `VITE_GOOGLE_CLIENT_ID` |

リダイレクト URI は使いません（token model はポップアップで完結するため、「承認済みのリダイレクト URI」は空で OK）。

## 友だちを使えるようにする（テストユーザーの追加）

「テスト中」のアプリは、**テストユーザーに登録した Google アカウントしか接続できません**（上限 100 人）。
友だちから Google アカウントのメールアドレス（Gmail など）を聞いて追加します。

1. [Google Cloud コンソール](https://console.cloud.google.com/) を開き、上部のプロジェクト選択で `dopa-510015` を選ぶ
2. 左メニュー「API とサービス」→「OAuth 同意画面」（新しい画面では「Google Auth Platform」→「対象」）
3. 「テストユーザー」の「＋ ADD USERS（ユーザーを追加）」→ メールアドレスを入力（複数はカンマか改行区切り）→「保存」
4. 友だちに「dopa を開いて、右のカレンダー欄の『Google カレンダーに接続』を押してね」と伝える

外すときは同じ画面でゴミ箱アイコン。登録していない人が接続しようとすると
「アクセスをブロック: dopa は Google の審査プロセスを完了していません」（403 access_denied）になります。

## 友だちに伝えておくこと

- 接続時に **「Google はこのアプリを確認していません」** と出ます（個人の未審査アプリなので正常）。
  「詳細」→「dopa（安全ではないページ）に移動」→ カレンダーのアクセスにチェック →「続行」
- 許可するのは予定の閲覧・作成・変更・削除（`calendar.events`）だけです。トークンはブラウザのタブの中だけにあり、どこにも保存・送信しません
- 接続は **約 1 時間で切れます**（アクセストークンの有効期限。リフレッシュトークンは使わない方式のため）。
  切れたらカレンダー欄かヘッダーの「再接続」を押すだけ（2 回目以降はアカウントを選ぶだけで戻ります）
- 連携をやめるときは dopa の 設定 →「切断」。念のため Google 側の許可も消すなら
  [Google アカウントのサードパーティ アクセス](https://myaccount.google.com/connections) から dopa を削除

## テスト中モードの制約

- 接続できるのはテストユーザー（最大 100 人）だけ
- 同意画面に「未確認のアプリ」の警告が出る
- テスト中のアプリで発行される**リフレッシュトークンは 7 日で失効**します。dopa はリフレッシュトークンを使わない（毎回 1 時間のアクセストークン）ので影響はありませんが、
  「ずっとつながったまま」にはならず、1 時間ごと・タブを開き直すごとに「再接続」が要ります
- `calendar.events` は Google の「機密性の高いスコープ」なので、テスト中をやめて「本番環境」に公開するには Google の審査（プライバシーポリシーのページ・ドメイン確認・デモ動画など）が要ります。
  友だち数人〜100 人ならテスト中のままで運用するのが手軽です

## 公開 URL を追加・変更するとき

別のドメインやユーザー名で公開する場合は、「API とサービス」→「認証情報」→ OAuth 2.0 クライアント ID（ウェブ）→
「承認済みの JavaScript 生成元」にその**オリジン**（`https://<ユーザー名>.github.io` のようにパス無し）を追加して保存します。
反映まで数分〜数時間かかることがあります。生成元に無い URL から接続すると `redirect_uri_mismatch` / `origin_mismatch` になります。

## クライアント ID の渡し方

- 手元の開発: `.env.local` に `VITE_GOOGLE_CLIENT_ID=<クライアント ID>`（`.gitignore` 済み。リポジトリには入れない）
- GitHub Pages の公開ビルド: リポジトリの Settings → Secrets and variables → Actions → **Variables** タブ →
  「New repository variable」で名前 `VITE_GOOGLE_CLIENT_ID`、値にクライアント ID（詳しくは [DEPLOY.md](DEPLOY.md)）
- 未設定のビルドでは、カレンダー欄・接続ボタンは出ず、ボードだけで動きます（設定画面にクライアント ID の入力欄が出るので、各自が自分の ID を入れて使うこともできます）

---

## 参考: ゼロから作り直す手順

同じものを別のアカウントで用意するときの手順です（いまは設定済みなので不要）。

1. **プロジェクトを作る**: [Google Cloud コンソール](https://console.cloud.google.com/) に個人の Google アカウントでログイン →
   上部のプロジェクト選択 →「新しいプロジェクト」→ 名前（例 `dopa`）→「作成」
2. **Calendar API を有効化**: 「API とサービス」→「ライブラリ」→「Google Calendar API」→「有効にする」
3. **OAuth 同意画面**: 「API とサービス」→「OAuth 同意画面」（Google Auth Platform）
   - ユーザーの種類: **外部**
   - アプリ名 `dopa`、ユーザーサポートメール・デベロッパーの連絡先に自分のメール
   - スコープ（「データアクセス」）: `https://www.googleapis.com/auth/calendar.events` を追加
   - 公開ステータスは **テスト中** のまま
   - テストユーザーに自分と友だちのメールアドレスを追加（上限 100）
4. **OAuth クライアントを作る**: 「API とサービス」→「認証情報」→「＋ 認証情報を作成」→「OAuth クライアント ID」
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みの JavaScript 生成元: `https://<github-user>.github.io` と `http://localhost:5173`（`npx vite preview` で試すなら `http://localhost:4173` も）
   - 承認済みのリダイレクト URI: 空のまま
   - 「作成」→ 表示された**クライアント ID**（`xxxx.apps.googleusercontent.com`）を控える（シークレットは使わない）
5. **クライアント ID を渡す**: `.env.local` と GitHub の Actions 変数 `VITE_GOOGLE_CLIENT_ID`（上の「クライアント ID の渡し方」）
