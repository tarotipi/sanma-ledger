# サンマ帳

三人麻雀の半荘結果から pt・円・成績・精算を出す共有ウェブアプリ（PWA）。仕様は docs/requirements.md（要件ID：F/W/N）。作業に関係する節だけを読むこと。

## 構成
- 画面：React + TypeScript（Vite）。src/client
- サーバー：Cloudflare Workers + Hono。worker/index.ts
- DB：Cloudflare D1（SQLite）。テーブルは worker/schema.ts、初回アクセス時に自動作成
- 写真：Cloudflare KV（バインディング名 PHOTOS）
- 計算：src/shared/mahjong.ts（画面とサーバーで共用）。テストは src/shared/__tests__
- 公開：GitHub の main に push すると Cloudflare Workers Builds が自動でデプロイ

## 絶対に守るルール
- 計算（順位・pt・円・成績・精算）は src/shared/mahjong.ts の純粋関数だけに書く。画面やAPIの中で計算しない
- 素点は百点単位の整数（320 = 32,000点）。円は整数。ptは10倍した整数（pt10）で扱う
- ルールの数値は RULES 定数を使う。直接数字を書かない
- 物理削除をしない。deleted_at で論理削除する
- データを変える API は、必ず変更と audit_logs への記録を同じ db.batch で行う
- audit_logs を UPDATE / DELETE しない（DBのトリガーでも拒否される）
- テーブルの列を足すときは worker/schema.ts に ALTER を追記する。既存の CREATE 文は変えない
- wrangler.jsonc の d1_databases / kv_namespaces の名前を変えない（変えると空のDBが新しく作られる）
- 画面の文言は日本語。型定義必須、any 禁止

## やらないこと
- 頼まれていない README・ドキュメント・設定ファイルを作らない
- 頼まれていない機能追加やリファクタリングをしない

## 進め方
- 変更前に、変えるファイルを一覧で示して確認を取る
- 完了報告は3行以内：変更したファイル／テスト結果／確認してほしい点
- 仕様を変える・足すときは docs/requirements.md に新しい要件IDで追記する

## オンライン三麻（卓）
仕様は docs/game-requirements.md（要件ID：R/P/C/I/D/DBG/N）。
- ルール・点数のロジック：src/shared/game/（純粋関数。画面とサーバーで共用）
  - tiles.ts 牌と山の構成 / rules.ts 数値と点数表（GAME_RULES）/ hand.ts 和了判定・待ち / yaku.ts 役と翻 / score.ts 点数の支払い / chips.ts チップ祝儀 / win.ts 和了の一括解決
  - engine.ts 1局〜半荘の進行（状態はプレーンJSON。applyAction で1手ずつ進む）
  - protocol.ts エンジン・サーバー・画面の共通の型。変えると3者に影響する
- サーバー：worker/table.ts（Durable Object。1グループ＝1卓。WebSocket）。終局時に対戦記録へ自動登録
- 画面：src/client/game/（牌SVG・卓の描画）、src/client/screens/Table.tsx（オンライン卓）、LocalTable.tsx（デバッグ卓）
- ゲームのルール数値は GAME_RULES、点数は rules.ts の表だけを使う。画面やサーバーで点数を計算しない

### 不具合の直し方
1. デバッグ卓（/g/:gid/table/local）で再現する。シードを控えると同じ山を何度でも再現できる。「状態JSONをコピー」で報告用の状態が取れる
2. 点数・役の誤りは src/shared/game/__tests__ に、その手牌をそのまま書いた失敗テストを先に足してから直す（parseTiles("1p 2p r5p w5z ...") で牌を書ける。r=赤 g=金 w=白ポッチ）
3. 進行の誤りは engine.test.ts に presetWall（山の並びを指定）で局面を作って再現する
4. オンラインだけで起きる問題は worker/table.ts のログ（[table グループID] で始まる行）を wrangler tail で見る

## コマンド
- テスト：npm test（計算） / npm run typecheck
- 手元で動かす：npm run dev（http://localhost:8787）
- APIの通し確認：npm run dev を起動した状態で node scripts/smoke.mjs
