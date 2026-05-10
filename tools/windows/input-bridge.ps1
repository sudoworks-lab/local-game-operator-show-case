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
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  Write-Output $json
  exit $ExitCode
}

function Write-Success {
  param(
    [string]$Command,
    [hashtable]$Extra = @{}
  )

  $payload = @{
    success = $true
    command = $Command
  }

  Write-JsonExit -ExitCode 0 -Payload (Merge-Hashtable $payload $Extra)
}

function Write-Failure {
  param(
    [string]$Command,
    [string]$Message,
    [hashtable]$Extra = @{}
  )

  $payload = @{
    success = $false
    command = $Command
    error   = @{
      message = $Message
    }
  }

  Write-JsonExit -ExitCode 1 -Payload (Merge-Hashtable $payload $Extra)
}

function Parse-Arguments {
  param([string[]]$Tokens)

  if (-not $Tokens -or $Tokens.Count -eq 0) {
    return @{
      command = 'help'
    }
  }

  $parsed = @{
    command = $Tokens[0]
  }

  $i = 1
  while ($i -lt $Tokens.Count) {
    $token = $Tokens[$i].ToLowerInvariant()
    switch ($token) {
      '--hwnd' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --hwnd.'
        }
        $i++
        $parsed.hwnd = $Tokens[$i]
      }
      '--key' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --key.'
        }
        $i++
        $parsed.key = $Tokens[$i]
      }
      '--keys' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --keys.'
        }
        $i++
        $parsed.keys = $Tokens[$i]
      }
      '--ms' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --ms.'
        }
        $i++
        $parsed.ms = [int]$Tokens[$i]
      }
      '--delay-ms' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --delay-ms.'
        }
        $i++
        $parsed.delayMs = [int]$Tokens[$i]
      }
      '--cancel-file' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --cancel-file.'
        }
        $i++
        $parsed.cancelFile = $Tokens[$i]
      }
      '--x' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --x.'
        }
        $i++
        $parsed.x = [int]$Tokens[$i]
      }
      '--y' {
        if ($i + 1 -ge $Tokens.Count) {
          throw 'Missing value for --y.'
        }
        $i++
        $parsed.y = [int]$Tokens[$i]
      }
      '--help' {
        $parsed.command = 'help'
      }
      default {
        throw "Unknown option: $token"
      }
    }

    $i++
  }

  return $parsed
}

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Win32
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$script:SupportedKeys = @(
  @{ alias = 'W';       name = 'W';     vk = 0x57; extended = $false },
  @{ alias = 'A';       name = 'A';     vk = 0x41; extended = $false },
  @{ alias = 'S';       name = 'S';     vk = 0x53; extended = $false },
  @{ alias = 'D';       name = 'D';     vk = 0x44; extended = $false },
  @{ alias = 'F1';      name = 'F1';    vk = 0x70; extended = $false },
  @{ alias = 'F2';      name = 'F2';    vk = 0x71; extended = $false },
  @{ alias = 'F3';      name = 'F3';    vk = 0x72; extended = $false },
  @{ alias = 'F4';      name = 'F4';    vk = 0x73; extended = $false },
  @{ alias = 'F5';      name = 'F5';    vk = 0x74; extended = $false },
  @{ alias = 'F6';      name = 'F6';    vk = 0x75; extended = $false },
  @{ alias = 'F7';      name = 'F7';    vk = 0x76; extended = $false },
  @{ alias = 'F8';      name = 'F8';    vk = 0x77; extended = $false },
  @{ alias = 'F9';      name = 'F9';    vk = 0x78; extended = $false },
  @{ alias = 'F10';     name = 'F10';   vk = 0x79; extended = $false },
  @{ alias = 'F11';     name = 'F11';   vk = 0x7A; extended = $false },
  @{ alias = 'F12';     name = 'F12';   vk = 0x7B; extended = $false },
  @{ alias = 'SPACE';   name = 'Space'; vk = 0x20; extended = $false },
  @{ alias = 'ENTER';   name = 'Enter'; vk = 0x0D; extended = $false },
  @{ alias = 'ESC';     name = 'Esc';   vk = 0x1B; extended = $false },
  @{ alias = 'SHIFT';   name = 'Shift'; vk = 0x10; extended = $false },
  @{ alias = 'E';       name = 'E';     vk = 0x45; extended = $false },
  @{ alias = 'F';       name = 'F';     vk = 0x46; extended = $false },
  @{ alias = 'R';       name = 'R';     vk = 0x52; extended = $false },
  @{ alias = 'UP';      name = 'Up';    vk = 0x26; extended = $true  },
  @{ alias = 'DOWN';    name = 'Down';  vk = 0x28; extended = $true  },
  @{ alias = 'LEFT';    name = 'Left';  vk = 0x25; extended = $true  },
  @{ alias = 'RIGHT';   name = 'Right'; vk = 0x27; extended = $true  }
)

function Normalize-KeyAlias {
  param([string]$KeyName)

  $normalized = $KeyName.Trim().ToUpperInvariant()
  switch ($normalized) {
    'SPACEBAR' { return 'SPACE' }
    'RETURN'   { return 'ENTER' }
    'ESCAPE'   { return 'ESC' }
    'ARROWUP' { return 'UP' }
    'ARROWDOWN' { return 'DOWN' }
    'ARROWLEFT' { return 'LEFT' }
    'ARROWRIGHT' { return 'RIGHT' }
    default { return $normalized }
  }
}

function Get-KeyDefinition {
  param([string]$KeyName)

  $alias = Normalize-KeyAlias $KeyName
  $definition = $script:SupportedKeys | Where-Object { $_.alias -eq $alias } | Select-Object -First 1
  if ($null -eq $definition) {
    throw "Unsupported key: $KeyName"
  }

  return $definition
}

function Convert-ToIntPtr {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw 'HWND is required.'
  }

  return [IntPtr]([int64]$Value)
}

function Get-WindowTextSafe {
  param([IntPtr]$Hwnd)

  $length = [Win32]::GetWindowTextLength($Hwnd)
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][Win32]::GetWindowText($Hwnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-ClassNameSafe {
  param([IntPtr]$Hwnd)

  $builder = New-Object System.Text.StringBuilder 256
  [void][Win32]::GetClassName($Hwnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-WindowRecord {
  param([IntPtr]$Hwnd)

  $processId = [uint32]0
  [void][Win32]::GetWindowThreadProcessId($Hwnd, [ref]$processId)
  $processName = $null
  if ($processId -gt 0) {
    try {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
      $processName = $null
    }
  }

  return [ordered]@{
    hwnd            = $Hwnd.ToInt64().ToString()
    title           = Get-WindowTextSafe $Hwnd
    processId       = if ($processId -gt 0) { [int]$processId } else { $null }
    processName     = $processName
    className       = Get-ClassNameSafe $Hwnd
    isVisible       = [Win32]::IsWindowVisible($Hwnd)
    isForeground    = ([Win32]::GetForegroundWindow() -eq $Hwnd)
    isMinimized     = [Win32]::IsIconic($Hwnd)
    bounds          = Get-WindowRectSafe $Hwnd
    captureAvailable = $false
    captureSourceId  = $null
    captureSourceName = $null
  }
}

function Get-WindowRectSafe {
  param([IntPtr]$Hwnd)

  $rect = New-Object Win32+RECT
  if (-not [Win32]::GetWindowRect($Hwnd, [ref]$rect)) {
    throw "Unable to read bounds for HWND $($Hwnd.ToInt64())."
  }

  return @{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
  }
}

function Get-WindowProcessId {
  param([IntPtr]$Hwnd)

  $processId = [uint32]0
  [void][Win32]::GetWindowThreadProcessId($Hwnd, [ref]$processId)
  return $processId
}

function Test-ForegroundTarget {
  param([IntPtr]$Hwnd)

  $foregroundHwnd = [Win32]::GetForegroundWindow()
  if ($foregroundHwnd -eq $Hwnd) {
    return $true
  }

  $targetProcessId = Get-WindowProcessId $Hwnd
  if ($foregroundHwnd -eq [IntPtr]::Zero -or $targetProcessId -eq 0) {
    return $false
  }

  $foregroundProcessId = Get-WindowProcessId $foregroundHwnd
  return ($foregroundProcessId -eq $targetProcessId)
}

function Get-TopLevelWindows {
  $shellWindow = [Win32]::GetShellWindow()
  $results = New-Object System.Collections.Generic.List[object]

  $callback = [Win32+EnumWindowsProc]{
    param([IntPtr]$Hwnd, [IntPtr]$LParam)

    if ($Hwnd -eq $shellWindow) {
      return $true
    }

    if (-not [Win32]::IsWindowVisible($Hwnd)) {
      return $true
    }

    $title = Get-WindowTextSafe $Hwnd
    if ([string]::IsNullOrWhiteSpace($title)) {
      return $true
    }

    $results.Add([pscustomobject](Get-WindowRecord $Hwnd)) | Out-Null
    return $true
  }

  [void][Win32]::EnumWindows($callback, [IntPtr]::Zero)

  return $results | Sort-Object `
    @{ Expression = 'isForeground'; Descending = $true }, `
    @{ Expression = 'title'; Descending = $false }
}

function Focus-Window {
  param([IntPtr]$Hwnd)

  if ($Hwnd -eq [IntPtr]::Zero) {
    return $false
  }

  if ([Win32]::IsIconic($Hwnd)) {
    [void][Win32]::ShowWindowAsync($Hwnd, 9)
  } else {
    [void][Win32]::ShowWindowAsync($Hwnd, 5)
  }

  $foregroundHwnd = [Win32]::GetForegroundWindow()
  $foregroundProcessId = [uint32]0
  $foregroundThread = if ($foregroundHwnd -ne [IntPtr]::Zero) {
    [Win32]::GetWindowThreadProcessId($foregroundHwnd, [ref]$foregroundProcessId)
  } else {
    0
  }

  $targetProcessId = [uint32]0
  $targetThread = [Win32]::GetWindowThreadProcessId($Hwnd, [ref]$targetProcessId)
  $currentThread = [Win32]::GetCurrentThreadId()
  $attachedForeground = $false
  $attachedTarget = $false

  try {
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
      $attachedForeground = [Win32]::AttachThreadInput($currentThread, $foregroundThread, $true)
    }

    if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
      $attachedTarget = [Win32]::AttachThreadInput($currentThread, $targetThread, $true)
    }

    [void][Win32]::BringWindowToTop($Hwnd)
    [Win32]::SwitchToThisWindow($Hwnd, $true)
    [Win32]::keybd_event([byte]0x12, [byte]0, [uint32]0, [UIntPtr]::Zero)
    [Win32]::keybd_event([byte]0x12, [byte]0, [uint32]0x0002, [UIntPtr]::Zero)
    [void][Win32]::SetForegroundWindow($Hwnd)
    Start-Sleep -Milliseconds 80
    return (Test-ForegroundTarget $Hwnd)
  } finally {
    if ($attachedTarget) {
      [void][Win32]::AttachThreadInput($currentThread, $targetThread, $false)
    }

    if ($attachedForeground) {
      [void][Win32]::AttachThreadInput($currentThread, $foregroundThread, $false)
    }
  }
}

function Focus-WindowFallback {
  param([IntPtr]$Hwnd)

  $window = Get-WindowRecord $Hwnd
  $shell = New-Object -ComObject WScript.Shell

  if ($window.processId) {
    $activated = $shell.AppActivate([int]$window.processId)
  } elseif (-not [string]::IsNullOrWhiteSpace($window.title)) {
    $activated = $shell.AppActivate($window.title)
  } else {
    $activated = $false
  }

  Start-Sleep -Milliseconds 120
  return ($activated -or (Test-ForegroundTarget $Hwnd))
}

function Ensure-Focus {
  param([IntPtr]$Hwnd)

  if (Focus-Window $Hwnd) {
    return
  }

  if (Focus-WindowFallback $Hwnd) {
    return
  }

  if (-not (Focus-Window $Hwnd)) {
    throw "Unable to bring HWND $($Hwnd.ToInt64()) to the foreground. Administrator privilege differences or Windows focus rules may be blocking it."
  }
}

function Test-CancelRequested {
  param([string]$CancelFile)

  if ([string]::IsNullOrWhiteSpace($CancelFile)) {
    return $false
  }

  return Test-Path -LiteralPath $CancelFile
}

function Wait-WithCancellation {
  param(
    [int]$Milliseconds,
    [string]$CancelFile
  )

  $elapsed = 0
  while ($elapsed -lt $Milliseconds) {
    if (Test-CancelRequested $CancelFile) {
      return $true
    }

    $step = [Math]::Min(25, $Milliseconds - $elapsed)
    Start-Sleep -Milliseconds $step
    $elapsed += $step
  }

  return $false
}

function Send-KeyboardEvent {
  param(
    [string]$KeyName,
    [switch]$KeyUp
  )

  $definition = Get-KeyDefinition $KeyName
  $scanCode = [Win32]::MapVirtualKey([uint32]$definition.vk, 0)
  $flags = 0
  if ($definition.extended) {
    $flags = $flags -bor 0x0001
  }

  if ($KeyUp) {
    $flags = $flags -bor 0x0002
  }

  [Win32]::keybd_event(
    [byte]$definition.vk,
    [byte]$scanCode,
    [uint32]$flags,
    [UIntPtr]::Zero
  )
}

function Invoke-KeyHoldInternal {
  param(
    [IntPtr]$Hwnd,
    [string]$KeyName,
    [int]$Milliseconds,
    [string]$CancelFile
  )

  Ensure-Focus $Hwnd
  Send-KeyboardEvent $KeyName
  $cancelled = $false
  try {
    $cancelled = Wait-WithCancellation -Milliseconds $Milliseconds -CancelFile $CancelFile
  } finally {
    Send-KeyboardEvent $KeyName -KeyUp
  }

  return $cancelled
}

function Invoke-KeySequence {
  param(
    [IntPtr]$Hwnd,
    [string[]]$Keys,
    [int]$DelayMs,
    [string]$CancelFile
  )

  Ensure-Focus $Hwnd
  $sentKeys = New-Object System.Collections.Generic.List[string]

  foreach ($key in $Keys) {
    if (Test-CancelRequested $CancelFile) {
      return @{
        cancelled = $true
        sentKeys  = $sentKeys.ToArray()
      }
    }

    $cancelledDuringKey = $false
    Send-KeyboardEvent $key
    try {
      $cancelledDuringKey = Wait-WithCancellation -Milliseconds 60 -CancelFile $CancelFile
    } finally {
      Send-KeyboardEvent $key -KeyUp
    }

    $sentKeys.Add((Get-KeyDefinition $key).name) | Out-Null

    if ($cancelledDuringKey) {
      return @{
        cancelled = $true
        sentKeys  = $sentKeys.ToArray()
      }
    }

    if (Wait-WithCancellation -Milliseconds $DelayMs -CancelFile $CancelFile) {
      return @{
        cancelled = $true
        sentKeys  = $sentKeys.ToArray()
      }
    }
  }

  return @{
    cancelled = $false
    sentKeys  = $sentKeys.ToArray()
  }
}

function Invoke-WindowClick {
  param(
    [IntPtr]$Hwnd,
    [int]$X,
    [int]$Y
  )

  Ensure-Focus $Hwnd

  $rect = Get-WindowRectSafe $Hwnd
  if ($X -lt 0 -or $Y -lt 0 -or $X -ge $rect.width -or $Y -ge $rect.height) {
    throw "Click point ($X,$Y) is outside the window bounds ${($rect.width)}x${($rect.height)}."
  }

  $targetX = $rect.left + $X
  $targetY = $rect.top + $Y
  $cursor = New-Object Win32+POINT
  [void][Win32]::GetCursorPos([ref]$cursor)

  try {
    [void][Win32]::SetCursorPos($targetX, $targetY)
    Start-Sleep -Milliseconds 50
    [Win32]::mouse_event([uint32]0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [Win32]::mouse_event([uint32]0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
  } finally {
    [void][Win32]::SetCursorPos($cursor.X, $cursor.Y)
  }
}

function Release-AllKeys {
  foreach ($key in $script:SupportedKeys) {
    Send-KeyboardEvent $key.name -KeyUp
  }
}

$commandName = 'help'

try {
  $parsed = Parse-Arguments $args
  $commandName = $parsed.command

  switch ($parsed.command.ToLowerInvariant()) {
    'help' {
      Write-Success -Command 'help' -Extra @{
        message = 'Usage: input-bridge.ps1 <list-windows|focus|tap|keydown|keyup|hold|sequence|click|release-all> [--hwnd <decimal>] [--key <name>] [--keys "W,A,S,D"] [--ms 500] [--delay-ms 120] [--x <pixels>] [--y <pixels>] [--cancel-file <path>]'
        supportedKeys = $script:SupportedKeys | ForEach-Object { $_.name }
      }
    }

    'list-windows' {
      $windows = @(Get-TopLevelWindows)
      Write-Success -Command 'list-windows' -Extra @{
        message = "Found $($windows.Count) top-level windows."
        windows = $windows
      }
    }

    'focus' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      Ensure-Focus $hwnd
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'focus' -Extra @{
        hwnd = $window.hwnd
        message = "Focused window `"$($window.title)`"."
        details = @{
          title = $window.title
          processName = $window.processName
          className = $window.className
        }
      }
    }

    'tap' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      $key = Get-KeyDefinition $parsed.key
      $cancelled = Invoke-KeyHoldInternal -Hwnd $hwnd -KeyName $key.name -Milliseconds 60 -CancelFile $parsed.cancelFile
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'tap' -Extra @{
        hwnd = $window.hwnd
        key = $key.name
        cancelled = $cancelled
        message = $(if ($cancelled) { "Tap for $($key.name) was cancelled." } else { "Tapped $($key.name) on `"$($window.title)`"." })
        details = @{
          title = $window.title
        }
      }
    }

    'keydown' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      $key = Get-KeyDefinition $parsed.key
      Ensure-Focus $hwnd
      Send-KeyboardEvent $key.name
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'keydown' -Extra @{
        hwnd = $window.hwnd
        key = $key.name
        message = "Sent keydown for $($key.name) to `"$($window.title)`"."
        details = @{
          title = $window.title
        }
      }
    }

    'keyup' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      $key = Get-KeyDefinition $parsed.key
      Ensure-Focus $hwnd
      Send-KeyboardEvent $key.name -KeyUp
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'keyup' -Extra @{
        hwnd = $window.hwnd
        key = $key.name
        message = "Sent keyup for $($key.name) to `"$($window.title)`"."
        details = @{
          title = $window.title
        }
      }
    }

    'hold' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      $key = Get-KeyDefinition $parsed.key
      $durationMs = if ($parsed.ContainsKey('ms')) { [int]$parsed.ms } else { 500 }
      $cancelled = Invoke-KeyHoldInternal -Hwnd $hwnd -KeyName $key.name -Milliseconds $durationMs -CancelFile $parsed.cancelFile
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'hold' -Extra @{
        hwnd = $window.hwnd
        key = $key.name
        ms = $durationMs
        cancelled = $cancelled
        message = $(if ($cancelled) { "Cancelled hold for $($key.name)." } else { "Held $($key.name) for $durationMs ms on `"$($window.title)`"." })
        details = @{
          title = $window.title
        }
      }
    }

    'sequence' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      $requestedKeys = @(
        ($parsed.keys -split ',') |
          ForEach-Object { $_.Trim() } |
          Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
      )

      if ($requestedKeys.Count -eq 0) {
        throw 'Sequence requires at least one key in --keys.'
      }

      $delayMs = if ($parsed.ContainsKey('delayMs')) { [int]$parsed.delayMs } else { 120 }
      $result = Invoke-KeySequence -Hwnd $hwnd -Keys $requestedKeys -DelayMs $delayMs -CancelFile $parsed.cancelFile
      $window = Get-WindowRecord $hwnd
      $extra = [ordered]@{
        hwnd = $window.hwnd
        keys = [string[]]$result.sentKeys
        cancelled = $result.cancelled
        message = $(if ($result.cancelled) {
          "Sequence cancelled after $($result.sentKeys.Count) key(s)."
        } else {
          "Sequence completed on `"$($window.title)`"."
        })
        details = @{
          title = $window.title
          requestedKeys = $requestedKeys
          delayMs = $delayMs
        }
      }
      Write-Success -Command 'sequence' -Extra $extra
    }

    'click' {
      $hwnd = Convert-ToIntPtr $parsed.hwnd
      if (-not $parsed.ContainsKey('x') -or -not $parsed.ContainsKey('y')) {
        throw 'click requires both --x and --y.'
      }
      Invoke-WindowClick -Hwnd $hwnd -X ([int]$parsed.x) -Y ([int]$parsed.y)
      $window = Get-WindowRecord $hwnd
      Write-Success -Command 'click' -Extra @{
        hwnd = $window.hwnd
        message = "Clicked ($($parsed.x),$($parsed.y)) on `"$($window.title)`"."
        details = @{
          title = $window.title
          x = [int]$parsed.x
          y = [int]$parsed.y
        }
      }
    }

    'release-all' {
      Release-AllKeys
      $releaseExtra = [ordered]@{
        message = 'Released all supported keys.'
        keys = @($script:SupportedKeys | ForEach-Object { $_.name })
      }
      Write-Success -Command 'release-all' -Extra $releaseExtra
    }

    default {
      throw "Unknown command: $($parsed.command)"
    }
  }
} catch {
  Write-Failure -Command $commandName -Message $_.Exception.Message
}
