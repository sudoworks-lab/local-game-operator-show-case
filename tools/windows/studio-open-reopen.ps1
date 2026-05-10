param(
  [ValidateSet('status', 'play-capture')]
  [string]$Command = 'status',

  [string]$TargetPath,

  [string]$OutDir,

  [string]$PlayKey = 'F5',

  [int]$LaunchWaitMs = 15000,

  [int]$PlayWaitMs = 2500,

  [switch]$NoViewportClick
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Merge-Hashtable {
  param(
    [hashtable]$Target,
    [hashtable]$Source
  )

  if ($null -eq $Source) {
    return $Target
  }

  foreach ($key in $Source.Keys) {
    $Target[$key] = $Source[$key]
  }

  return $Target
}

function Write-JsonExit {
  param(
    [int]$ExitCode,
    [hashtable]$Payload
  )

  $Payload['timestamp'] = [DateTimeOffset]::UtcNow.ToString('o')
  $json = $Payload | ConvertTo-Json -Depth 10 -Compress
  Write-Output $json
  exit $ExitCode
}

function Get-RepoRoot {
  return Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Get-ScriptPath {
  param([string]$Name)

  return Join-Path $PSScriptRoot $Name
}

function Get-DefaultOutDir {
  return Join-Path $env:TEMP 'local-game-operator-studio-flow'
}

function Get-TimeStampSlug {
  return [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')
}

function Convert-ToWindowsPath {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  if ($Value -match '^[A-Za-z]:\\') {
    return [System.IO.Path]::GetFullPath($Value)
  }

  if ($Value -match '^/mnt/([a-zA-Z])/(.+)$') {
    $drive = $matches[1].ToUpperInvariant()
    $rest = ($matches[2] -replace '/', '\')
    return "${drive}:\$rest"
  }

  throw 'Path must be a Windows path like C:\path\to\place.rbxlx or a /mnt/<drive>/... path that can be normalized safely.'
}

function Invoke-JsonScript {
  param(
    [string]$ScriptPath,
    [string[]]$Arguments
  )

  $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $stdoutPath = Join-Path $env:TEMP ("local-game-operator-" + [guid]::NewGuid().ToString('N') + ".stdout")
  $stderrPath = Join-Path $env:TEMP ("local-game-operator-" + [guid]::NewGuid().ToString('N') + ".stderr")
  $process = $null
  $startArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $Arguments

  try {
    $process = Start-Process `
      -FilePath $powershellPath `
      -ArgumentList $startArguments `
      -Wait `
      -PassThru `
      -NoNewWindow `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $rawOutput = @()
    if (Test-Path -LiteralPath $stdoutPath) {
      $rawOutput += @(
        Get-Content -LiteralPath $stdoutPath -Encoding UTF8 -ErrorAction SilentlyContinue |
          Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
      )
    }
    if (Test-Path -LiteralPath $stderrPath) {
      $rawOutput += @(
        Get-Content -LiteralPath $stderrPath -Encoding UTF8 -ErrorAction SilentlyContinue |
          Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
      )
    }

    $json = $rawOutput | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($json)) {
      throw "Script $ScriptPath did not return JSON output."
    }

    return $json | ConvertFrom-Json
  } finally {
    if (Test-Path -LiteralPath $stdoutPath) {
      Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrPath) {
      Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-JsonErrorMessage {
  param(
    $Result,
    [string]$Fallback
  )

  if ($Result -and $Result.error -and -not [string]::IsNullOrWhiteSpace([string]$Result.error.message)) {
    return [string]$Result.error.message
  }

  return $Fallback
}

function Invoke-InputBridge {
  param([string[]]$Arguments)

  return Invoke-JsonScript -ScriptPath (Get-ScriptPath 'input-bridge.ps1') -Arguments $Arguments
}

function Invoke-WindowCapture {
  param(
    [string]$Hwnd,
    [string]$OutputPath
  )

  return Invoke-JsonScript -ScriptPath (Get-ScriptPath 'capture-window.ps1') -Arguments @(
    '-Hwnd', $Hwnd,
    '-OutPath', $OutputPath
  )
}

function Get-StudioBinaryPath {
  $command = Get-Command RobloxStudioBeta.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }

  $versionsRoot = Join-Path $env:LOCALAPPDATA 'Roblox\Versions'
  if (-not (Test-Path -LiteralPath $versionsRoot)) {
    throw 'Roblox Studio binary was not found under %LOCALAPPDATA%\Roblox\Versions.'
  }

  $candidate = Get-ChildItem -LiteralPath $versionsRoot -Directory |
    ForEach-Object { Join-Path $_.FullName 'RobloxStudioBeta.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $candidate) {
    throw 'RobloxStudioBeta.exe could not be resolved from installed Roblox versions.'
  }

  return $candidate.FullName
}

function Get-StudioWindows {
  $result = Invoke-InputBridge @('list-windows')
  if (-not $result.success) {
    throw (Get-JsonErrorMessage -Result $result -Fallback 'input-bridge list-windows failed.')
  }

  $windows = @($result.windows)
  return @(
    $windows | Where-Object {
      $_.processName -eq 'RobloxStudioBeta' -and
      -not [string]::IsNullOrWhiteSpace($_.title)
    }
  )
}

function Test-IsAutoRecoveryDialogWindow {
  param($Window)

  if ($null -eq $Window) {
    return $false
  }

  if ([string]$Window.processName -ne 'RobloxStudioBeta') {
    return $false
  }

  $title = [string]$Window.title
  if ([string]::IsNullOrWhiteSpace($title) -or $title -like '*Roblox Studio*') {
    return $false
  }

  $bounds = $Window.bounds
  if ($null -eq $bounds) {
    return $false
  }

  $width = [int]$bounds.width
  $height = [int]$bounds.height

  return (
    $width -ge 320 -and $width -le 900 -and
    $height -ge 180 -and $height -le 650
  )
}

function Get-AutoRecoveryDialogWindow {
  param([object[]]$Windows)

  return @($Windows | Where-Object { Test-IsAutoRecoveryDialogWindow $_ }) | Select-Object -First 1
}

function Get-StudioWindowKind {
  param(
    $Window,
    [string]$NormalizedTargetPath
  )

  if ($null -eq $Window) {
    return 'closed'
  }

  if (Test-IsAutoRecoveryDialogWindow $Window) {
    return 'auto-recovery-dialog'
  }

  $title = [string]$Window.title
  if (
    $title -eq 'Roblox Studio' -or
    $title -match '(^|\s)(Home|ホーム)(\s|$)' -or
    $title -match 'Start Page'
  ) {
    return 'home'
  }

  if ($NormalizedTargetPath -and $title -eq "$NormalizedTargetPath - Roblox Studio") {
    return 'target-open'
  }

  if ($title -match '^[A-Za-z]:\\.+ - Roblox Studio$') {
    return 'local-file-open'
  }

  if ($title -like '* - Roblox Studio') {
    return 'place-open'
  }

  return 'other-studio'
}

function Get-StudioWindowState {
  param(
    $Window,
    [string]$NormalizedTargetPath
  )

  $kind = Get-StudioWindowKind -Window $Window -NormalizedTargetPath $NormalizedTargetPath
  if ($kind -eq 'closed') {
    return 'closed'
  }

  if ($Window.isMinimized) {
    return "minimized-$kind"
  }

  return $kind
}

function Select-StudioWindow {
  param(
    [object[]]$Windows,
    [string]$NormalizedTargetPath
  )

  if (-not $Windows -or $Windows.Count -eq 0) {
    return $null
  }

  $withMetadata = @(
    $Windows | ForEach-Object {
      [pscustomobject]@{
        raw      = $_
        kind     = Get-StudioWindowKind -Window $_ -NormalizedTargetPath $NormalizedTargetPath
        priority = switch (Get-StudioWindowKind -Window $_ -NormalizedTargetPath $NormalizedTargetPath) {
          'target-open' { 0 }
          'local-file-open' { 1 }
          'place-open' { 2 }
          'home' { 3 }
          'auto-recovery-dialog' { 8 }
          default { 9 }
        }
      }
    }
  )

  $preferredWindow = $withMetadata |
    Sort-Object `
      @{ Expression = 'priority'; Ascending = $true }, `
      @{ Expression = { if ($_.raw.isForeground) { 0 } else { 1 } }; Ascending = $true }, `
      @{ Expression = { if ($_.raw.isMinimized) { 1 } else { 0 } }; Ascending = $true } |
    Select-Object -First 1

  return $preferredWindow.raw
}

function Convert-StudioWindowToSummary {
  param(
    $Window,
    [string]$NormalizedTargetPath
  )

  if ($null -eq $Window) {
    return $null
  }

  return [ordered]@{
    hwnd        = [string]$Window.hwnd
    title       = [string]$Window.title
    processId   = $Window.processId
    processName = $Window.processName
    className   = $Window.className
    isVisible   = [bool]$Window.isVisible
    isForeground = [bool]$Window.isForeground
    isMinimized = [bool]$Window.isMinimized
    bounds      = $Window.bounds
    kind        = Get-StudioWindowKind -Window $Window -NormalizedTargetPath $NormalizedTargetPath
    state       = Get-StudioWindowState -Window $Window -NormalizedTargetPath $NormalizedTargetPath
  }
}

function Get-StudioSnapshot {
  param([string]$NormalizedTargetPath)

  $windows = @(Get-StudioWindows)
  $selectedWindow = Select-StudioWindow -Windows $windows -NormalizedTargetPath $NormalizedTargetPath
  $selectedSummary = Convert-StudioWindowToSummary -Window $selectedWindow -NormalizedTargetPath $NormalizedTargetPath

  return @{
    windowCount      = $windows.Count
    multipleWindows  = ($windows.Count -gt 1)
    selectedWindow   = $selectedSummary
    studioState      = if ($selectedSummary) { $selectedSummary.state } else { 'closed' }
    windows          = @(
      $windows | ForEach-Object {
        Convert-StudioWindowToSummary -Window $_ -NormalizedTargetPath $NormalizedTargetPath
      }
    )
  }
}

function Ensure-Directory {
  param([string]$PathText)

  [void][System.IO.Directory]::CreateDirectory($PathText)
  return $PathText
}

function Save-StudioScreenshot {
  param(
    [string]$Hwnd,
    [string]$OutputDirectory,
    [string]$Stage
  )

  $timestamp = Get-TimeStampSlug
  $fileName = "$timestamp-$Stage.png"
  $filePath = Join-Path $OutputDirectory $fileName
  $result = Invoke-WindowCapture -Hwnd $Hwnd -OutputPath $filePath
  if (-not $result.success) {
    throw (Get-JsonErrorMessage -Result $result -Fallback 'capture-window failed.')
  }

  return [string]$result.filePath
}

function Get-AutoRecoveryIgnoreClickPoint {
  param($Window)

  if ($null -eq $Window -or $null -eq $Window.bounds) {
    return $null
  }

  $width = [int]$Window.bounds.width
  $height = [int]$Window.bounds.height
  if ($width -le 0 -or $height -le 0) {
    return $null
  }

  return @{
    x = [Math]::Max(160, [Math]::Min([int]($width * 0.50), $width - 160))
    y = [Math]::Max(120, [Math]::Min([int]($height * 0.92), $height - 24))
  }
}

function Get-ViewportClickPoint {
  param($Window)

  if ($null -eq $Window -or $null -eq $Window.bounds) {
    return $null
  }

  $width = [int]$Window.bounds.width
  $height = [int]$Window.bounds.height
  if ($width -le 0 -or $height -le 0) {
    return $null
  }

  return @{
    x = [Math]::Max(120, [Math]::Min([int]($width * 0.45), $width - 120))
    y = [Math]::Max(180, [Math]::Min([int]($height * 0.55), $height - 120))
  }
}

function Resolve-AutoRecoveryDialog {
  param([string]$NormalizedTargetPath)

  $snapshotBefore = Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath
  $dialogWindow = Get-AutoRecoveryDialogWindow -Windows @($snapshotBefore.windows)

  if (-not $dialogWindow) {
    return @{
      detected = $false
      action = 'none'
      reason = 'No auto-recovery dialog detected.'
      dialogWindow = $null
      ignoreClickPoint = $null
      screenshotPath = $null
      snapshot = $snapshotBefore
    }
  }

  $clickPoint = Get-AutoRecoveryIgnoreClickPoint -Window $dialogWindow
  if ($null -eq $clickPoint) {
    return @{
      detected = $true
      action = 'failed'
      reason = 'Auto-recovery dialog was detected, but the Ignore click point could not be resolved.'
      dialogWindow = $dialogWindow
      ignoreClickPoint = $null
      screenshotPath = $null
      snapshot = $snapshotBefore
    }
  }

  $dialogScreenshotPath = $null
  try {
    $dialogScreenshotPath = Save-StudioScreenshot -Hwnd $dialogWindow.hwnd -OutputDirectory $script:ResolvedOutputDirectory -Stage 'auto-recovery-dialog'
  } catch {
    $dialogScreenshotPath = $null
  }

  $focusResult = Invoke-InputBridge @('focus', '--hwnd', [string]$dialogWindow.hwnd)
  if (-not $focusResult.success) {
    return @{
      detected = $true
      action = 'failed'
      reason = Get-JsonErrorMessage -Result $focusResult -Fallback 'Failed to focus the auto-recovery dialog.'
      dialogWindow = $dialogWindow
      ignoreClickPoint = $clickPoint
      screenshotPath = $dialogScreenshotPath
      snapshot = $snapshotBefore
    }
  }

  $clickErrorMessage = $null
  try {
    $clickResult = Invoke-InputBridge @(
      'click',
      '--hwnd', [string]$dialogWindow.hwnd,
      '--x', [string]$clickPoint.x,
      '--y', [string]$clickPoint.y
    )
    if (-not $clickResult.success) {
      $clickErrorMessage = Get-JsonErrorMessage -Result $clickResult -Fallback 'Failed to click Ignore on the auto-recovery dialog.'
    }
  } catch {
    $clickErrorMessage = $_.Exception.Message
  }

  Start-Sleep -Milliseconds 500

  $snapshotAfter = Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath
  $remainingDialog = Get-AutoRecoveryDialogWindow -Windows @($snapshotAfter.windows)
  if ($remainingDialog) {
    return @{
      detected = $true
      action = 'failed'
      reason = if ($clickErrorMessage) { $clickErrorMessage } else { 'Auto-recovery dialog remained after clicking Ignore.' }
      dialogWindow = $dialogWindow
      ignoreClickPoint = $clickPoint
      screenshotPath = $dialogScreenshotPath
      snapshot = $snapshotAfter
    }
  }

  return @{
    detected = $true
    action = 'ignored'
    reason = if ($clickErrorMessage) {
      "Ignore click closed the auto-recovery dialog. Helper reported after-close noise: $clickErrorMessage"
    } else {
      'Ignored the Studio auto-recovery dialog to keep the explicit target-path reopen flow deterministic.'
    }
    dialogWindow = $dialogWindow
    ignoreClickPoint = $clickPoint
    screenshotPath = $dialogScreenshotPath
    snapshot = $snapshotAfter
  }
}

function Wait-ForTargetWindow {
  param(
    [string]$NormalizedTargetPath,
    [int]$TimeoutMs
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $snapshot = Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath
    if ($snapshot.selectedWindow -and $snapshot.selectedWindow.kind -eq 'target-open') {
      return $snapshot
    }

    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  return Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath
}

function Open-StudioTarget {
  param(
    [string]$StudioBinaryPath,
    [string]$NormalizedTargetPath
  )

  Start-Process -FilePath $StudioBinaryPath -ArgumentList @($NormalizedTargetPath) | Out-Null
}

function Invoke-StudioStatus {
  param(
    [string]$NormalizedTargetPath,
    [string]$StudioBinaryPath
  )

  $snapshot = Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath
  $autoRecovery = Resolve-AutoRecoveryDialog -NormalizedTargetPath $NormalizedTargetPath
  $snapshot = $autoRecovery.snapshot

  Write-JsonExit -ExitCode 0 -Payload @{
    success         = $true
    command         = 'status'
    studioBinaryPath = $StudioBinaryPath
    targetPath      = $NormalizedTargetPath
    outputDirectory = $script:ResolvedOutputDirectory
    autoRecoveryDialogDetected = $autoRecovery.detected
    autoRecoveryAction = $autoRecovery.action
    autoRecoveryReason = $autoRecovery.reason
    autoRecoveryDialogWindow = $autoRecovery.dialogWindow
    autoRecoveryScreenshotPath = $autoRecovery.screenshotPath
    autoRecoveryIgnoreClickPoint = $autoRecovery.ignoreClickPoint
    studioState     = $snapshot.studioState
    windowCount     = $snapshot.windowCount
    multipleWindows = $snapshot.multipleWindows
    selectedWindow  = $snapshot.selectedWindow
    windows         = $snapshot.windows
  }
}

function Invoke-StudioPlayCapture {
  param(
    [string]$NormalizedTargetPath,
    [string]$StudioBinaryPath
  )

  if ([string]::IsNullOrWhiteSpace($NormalizedTargetPath)) {
    throw 'play-capture requires -TargetPath.'
  }

  if (-not (Test-Path -LiteralPath $NormalizedTargetPath)) {
    throw "TargetPath does not exist: $NormalizedTargetPath"
  }

  $autoRecovery = Resolve-AutoRecoveryDialog -NormalizedTargetPath $NormalizedTargetPath
  $before = $autoRecovery.snapshot
  $openMethod = $null
  $notes = New-Object System.Collections.Generic.List[string]

  if ($autoRecovery.action -eq 'ignored') {
    $notes.Add($autoRecovery.reason) | Out-Null
  }
  if ($autoRecovery.action -eq 'failed') {
    Write-JsonExit -ExitCode 1 -Payload @{
      success = $false
      command = 'play-capture'
      targetPath = $NormalizedTargetPath
      studioBinaryPath = $StudioBinaryPath
      outputDirectory = $script:ResolvedOutputDirectory
      autoRecoveryDialogDetected = $autoRecovery.detected
      autoRecoveryAction = $autoRecovery.action
      autoRecoveryReason = $autoRecovery.reason
      autoRecoveryDialogWindow = $autoRecovery.dialogWindow
      autoRecoveryScreenshotPath = $autoRecovery.screenshotPath
      autoRecoveryIgnoreClickPoint = $autoRecovery.ignoreClickPoint
      studioStateBefore = $before.studioState
      studioStateAfter = $before.studioState
      windowCount = $before.windowCount
      multipleWindows = $before.multipleWindows
      selectedWindow = $before.selectedWindow
      windows = $before.windows
      screenshotPath = $autoRecovery.screenshotPath
      error = @{
        message = $autoRecovery.reason
      }
    }
  }

  if ($before.selectedWindow -and $before.selectedWindow.kind -eq 'target-open') {
    $openMethod = 'already-open'
  } else {
    Open-StudioTarget -StudioBinaryPath $StudioBinaryPath -NormalizedTargetPath $NormalizedTargetPath
    $openMethod = 'launch-path'
    $notes.Add('Opened Studio target via explicit Windows path.') | Out-Null
  }

  $afterOpen = Wait-ForTargetWindow -NormalizedTargetPath $NormalizedTargetPath -TimeoutMs $LaunchWaitMs
  if (-not $afterOpen.selectedWindow -or $afterOpen.selectedWindow.kind -ne 'target-open') {
    $failureScreenshot = $null
    if ($afterOpen.selectedWindow) {
      try {
        $failureScreenshot = Save-StudioScreenshot -Hwnd $afterOpen.selectedWindow.hwnd -OutputDirectory $script:ResolvedOutputDirectory -Stage 'open-failure'
      } catch {
        $failureScreenshot = $null
      }
    }

    Write-JsonExit -ExitCode 1 -Payload @{
      success          = $false
      command          = 'play-capture'
      targetPath       = $NormalizedTargetPath
      studioBinaryPath = $StudioBinaryPath
      outputDirectory  = $script:ResolvedOutputDirectory
      openMethod       = $openMethod
      studioStateBefore = $before.studioState
      studioStateAfter = $afterOpen.studioState
      windowCount      = $afterOpen.windowCount
      multipleWindows  = $afterOpen.multipleWindows
      selectedWindow   = $afterOpen.selectedWindow
      windows          = $afterOpen.windows
      screenshotPath   = $failureScreenshot
      error            = @{
        message = 'Target place did not become the active Studio window within the timeout.'
      }
    }
  }

  $targetWindow = $afterOpen.selectedWindow
  $focusResult = Invoke-InputBridge @('focus', '--hwnd', [string]$targetWindow.hwnd)
  if (-not $focusResult.success) {
    throw (Get-JsonErrorMessage -Result $focusResult -Fallback 'Failed to focus Studio window.')
  }

  $clickedViewport = $false
  if (-not $NoViewportClick) {
    $clickPoint = Get-ViewportClickPoint -Window $targetWindow
    if ($clickPoint) {
      $clickResult = Invoke-InputBridge @(
        'click',
        '--hwnd', [string]$targetWindow.hwnd,
        '--x', [string]$clickPoint.x,
        '--y', [string]$clickPoint.y
      )
      if ($clickResult.success) {
        $clickedViewport = $true
        $notes.Add("Clicked viewport center at ($($clickPoint.x),$($clickPoint.y)) before Play.") | Out-Null
        Start-Sleep -Milliseconds 250
      }
    }
  }

  $playResult = Invoke-InputBridge @(
    'tap',
    '--hwnd', [string]$targetWindow.hwnd,
    '--key', $PlayKey
  )
  if (-not $playResult.success) {
    throw (Get-JsonErrorMessage -Result $playResult -Fallback 'Failed to send Play key.')
  }

  Start-Sleep -Milliseconds $PlayWaitMs

  $screenshotPath = Save-StudioScreenshot -Hwnd $targetWindow.hwnd -OutputDirectory $script:ResolvedOutputDirectory -Stage 'after-play'
  $afterPlay = Get-StudioSnapshot -NormalizedTargetPath $NormalizedTargetPath

  Write-JsonExit -ExitCode 0 -Payload @{
    success           = $true
    command           = 'play-capture'
    targetPath        = $NormalizedTargetPath
    studioBinaryPath  = $StudioBinaryPath
    outputDirectory   = $script:ResolvedOutputDirectory
    openMethod        = $openMethod
    autoRecoveryDialogDetected = $autoRecovery.detected
    autoRecoveryAction = $autoRecovery.action
    autoRecoveryReason = $autoRecovery.reason
    autoRecoveryDialogWindow = $autoRecovery.dialogWindow
    autoRecoveryScreenshotPath = $autoRecovery.screenshotPath
    autoRecoveryIgnoreClickPoint = $autoRecovery.ignoreClickPoint
    studioStateBefore = $before.studioState
    studioStateAfter  = $afterPlay.studioState
    windowCount       = $afterPlay.windowCount
    multipleWindows   = $afterPlay.multipleWindows
    selectedWindow    = $afterPlay.selectedWindow
    windows           = $afterPlay.windows
    playKey           = $PlayKey
    clickedViewport   = $clickedViewport
    screenshotPath    = $screenshotPath
    focusMessage      = $focusResult.message
    playMessage       = $playResult.message
    notes             = @($notes)
  }
}

try {
  $script:ResolvedOutputDirectory = Ensure-Directory -PathText (Convert-ToWindowsPath $(if ($OutDir) { $OutDir } else { Get-DefaultOutDir }))
  $script:NormalizedTargetPath = Convert-ToWindowsPath $TargetPath
  $studioBinaryPath = Get-StudioBinaryPath

  switch ($Command) {
    'status' {
      Invoke-StudioStatus -NormalizedTargetPath $script:NormalizedTargetPath -StudioBinaryPath $studioBinaryPath
    }
    'play-capture' {
      Invoke-StudioPlayCapture -NormalizedTargetPath $script:NormalizedTargetPath -StudioBinaryPath $studioBinaryPath
    }
    default {
      throw "Unknown command: $Command"
    }
  }
} catch {
  $failureSnapshot = $null
  $failureScreenshot = $null
  try {
    $failureSnapshot = Get-StudioSnapshot -NormalizedTargetPath $script:NormalizedTargetPath
    if ($failureSnapshot.selectedWindow -and $script:ResolvedOutputDirectory) {
      $failureScreenshot = Save-StudioScreenshot -Hwnd $failureSnapshot.selectedWindow.hwnd -OutputDirectory $script:ResolvedOutputDirectory -Stage 'failure'
    }
  } catch {
    $failureSnapshot = $null
    $failureScreenshot = $null
  }

  Write-JsonExit -ExitCode 1 -Payload @{
    success         = $false
    command         = $Command
    targetPath      = $TargetPath
    outputDirectory = $OutDir
    studioState     = if ($failureSnapshot) { $failureSnapshot.studioState } else { $null }
    windowCount     = if ($failureSnapshot) { $failureSnapshot.windowCount } else { $null }
    multipleWindows = if ($failureSnapshot) { $failureSnapshot.multipleWindows } else { $null }
    selectedWindow  = if ($failureSnapshot) { $failureSnapshot.selectedWindow } else { $null }
    windows         = if ($failureSnapshot) { $failureSnapshot.windows } else { @() }
    screenshotPath  = $failureScreenshot
    error           = @{
      message = $_.Exception.Message
    }
  }
}
