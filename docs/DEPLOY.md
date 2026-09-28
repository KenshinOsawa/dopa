# GitHub Pages への公開

dopa は静的ファイルだけのアプリなので、GitHub Pages にそのまま置けます。
ビルドと公開は `.github/workflows/deploy.yml`（GitHub Actions）が行います。

公開 URL は `https://<GitHub ユーザー名>.github.io/<リポジトリ名>/`（例 `https://kenshinosawa.github.io/dopa/`）。

## 1. リポジトリを作って push

GitHub で新しいリポジトリを作成（例 `dopa`、Public。Private リポジトリの Pages は有料プランが必要）。
README などは追加せず空のまま作り、手元から push します。

```bash
cd ~/Claude\ Code/dopa
git remote add origin git@github.com:<GitHub ユーザー名>/dopa.git
git branch -M main
git push -u origin main
```

`.env.local`（クライアント ID）は `.gitignore` 済みなので push されません。

## 2. Actions 変数にクライアント ID を登録（カレンダー連携を使う場合）

リポジトリの **Settings → Secrets and variables → Actions → Variables** タブ →「New repository variable」

- Name: `VITE_GOOGLE_CLIENT_ID`
- Value: OAuth クライアント ID（`xxxx.apps.googleusercontent.com`。[SETUP_OAUTH.md](SETUP_OAUTH.md)）

クライアント ID は公開してよい値なので Secret ではなく Variable で OK（ビルド後の JS には必ず含まれます）。
登録しなければカレンダー連携の無い版として公開されます。

## 3. Pages を有効化

リポジトリの **Settings → Pages** →「Build and deployment」の Source を **GitHub Actions** にする。

## 4. デプロイ

- `main` に push するたびに自動でデプロイ（テスト・lint → ビルド → 公開）
- 手動なら **Actions** タブ →「Deploy to GitHub Pages」→「Run workflow」
- 完了すると Actions の実行結果と Settings → Pages に URL が出ます

ワークフローがしていること:

- `BASE_PATH=/<リポジトリ名>/` でビルド（アセット・Service Worker・manifest をサブパスで配信するため）
- `VITE_GOOGLE_CLIENT_ID` を Actions 変数から渡す
- `dist/index.html` を `404.html` にもコピー（直リンク・リロードでも画面が出るように）

## 5. OAuth 側の確認

公開 URL のオリジン（`https://<GitHub ユーザー名>.github.io`）が OAuth クライアントの
「承認済みの JavaScript 生成元」に入っていることを確認します（[SETUP_OAUTH.md](SETUP_OAUTH.md)）。
リポジトリ名はオリジンに含まれないので、リポジトリ名を変えても OAuth 側の変更は不要です。

## 更新が友だちに届くまで

- Service Worker は画面（index.html）をネット優先で取るので、次に開いたときに新しい版が読み込まれます
  （開きっぱなしのタブは再読み込みで）
- データ（IndexedDB）は更新しても消えません。同じ URL（オリジン＋パス）で公開し続ける限り残ります。
  **ユーザー名やドメインを変えると別のサイト扱いになり、データは引き継がれません**（その場合は旧 URL で書き出し → 新 URL で読み込み）

## 手元で本番と同じビルドを確かめる

```bash
BASE_PATH=/dopa/ npm run build
npx vite preview --port 4173 --base /dopa/   # http://localhost:4173/dopa/
```
