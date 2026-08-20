param(
  [Parameter(Mandatory = $true)]
  [string]$SymbolSource,

  [Parameter(Mandatory = $true)]
  [string]$WordmarkSource,

  [Parameter(Mandatory = $true)]
  [string]$AndroidSymbolSource
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$brandBackground = [System.Drawing.ColorTranslator]::FromHtml('#F7F8FC')

function Set-RenderQuality([System.Drawing.Graphics]$graphics) {
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
}

function Save-BrandImage(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$Width,
  [int]$Height,
  [bool]$Opaque,
  [bool]$RoundBackground = $false
) {
  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $pixelFormat = if ($Opaque) {
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    } else {
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    }
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, $pixelFormat)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        Set-RenderQuality $graphics
        if ($Opaque) {
          $graphics.Clear($brandBackground)
        } else {
          $graphics.Clear([System.Drawing.Color]::Transparent)
        }
        if ($RoundBackground) {
          $brush = [System.Drawing.SolidBrush]::new($brandBackground)
          try {
            $graphics.FillEllipse($brush, 0, 0, $Width - 1, $Height - 1)
          } finally {
            $brush.Dispose()
          }
        }
        $graphics.DrawImage($source, 0, 0, $Width, $Height)
      } finally {
        $graphics.Dispose()
      }
      [System.IO.Directory]::CreateDirectory(
        [System.IO.Path]::GetDirectoryName($OutputPath)
      ) | Out-Null
      $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

function Save-NotificationIcon(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$Size
) {
  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $bitmap = [System.Drawing.Bitmap]::new(
      $Size,
      $Size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        Set-RenderQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($source, 0, 0, $Size, $Size)
      } finally {
        $graphics.Dispose()
      }
      for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
          $pixel = $bitmap.GetPixel($x, $y)
          if ($pixel.A -gt 8) {
            $bitmap.SetPixel(
              $x,
              $y,
              [System.Drawing.Color]::FromArgb($pixel.A, 255, 255, 255)
            )
          }
        }
      }
      [System.IO.Directory]::CreateDirectory(
        [System.IO.Path]::GetDirectoryName($OutputPath)
      ) | Out-Null
      $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

function Save-SplashImage(
  [string]$InputPath,
  [string]$OutputPath,
  [int]$CanvasSize,
  [int]$ImageSize
) {
  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    $bitmap = [System.Drawing.Bitmap]::new(
      $CanvasSize,
      $CanvasSize,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        Set-RenderQuality $graphics
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $offset = [int](($CanvasSize - $ImageSize) / 2)
        $graphics.DrawImage($source, $offset, $offset, $ImageSize, $ImageSize)
      } finally {
        $graphics.Dispose()
      }
      [System.IO.Directory]::CreateDirectory(
        [System.IO.Path]::GetDirectoryName($OutputPath)
      ) | Out-Null
      $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

$assets = Join-Path $projectRoot 'src\assets\images'
Save-BrandImage $SymbolSource (Join-Path $assets 'etkinlink-symbol.png') 1024 1024 $false
Save-BrandImage $WordmarkSource (Join-Path $assets 'etkinlink-logo.png') 1024 1024 $false
Save-BrandImage $SymbolSource (Join-Path $assets 'etkinlink-app-icon.png') 1024 1024 $true
Save-BrandImage $AndroidSymbolSource (Join-Path $assets 'etkinlink-adaptive-foreground.png') 1024 1024 $false
Save-NotificationIcon $SymbolSource (Join-Path $assets 'etkinlink-notification-icon.png') 96

$iosAppIconSet = Join-Path $projectRoot 'ios\EtkinLink\Images.xcassets\AppIcon.appiconset'
foreach ($size in @(40, 58, 60, 80, 87, 120, 180, 1024)) {
  $output = Join-Path $iosAppIconSet ("Icon-{0}x{0}.png" -f $size)
  Save-BrandImage $SymbolSource $output $size $size $true
}

$iosSplashSet = Join-Path $projectRoot 'ios\EtkinLink\Images.xcassets\SplashLogo.imageset'
Save-BrandImage $WordmarkSource (Join-Path $iosSplashSet 'EtkinLink-SplashLogo.png') 1024 1024 $false

$densities = @(
  @('mdpi', 48, 108),
  @('hdpi', 72, 162),
  @('xhdpi', 96, 216),
  @('xxhdpi', 144, 324),
  @('xxxhdpi', 192, 432)
)
foreach ($entry in $densities) {
  $density = $entry[0]
  $legacySize = [int]$entry[1]
  $adaptiveSize = [int]$entry[2]
  $directory = Join-Path $projectRoot "android\app\src\main\res\mipmap-$density"
  Save-BrandImage $AndroidSymbolSource (Join-Path $directory 'ic_launcher.png') $legacySize $legacySize $true
  Save-BrandImage $AndroidSymbolSource (Join-Path $directory 'ic_launcher_round.png') $legacySize $legacySize $false $true
  Save-BrandImage $AndroidSymbolSource (Join-Path $directory 'ic_launcher_foreground.png') $adaptiveSize $adaptiveSize $false
}

foreach ($entry in $densities) {
  $density = $entry[0]
  $notificationSize = [int](24 * ([int]$entry[1] / 48))
  $directory = Join-Path $projectRoot "android\app\src\main\res\drawable-$density"
  Save-NotificationIcon $SymbolSource (Join-Path $directory 'notification_icon.png') $notificationSize
}

$splashDensities = @(
  @('mdpi', 1),
  @('hdpi', 1.5),
  @('xhdpi', 2),
  @('xxhdpi', 3),
  @('xxxhdpi', 4)
)
foreach ($entry in $splashDensities) {
  $density = $entry[0]
  $multiplier = [double]$entry[1]
  $canvasSize = [int](288 * $multiplier)
  $imageSize = [int](208 * $multiplier)
  $directory = Join-Path $projectRoot "android\app\src\main\res\drawable-$density"
  Save-SplashImage $WordmarkSource (Join-Path $directory 'splashscreen_logo.png') $canvasSize $imageSize
}

$storeAssets = Join-Path $projectRoot 'artifacts\store'
Save-BrandImage $SymbolSource (Join-Path $storeAssets 'EtkinLink-App-Store-Icon.png') 1024 1024 $true
Save-BrandImage $AndroidSymbolSource (Join-Path $storeAssets 'EtkinLink-Google-Play-Icon.png') 512 512 $true

Write-Output 'EtkinLink brand assets generated successfully.'
