param(
    [switch]$Install,
    [string]$Device
)

$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stageRoot = Join-Path $env:SystemDrive 'ELBuild'
$expectedStageRoot = "$($env:SystemDrive)\ELBuild"

if ([IO.Path]::GetFullPath($stageRoot) -ne $expectedStageRoot) {
    throw "Beklenmeyen derleme dizini: $stageRoot"
}

if (-not (Test-Path -LiteralPath $stageRoot)) {
    New-Item -ItemType Directory -Path $stageRoot | Out-Null
}

Write-Host "Expo Android kaynakları kısa derleme yoluna eşitleniyor: $stageRoot"

$robocopyArguments = @(
    $projectRoot,
    $stageRoot,
    '/MIR',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
    '/XD',
    'node_modules',
    '.git',
    '.expo',
    '.gradle',
    '.cxx',
    'build',
    'coverage'
)

& robocopy @robocopyArguments
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -gt 7) {
    throw "Kaynak eşitleme başarısız oldu (robocopy: $robocopyExitCode)."
}

$sourceLockFile = Join-Path $projectRoot 'package-lock.json'
$dependencyMarker = Join-Path $stageRoot 'node_modules\.etkinlink-package-lock.sha256'
$sourceLockHash = (Get-FileHash -LiteralPath $sourceLockFile -Algorithm SHA256).Hash
$installedLockHash = if (Test-Path -LiteralPath $dependencyMarker) {
    (Get-Content -LiteralPath $dependencyMarker -Raw).Trim()
} else {
    ''
}

$expoPackage = Join-Path $stageRoot 'node_modules\expo\package.json'
if ($sourceLockHash -ne $installedLockHash -or -not (Test-Path -LiteralPath $expoPackage)) {
    Write-Host 'Paket kilidi değişti; bağımlılıklar kuruluyor...'
    Push-Location $stageRoot
    try {
        & npm ci --prefer-offline --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci başarısız oldu ($LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }
    Set-Content -LiteralPath $dependencyMarker -Value $sourceLockHash -NoNewline
}

$targetDevice = $null
$reactNativeArchitectures = 'arm64-v8a,x86,x86_64'

if ($Install) {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (-not (Test-Path -LiteralPath $adb)) {
        throw 'Android SDK platform-tools/adb bulunamadı.'
    }

    $connectedDevices = @(
        & $adb devices |
            Select-Object -Skip 1 |
            ForEach-Object {
                if ($_ -match '^([^\s]+)\s+device$') {
                    $Matches[1]
                }
            }
    )

    if ($Device) {
        if ($connectedDevices -notcontains $Device) {
            throw "İstenen Android cihazı bağlı değil: $Device"
        }
        $targetDevice = $Device
    } elseif ($connectedDevices.Count -eq 1) {
        $targetDevice = $connectedDevices[0]
    } elseif ($connectedDevices.Count -eq 0) {
        throw 'Bağlı/emülatör durumda bir Android cihazı yok.'
    } else {
        throw "Birden fazla Android cihazı bağlı. -Device <seri> ile hedefi seçin: $($connectedDevices -join ', ')"
    }

    $deviceAbi = ((& $adb -s $targetDevice shell getprop ro.product.cpu.abi | Select-Object -First 1) -as [string]).Trim()
    $supportedArchitectures = @('arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64')
    if ($supportedArchitectures -notcontains $deviceAbi) {
        throw "Desteklenmeyen Android cihaz mimarisi: $deviceAbi"
    }

    $reactNativeArchitectures = $deviceAbi
    Write-Host "Hedef cihaz mimarisi seçildi: $targetDevice ($reactNativeArchitectures)"
}

$env:NODE_ENV = 'development'
$env:CI = '1'

$gradleWrapper = Join-Path $stageRoot 'android\gradlew.bat'
Write-Host 'Expo Development Build APK derleniyor...'
& $gradleWrapper `
    -p (Join-Path $stageRoot 'android') `
    assembleDebug `
    --max-workers=1 `
    --no-daemon `
    '-Pkotlin.compiler.execution.strategy=in-process' `
    "-PreactNativeArchitectures=$reactNativeArchitectures"

if ($LASTEXITCODE -ne 0) {
    throw "Android debug derlemesi başarısız oldu ($LASTEXITCODE)."
}

$apkPath = Join-Path $stageRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apkPath)) {
    throw "Derleme tamamlandı ancak APK bulunamadı: $apkPath"
}

$workspaceRoot = Split-Path $projectRoot -Parent
$desktopRoot = Split-Path $workspaceRoot -Parent
$desktopApk = Join-Path $desktopRoot 'EtkinLink-Expo-debug.apk'
$defaultDesktopApk = Join-Path $desktopRoot 'EtkinLink-debug.apk'
Copy-Item -LiteralPath $apkPath -Destination $desktopApk -Force
Copy-Item -LiteralPath $apkPath -Destination $defaultDesktopApk -Force

$apkHash = (Get-FileHash -LiteralPath $desktopApk -Algorithm SHA256).Hash
Write-Host "APK hazır: $desktopApk"
Write-Host "SHA-256: $apkHash"

if (-not $Install) {
    exit 0
}

Write-Host "APK Android cihazına kuruluyor: $targetDevice"
& $adb -s $targetDevice install -r $desktopApk
if ($LASTEXITCODE -ne 0) {
    throw "APK kurulumu başarısız oldu ($LASTEXITCODE)."
}

& $adb -s $targetDevice shell am start -n 'com.etkinlink.app/.MainActivity'
if ($LASTEXITCODE -ne 0) {
    throw "EtkinLink başlatılamadı ($LASTEXITCODE)."
}

Write-Host 'EtkinLink Expo Development Build kuruldu ve açıldı.'
