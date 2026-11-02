param(
    [string]$AndroidSdk = $env:ANDROID_SDK_ROOT,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$GradlePath = "",
    [switch]$Offline
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path $PSScriptRoot -Parent
$androidRoot = Join-Path $desktopRoot "android"
$distRoot = Join-Path $desktopRoot "dist"
$toolchainRoot = Join-Path $env:LOCALAPPDATA "GrokBuild\Toolchains"
$signingRoot = Join-Path $androidRoot ".signing"
$keystore = Join-Path $signingRoot "grok-remote-release.jks"
$passwordFile = Join-Path $signingRoot "password.dpapi"
$keyAlias = "grok-remote"

if (-not $AndroidSdk) {
    $persistentSdk = Join-Path $toolchainRoot "android-sdk"
    if (Test-Path $persistentSdk -PathType Container) {
        $AndroidSdk = $persistentSdk
    } else {
        throw "Set ANDROID_SDK_ROOT, pass -AndroidSdk, or install the persistent toolchain under $toolchainRoot."
    }
}
if (-not $JavaHome) {
    $persistentJava = Join-Path $toolchainRoot "jdk-17"
    if (Test-Path (Join-Path $persistentJava "bin\java.exe") -PathType Leaf) {
        $JavaHome = $persistentJava
    } else {
        throw "Set JAVA_HOME, pass -JavaHome, or install JDK 17 under $persistentJava."
    }
}

$AndroidSdk = (Resolve-Path $AndroidSdk).Path
$JavaHome = (Resolve-Path $JavaHome).Path
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:ANDROID_HOME = $AndroidSdk
$env:JAVA_HOME = $JavaHome

$buildTools = Get-ChildItem (Join-Path $AndroidSdk "build-tools") -Directory |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) {
    throw "Android SDK build-tools are not installed."
}

$aapt2 = Join-Path $buildTools.FullName "aapt2.exe"
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$keytool = Join-Path $JavaHome "bin\keytool.exe"
foreach ($tool in @($aapt2, $zipalign, $apksigner, $keytool)) {
    if (-not (Test-Path $tool -PathType Leaf)) {
        throw "Required Android build tool not found: $tool"
    }
}

if ($GradlePath) {
    $gradle = (Resolve-Path $GradlePath).Path
} elseif (Test-Path (Join-Path $androidRoot "gradlew.bat")) {
    $gradle = Join-Path $androidRoot "gradlew.bat"
} elseif (Test-Path (Join-Path $toolchainRoot "gradle-8.9\bin\gradle.bat")) {
    $gradle = Join-Path $toolchainRoot "gradle-8.9\bin\gradle.bat"
} else {
    $gradleCommand = Get-Command gradle.bat -ErrorAction SilentlyContinue
    if (-not $gradleCommand) {
        throw "Gradle 8.9 was not found. Pass -GradlePath or add gradle.bat to PATH."
    }
    $gradle = $gradleCommand.Source
}

New-Item -ItemType Directory -Force -Path $distRoot, $signingRoot | Out-Null

Push-Location $androidRoot
try {
    $gradleArgs = @("--no-daemon", "-Pandroid.aapt2FromMavenOverride=$aapt2", "assembleRelease")
    if ($Offline) {
        $gradleArgs = @("--offline") + $gradleArgs
    }
    & $gradle @gradleArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle release build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

if ($env:GROK_ANDROID_SIGNING_PASSWORD) {
    $signingPassword = $env:GROK_ANDROID_SIGNING_PASSWORD
} elseif (Test-Path $passwordFile -PathType Leaf) {
    $protectedPassword = (Get-Content $passwordFile -Raw).Trim()
    $securePassword = $protectedPassword | ConvertTo-SecureString
    $credential = [pscredential]::new("grok-remote", $securePassword)
    $signingPassword = $credential.GetNetworkCredential().Password
} else {
    $randomBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($randomBytes)
    } finally {
        $random.Dispose()
    }
    $signingPassword = [Convert]::ToBase64String($randomBytes)
    ConvertTo-SecureString $signingPassword -AsPlainText -Force |
        ConvertFrom-SecureString |
        Set-Content -Encoding ASCII $passwordFile
}

if (-not (Test-Path $keystore -PathType Leaf)) {
    & $keytool -genkeypair -noprompt -keystore $keystore -storepass $signingPassword `
        -keypass $signingPassword -alias $keyAlias -keyalg RSA -keysize 4096 -validity 10000 `
        -dname "CN=Grok Remote Local Release, OU=Mobile, O=Grok Build, L=Local, ST=Local, C=CN"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the Android release keystore."
    }
}

$buildFile = Get-Content (Join-Path $androidRoot "app\build.gradle.kts") -Raw
$versionMatch = [regex]::Match($buildFile, 'versionName\s*=\s*"([^"]+)"')
if (-not $versionMatch.Success) {
    throw "Could not read versionName from app/build.gradle.kts."
}

$version = $versionMatch.Groups[1].Value
$unsignedApk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release-unsigned.apk"
$alignedApk = Join-Path $distRoot "Grok-Remote-Android-$version-aligned.apk"
$finalApk = Join-Path $distRoot "Grok-Remote-Android-$version.apk"

& $zipalign -f -p 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) {
    throw "zipalign failed."
}
try {
    $env:GROK_APK_SIGNING_PASSWORD = $signingPassword
    & $apksigner sign --ks $keystore --ks-key-alias $keyAlias `
        --ks-pass "env:GROK_APK_SIGNING_PASSWORD" --key-pass "env:GROK_APK_SIGNING_PASSWORD" `
        --out $finalApk $alignedApk
    if ($LASTEXITCODE -ne 0) {
        throw "APK signing failed."
    }
} finally {
    Remove-Item Env:GROK_APK_SIGNING_PASSWORD -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $alignedApk -Force

& $apksigner verify --verbose --print-certs $finalApk
if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed."
}

$hash = Get-FileHash $finalApk -Algorithm SHA256
Write-Output "APK: $finalApk"
Write-Output "SHA256: $($hash.Hash)"
