param(
  [switch]$PrebuildClean,
  [switch]$SkipInstall,
  [string]$DeviceId,
  [ValidateSet("debug", "release")]
  [string]$Variant = "release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-AsciiPath {
  param([string]$PathText)
  return $PathText -match '^[\u0000-\u007F]+$'
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $Name. Please install it and add it to PATH."
  }
}

function Ensure-Java {
  $javaCmd = Get-Command "java" -ErrorAction SilentlyContinue
  if ($javaCmd) {
    return
  }

  $candidates = @(
    "$env:JAVA_HOME",
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Android\Android Studio\jre",
    "C:\Program Files\JetBrains\Android Studio\jbr",
    "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
  ) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $javaExe = Join-Path $candidate "bin\java.exe"
    if (Test-Path -LiteralPath $javaExe) {
      $env:JAVA_HOME = $candidate
      $env:Path = "$($candidate)\bin;$env:Path"
      Write-Host "Java not found in PATH. Auto-using JDK: $candidate" -ForegroundColor Yellow
      return
    }
  }

  throw "Java not found. Install JDK 17 or Android Studio (with bundled JDK), then retry."
}

function Ensure-Adb {
  param([switch]$Required)

  function Set-AndroidSdkEnv {
    param([string]$PlatformToolsPath)

    if (-not $PlatformToolsPath) {
      return
    }

    $sdkRoot = Split-Path -Parent $PlatformToolsPath
    if (-not $env:ANDROID_HOME) {
      $env:ANDROID_HOME = $sdkRoot
    }
    if (-not $env:ANDROID_SDK_ROOT) {
      $env:ANDROID_SDK_ROOT = $sdkRoot
    }
  }

  $adbCmd = Get-Command "adb" -ErrorAction SilentlyContinue
  if ($adbCmd) {
    $adbSource = $adbCmd.Source
    if ($adbSource -and (Test-Path -LiteralPath $adbSource)) {
      $platformToolsPath = Split-Path -Parent $adbSource
      Set-AndroidSdkEnv -PlatformToolsPath $platformToolsPath
    }
    return $true
  }

  $candidates = @(
    "$env:ANDROID_HOME\platform-tools",
    "$env:ANDROID_SDK_ROOT\platform-tools",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools",
    "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools",
    "C:\Android\Sdk\platform-tools"
  ) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $adbExe = Join-Path $candidate "adb.exe"
    if (Test-Path -LiteralPath $adbExe) {
      Set-AndroidSdkEnv -PlatformToolsPath $candidate
      $env:Path = "$candidate;$env:Path"
      Write-Host "adb not found in PATH. Auto-using Android platform-tools: $candidate" -ForegroundColor Yellow
      return $true
    }
  }

  if ($Required) {
    throw "Command not found: adb. Install Android SDK platform-tools and add adb to PATH."
  }

  Write-Host "adb not found. Continue build without auto install because -SkipInstall is enabled." -ForegroundColor Yellow
  return $false
}

function Resolve-AndroidSdkRoot {
  $candidates = @(
    "$env:ANDROID_HOME",
    "$env:ANDROID_SDK_ROOT",
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk",
    "C:\Android\Sdk"
  ) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  return $null
}

function Ensure-AndroidLocalProperties {
  param([string]$AndroidDir)

  $sdkRoot = Resolve-AndroidSdkRoot
  if (-not $sdkRoot) {
    throw "Android SDK not found. Please install Android SDK and ensure one of these paths exists: %LOCALAPPDATA%\\Android\\Sdk, ANDROID_HOME, ANDROID_SDK_ROOT."
  }

  if (-not $env:ANDROID_HOME) {
    $env:ANDROID_HOME = $sdkRoot
  }
  if (-not $env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT = $sdkRoot
  }

  $localPropertiesPath = Join-Path $AndroidDir "local.properties"
  $sdkDirValue = ($sdkRoot -replace "\\", "/")
  $sdkLine = "sdk.dir=$sdkDirValue"

  [string[]]$lines = @()
  if (Test-Path -LiteralPath $localPropertiesPath) {
    # Force array to avoid strict-mode issues when file has a single line.
    $lines = @(Get-Content -LiteralPath $localPropertiesPath)
  }

  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^sdk\.dir=') {
      $lines[$i] = $sdkLine
      $updated = $true
      break
    }
  }
  if (-not $updated) {
    $lines += $sdkLine
  }

  Set-Content -LiteralPath $localPropertiesPath -Value $lines -Encoding ASCII
  Write-Host "Android SDK path configured: $sdkRoot" -ForegroundColor Green
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $argPreview = if ($ArgumentList.Count -gt 0) { " $($ArgumentList -join ' ')" } else { "" }
  Write-Host "Run: $FilePath$argPreview" -ForegroundColor DarkGray

  $null = & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath$argPreview"
  }
}

function Resolve-AndroidPackageName {
  param([string]$AppJsonPath)

  if (-not (Test-Path -LiteralPath $AppJsonPath)) {
    return $null
  }

  $appJson = Get-Content -Raw -LiteralPath $AppJsonPath | ConvertFrom-Json
  return $appJson.expo.android.package
}

function Select-DeviceSerial {
  param([string]$ExpectedId)

  $adbOutput = & adb devices
  if ($LASTEXITCODE -ne 0) {
    throw "adb devices failed."
  }

  $devices = @()
  foreach ($line in $adbOutput) {
    if ($line -match "^([^\s]+)\s+device$") {
      $devices += $Matches[1]
    }
  }

  if ($devices.Count -eq 0) {
    throw "No Android device detected. Connect phone and enable USB debugging."
  }

  if ($ExpectedId) {
    if ($devices -notcontains $ExpectedId) {
      throw "Device '$ExpectedId' not found. Connected devices: $($devices -join ', ')"
    }
    return $ExpectedId
  }

  if ($devices.Count -gt 1) {
    throw "Multiple devices detected. Use -DeviceId to choose one. Devices: $($devices -join ', ')"
  }

  return $devices[0]
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mobileRoot = Resolve-Path (Join-Path $scriptDir "..")
$androidDir = Join-Path $mobileRoot "android"
$gradleWrapper = Join-Path $androidDir "gradlew.bat"
$apkPath = if ($Variant -eq "release") {
  Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
} else {
  Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
}
$gradleTask = if ($Variant -eq "release") { "assembleRelease" } else { "assembleDebug" }
$appJsonPath = Join-Path $mobileRoot "app.json"

Write-Step "Check toolchain"
Assert-Command "node"
Assert-Command "npm"
Assert-Command "npx"
Ensure-Java

if (-not (Test-AsciiPath -PathText $mobileRoot.Path)) {
  throw @"
Detected non-ASCII project path:
$($mobileRoot.Path)

This often breaks Expo Android prebuild on Windows (MainApplication not found).
Please move/copy project to an English-only path, e.g.:
  E:\mobile_clean\mobile

Example:
  robocopy "$($mobileRoot.Path)" "E:\mobile_clean\mobile" /E /XD node_modules .expo android .idea
Then run this script again from the new path.
"@
}

$adbAvailable = if ($SkipInstall) { Ensure-Adb } else { Ensure-Adb -Required }
$targetDevice = $null
if (-not $SkipInstall) {
  Write-Step "Check connected device"
  $targetDevice = Select-DeviceSerial -ExpectedId $DeviceId
  Write-Host "Target device: $targetDevice" -ForegroundColor Green
} elseif ($adbAvailable) {
  Write-Step "Skip device check by parameter"
}

Push-Location $mobileRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot "node_modules"))) {
    Write-Step "Install npm dependencies"
    Invoke-Checked -FilePath "npm" -ArgumentList @("install")
  }

  if ($PrebuildClean -or -not (Test-Path -LiteralPath $androidDir)) {
    Write-Step "Run Expo prebuild for Android"
    $prebuildArgs = @("expo", "prebuild", "-p", "android")
    if ($PrebuildClean) {
      $prebuildArgs += "--clean"
    }
    Invoke-Checked -FilePath "npx" -ArgumentList $prebuildArgs
  } else {
    Write-Step "Skip prebuild (android directory exists)"
  }

  if (-not (Test-Path -LiteralPath $gradleWrapper)) {
    throw "gradlew.bat not found at: $gradleWrapper"
  }

  Write-Step "Ensure Android SDK location (local.properties)"
  Ensure-AndroidLocalProperties -AndroidDir $androidDir

  Write-Step "Build $Variant APK"
  Push-Location $androidDir
  try {
    Invoke-Checked -FilePath ".\gradlew.bat" -ArgumentList @($gradleTask)
  } finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath $apkPath)) {
    throw "APK not found at expected path: $apkPath"
  }

  Write-Step "APK generated"
  Write-Host $apkPath -ForegroundColor Green

  if ($SkipInstall) {
    Write-Step "Skip install by parameter"
    exit 0
  }

  $packageName = Resolve-AndroidPackageName -AppJsonPath $appJsonPath
  if (-not $packageName) {
    $packageName = "com.qianque1.nutritionassistantcn"
  }

  Write-Step "Install APK to phone"
  $installOutput = & adb -s $targetDevice install -r $apkPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    $rawText = ($installOutput | Out-String)
    if ($rawText -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
      Write-Host "Signature mismatch detected. Uninstall old app then reinstall..." -ForegroundColor Yellow
      $null = & adb -s $targetDevice uninstall $packageName
      if ($LASTEXITCODE -ne 0) {
        throw "Auto uninstall failed. Please uninstall manually and retry. Package: $packageName"
      }
      $null = & adb -s $targetDevice install $apkPath
      if ($LASTEXITCODE -ne 0) {
        throw "Install failed after uninstall."
      }
    } else {
      throw "Install failed.`n$rawText"
    }
  }

  Write-Step "Done"
  Write-Host "Installed to device: $targetDevice" -ForegroundColor Green
} finally {
  Pop-Location
}
