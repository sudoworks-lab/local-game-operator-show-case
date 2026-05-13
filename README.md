# local-game-operator-showcase

Windows-local Electron tool for assisted game and editor operation with JSON-first reporting.
It prioritizes state inspection and selected-window input helpers over broad or silent automation.

## 概要

`local-game-operator-showcase` は、Windows ローカル環境でゲームやエディタの状態確認を補助する Electron ベースの repo です。

重点は危険な自動操作ではなく、`JSON reporting` による状態把握、対象ウィンドウを明示した操作補助、失敗を隠さない実行結果の返し方にあります。

## 作った理由

ローカルのゲーム操作補助は、いきなり入力送信中心で作ると危険になりやすく、何をしたかも追いにくくなります。そこでこの repo では、先に状態を調べ、その結果を JSON で返し、必要な入力だけを明示的に実行する設計を取っています。

AIを使う余地があっても、まずは安全な観測と限定的な操作を分けることを優先しています。

## このリポジトリで見せたいこと

- `JSON reporting` を中心にした、ローカル操作補助の安全設計。
- 画面全体の無差別操作ではなく、選択したウィンドウに対する補助操作を重視する考え方。
- Electron UI、preload、main process、PowerShell helper を分離した境界設計。
- 長押しや連続操作を中断できるようにして、誤作動を見えやすくする作り。
- 将来の分析連携に備えつつ、provider を固定しない抽象化。

## 主な機能

- `src/main/`: IPC handler、capture、logging、helper bridge を持つ main process 層です。
- `src/preload/`: renderer 側へ必要最小限だけ渡す bridge です。
- `src/renderer/`: ローカル操作ダッシュボード UI です。
- `tools/windows/input-bridge.ps1`: キー入力や window 情報を JSON で返す helper です。
- `tools/windows/studio-open-reopen.ps1`: Roblox Studio 向けの保守的な補助フローです。
- `config/providers.example.json`: mock / local HTTP provider の設定例です。

## 検証方法

Node 22 のローカル環境では、依存 package を追加せずに ops baseline を確認できます。

```bash
npm run build
npm run verify
npm test
npm run ops -- status
npm run ops -- verify-artifacts
npm run ops -- safety-scan
```

`npm run ops -- status` は package script、TS 対象 file、runtime 出力の除外設定を JSON で返します。
`verify-artifacts` は `node_modules/`、`artifacts/`、`logs/`、`cache/` の除外設定を確認します。
`safety-scan` は対象 file と rule の位置だけを返し、該当行の本文は出しません。

Electron app 側の検証には依存 package が必要です。

```bash
npm install
npm run typecheck
```

Windows host では helper の疎通確認もできます。

```bash
npm run helper:list-windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./tools/windows/input-bridge.ps1 list-windows
```

## 技術スタック

- Electron Forge
- Vite
- TypeScript
- PowerShell + C# P/Invoke helper
- JSON reporting contract
- local mock / HTTP provider abstraction

## 現状と制限

- これは Windows ローカル向けの MVP です。
- cloud service や常駐 daemon ではありません。
- OS の権限境界や focus 制約を回避する設計にはしていません。
- screenshot、capture、log、runtime 出力は git 管理外に置く前提です。
