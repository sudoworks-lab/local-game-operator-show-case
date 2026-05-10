# Manual Test

## 1. Windows メモ帳

1. メモ帳を開く
2. アプリを起動して `タイトルなし - メモ帳` を選ぶ
3. `前面化` を押す
4. `W`, `A`, `S`, `D`, `Enter`, `Esc` を順に送る
5. `Hold W 500ms` を押す
6. `プレビュー更新` と `スクショ保存` を押す
7. `操作ログ` に成功ログが出ることを確認する

期待:

- フォーカスが取れればメモ帳にキー入力が入る
- Enter は改行になる
- Esc はメモ帳上で大きな変化はなくても helper が成功を返す

## 2. Unity ゲーム

1. Unity Editor で対象プロジェクトを開く
2. Play モードに入る
3. 対象 Game View を前面に出す
4. アプリで Unity ウィンドウを選ぶ
5. `前面化` の後に `W / A / S / D / Space` を送る
6. `Hold W 500ms` で前進入力を確認する

期待:

- ゲーム側に入力が届く
- 緊急停止で hold / sequence を止められる

## 3. Roblox Studio / Roblox クライアント

1. Roblox Studio か Roblox クライアントを起動する
2. ローカルテスト対象のウィンドウを前面化できることを確認する
3. `W / A / S / D / Space` を送る
4. `プレビュー更新` と `Analyze Preview` を実行する

期待:

- 入力とスクリーンショット保存が成功する
- mock provider なら固定応答、HTTP provider なら localhost 応答が UI とログに出る

## 4. Roblox Studio open / reopen flow

1. `current-latest.rbxlx` など、開きたい target place の Windows path を控える
2. 状態確認:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./tools/windows/studio-open-reopen.ps1 -Command status -TargetPath "<windows-temp>\\roblox-tiktok-jamming-game-build\\current-latest.rbxlx"
```

3. `studioState` が `closed / home / minimized-target-open / local-file-open / target-open` のどれかで返ることを確認する
4. reopen + Play + screenshot:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./tools/windows/studio-open-reopen.ps1 -Command play-capture -TargetPath "<windows-temp>\\roblox-tiktok-jamming-game-build\\current-latest.rbxlx"
```

5. JSON の `openMethod`, `studioStateBefore`, `studioStateAfter`, `screenshotPath` を確認する
6. `autoRecoveryDialogDetected`, `autoRecoveryAction`, `autoRecoveryReason` も確認する
7. `screenshotPath` の PNG で、Studio が Play 開始後の状態まで進んでいるかを確認する

期待:

- Studio が閉じていても explicit path reopen できる
- Studio が最小化されていても restore / focus できる
- ホーム画面や `自動復元` ダイアログがあっても target place を優先して reopen できる
- `自動復元` ダイアログが出た場合は `Ignore` を選び、古い復元ファイルを自動で開かない
- `play-capture` が screenshot path を返す
- 失敗時も状態と screenshot を残して止まる

## 失敗しやすい条件

- フォーカスが取れていない
- 管理者権限差がある
- IME が日本語入力状態になっている
- キーボードレイアウト差がある
- desktop capture source が一時的に取れない
- WSL 経由起動で Windows 側フォーカス制御が弱くなる
