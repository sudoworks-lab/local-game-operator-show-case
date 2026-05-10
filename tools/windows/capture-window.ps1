param(
  [Parameter(Mandatory = $true)]
  [string]$Hwnd,

  [Parameter(Mandatory = $true)]
  [string]$OutPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

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

Add-Type -AssemblyName System.Drawing

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;

public static class WindowCapture
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
}
"@

try {
  $hwndPtr = [IntPtr]([int64]$Hwnd)
  if (-not [WindowCapture]::IsWindow($hwndPtr)) {
    throw "HWND $Hwnd is not a valid top-level window."
  }

  $rect = New-Object WindowCapture+RECT
  if (-not [WindowCapture]::GetWindowRect($hwndPtr, [ref]$rect)) {
    throw "Failed to read the window rect for HWND $Hwnd."
  }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) {
    throw "HWND $Hwnd reported an empty window rect."
  }

  $outputDirectory = Split-Path -Parent $OutPath
  if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    [void][System.IO.Directory]::CreateDirectory($outputDirectory)
  }

  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $captureStrategy = 'print-window'
  try {
    $hdc = $graphics.GetHdc()
    try {
      $printed = [WindowCapture]::PrintWindow($hwndPtr, $hdc, 0)
    } finally {
      $graphics.ReleaseHdc($hdc)
    }

    if (-not $printed) {
      $captureStrategy = 'copy-from-screen'
      $graphics.CopyFromScreen(
        $rect.Left,
        $rect.Top,
        0,
        0,
        [System.Drawing.Size]::new($width, $height)
      )
    }

    $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  Write-JsonExit -ExitCode 0 -Payload @{
    success  = $true
    hwnd     = $hwndPtr.ToInt64().ToString()
    filePath = $OutPath
    width    = $width
    height   = $height
    strategy = $captureStrategy
  }
} catch {
  Write-JsonExit -ExitCode 1 -Payload @{
    success  = $false
    hwnd     = $Hwnd
    filePath = $OutPath
    error    = @{
      message = $_.Exception.Message
    }
  }
}
