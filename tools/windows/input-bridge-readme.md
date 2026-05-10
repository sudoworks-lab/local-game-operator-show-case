# input-bridge.ps1

PowerShell + 埋め込み C# P/Invoke で Windows のトップレベルウィンドウ操作とキーボード入力を行う helper です。

## サポートコマンド

- `list-windows`
- `focus --hwnd <decimal>`
- `tap --hwnd <decimal> --key <name>`
- `keydown --hwnd <decimal> --key <name>`
- `keyup --hwnd <decimal> --key <name>`
- `hold --hwnd <decimal> --key <name> --ms 500`
- `sequence --hwnd <decimal> --keys "W,A,S,D" --delay-ms 120`
- `click --hwnd <decimal> --x <pixels> --y <pixels>`
- `release-all`

## サポートキー

- `W`, `A`, `S`, `D`
- `F1` から `F12`
- `Space`
- `Enter`
- `Esc`
- `Shift`
- `E`, `F`, `R`
- `Up`, `Down`, `Left`, `Right`

## JSON 契約

- 成功時
  `success: true`
- 失敗時
  `success: false` と `error.message`

`list-windows` の各 window には次も含みます。

- `isMinimized`
- `bounds.left / top / right / bottom / width / height`

標準出力には JSON だけを出し、Electron 側はそれをそのまま parse します。

## キャンセル

`hold` と `sequence` は `--cancel-file <path>` を監視します。
ファイルが作られると、その時点でループを打ち切り、押下中キーを解放して終了します。

## 注意

- Windows のフォーカス制約は完全には避けられません
- 権限差があるとフォーカスや入力が失敗することがあります
- `click` の座標は対象 window の左上基準の pixel です
- 将来 native addon に置き換えても、JSON 契約は同じ形を維持する想定です
- Roblox Studio の open / reopen / screenshot 導線は `studio-open-reopen.ps1` からこの helper を呼びます
