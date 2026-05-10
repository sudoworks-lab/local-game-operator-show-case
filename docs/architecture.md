# Architecture

## 境界

- Electron main
  BrowserWindow、IPC、desktop capture、provider 実行、ログ保存を担当します。
- Electron preload
  renderer へ最小限の API だけを `contextBridge` で公開します。
- Electron renderer
  操作卓 UI と状態管理だけを担当します。Node の直接権限は持ちません。
- PowerShell helper
  Win32 API を呼んでウィンドウ列挙、前面化、キーボード入力を行います。
- Ops CLI
  `src/cli.ts` から `status`、`verify-artifacts`、`safety-scan` を実行し、Electron / Vite 依存に触れずに Node 22 のローカル確認を行います。

## 主要フロー

1. renderer が preload API 経由で `windows:list` を呼ぶ
2. main が helper からトップレベルウィンドウ一覧を取得する
3. main が desktop capture source と突き合わせて capture 可否を付与する
4. renderer が選択した HWND に対して `focus / tap / hold / sequence` を投げる
5. main が helper を子プロセス実行し、JSON を返す
6. すべての操作を UI とローカルログファイルへ記録する

## helper 呼び出し設計

- Electron から helper は常にプロセス分離で呼びます
- 長時間操作は cancel file を使って中断可能にしています
- 緊急停止は進行中操作のキャンセル要求に加え、対応キー全解放を実行します
- 将来 native addon 化する場合も `HelperBridge` を差し替えれば UI / IPC 契約を保てます

## provider 設計

- `ProviderService` が active provider を解決します
- 現在は `mock` と `http` を実装しています
- HTTP provider は画像パス、画像 base64、context を localhost endpoint へ送ります
- analyze 結果は操作ログと UI の provider 状態に反映します

## 保存物

- logs
  userData 配下の日次 JSON Lines
- captures
  userData 配下の PNG
- provider config
  repo 配下の `config/providers.local.json` または `config/providers.example.json`

## ops CLI

- `npm run ops -- status`
  package script、TS include、required source file、runtime 出力の除外設定を JSON で確認します。
- `npm run ops -- verify-artifacts`
  `node_modules/`、`artifacts/`、`logs/`、`cache/` が git 管理外になる前提を確認します。
- `npm run ops -- safety-scan`
  repository 内の text file を確認し、該当箇所は file / rule / line のみを返します。

## Future Work

Playwright automation, external MCP host integration, and codex_apps integration are out of scope for this pass. They should be evaluated later as explicit, opt-in local adapters with their own verification and review artifacts.
