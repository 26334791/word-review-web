$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectDir
$stageDir = $null
function Get-Sha256([string] $Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    & node --test tests/portable-server.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Portable server check failed' }
    $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    $runtime = Get-Content -LiteralPath 'scripts/node-runtime.json' -Raw | ConvertFrom-Json
    $releaseDir = Join-Path $projectDir 'releases'
    $cacheDir = Join-Path $releaseDir '.runtime-cache'
    [IO.Directory]::CreateDirectory($cacheDir) | Out-Null
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($target in $runtime.targets) {
        $archivePath = Join-Path $cacheDir $target.archive
        $sourceUrl = $runtime.baseUrl + $target.archive
        if (!(Test-Path -LiteralPath $archivePath)) {
            & curl.exe --fail --location --retry 2 --max-time 300 --output ($archivePath + '.part') $sourceUrl
            if ($LASTEXITCODE -ne 0) { throw "Runtime download failed: $($target.platform)" }
            if ((Get-Sha256 ($archivePath + '.part')) -ne $target.sha256) { throw 'Downloaded runtime checksum mismatch' }
            Move-Item -LiteralPath ($archivePath + '.part') -Destination $archivePath -Force
        }
        if ((Get-Sha256 $archivePath) -ne $target.sha256) { throw "Cached runtime checksum mismatch: $archivePath" }
        $stageDir = Join-Path $releaseDir ('package-' + [guid]::NewGuid().ToString('N'))
        $portableDir = Join-Path $stageDir 'word-review-web'
        $runtimeDir = Join-Path $portableDir 'runtime'
        [IO.Directory]::CreateDirectory((Join-Path $portableDir 'scripts')) | Out-Null
        [IO.Directory]::CreateDirectory($runtimeDir) | Out-Null
        Copy-Item -LiteralPath 'dist' -Destination (Join-Path $portableDir 'dist') -Recurse
        Copy-Item -LiteralPath 'scripts/serve.mjs' -Destination (Join-Path $portableDir 'scripts/serve.mjs')
        Copy-Item -LiteralPath 'docs/portable.md' -Destination (Join-Path $portableDir 'README.md')
        Copy-Item -LiteralPath 'LICENSE' -Destination (Join-Path $portableDir 'LICENSE')
        Copy-Item -LiteralPath 'THIRD_PARTY_NOTICES.md' -Destination (Join-Path $portableDir 'THIRD_PARTY_NOTICES.md')
        Copy-Item -LiteralPath 'docs/ATTRIBUTION.md' -Destination (Join-Path $portableDir 'ATTRIBUTION.md')
        $publisherDocx = Join-Path $portableDir 'dist/data/bnu-grade8-upper-2024-source.docx'
        if (Test-Path -LiteralPath $publisherDocx) { Remove-Item -LiteralPath $publisherDocx }
        & tar.exe -xf $archivePath -C $runtimeDir --strip-components 1 ($target.prefix + '/' + $target.binary) ($target.prefix + '/LICENSE') ($target.prefix + '/README.md')
        if ($LASTEXITCODE -ne 0) { throw 'Runtime extraction failed' }
        $sourceInfo = [ordered]@{ version = $runtime.version; platform = $target.platform; source = $sourceUrl; archiveSha256 = $target.sha256; binary = $target.binary; binarySha256 = Get-Sha256 (Join-Path $runtimeDir $target.binary); release = $runtime.release }
        [IO.File]::WriteAllText((Join-Path $runtimeDir 'SOURCE.json'), ($sourceInfo | ConvertTo-Json) + "`n", $utf8)
        if ($target.platform -eq 'windows-x64') {
            $launcher = @'
@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0scripts\serve.mjs" %*
if errorlevel 1 pause
'@
            [IO.File]::WriteAllText((Join-Path $portableDir 'start-windows.cmd'), ($launcher -replace "\r?\n", "`r`n") + "`r`n", $utf8)
            & (Join-Path $runtimeDir 'node.exe') --version
            if ($LASTEXITCODE -ne 0) { throw 'Bundled Windows runtime failed' }
        } else {
            $launcher = @'
#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
chmod u+x ./runtime/bin/node
exec ./runtime/bin/node ./scripts/serve.mjs "$@"
'@
            [IO.File]::WriteAllText((Join-Path $portableDir 'start-linux.sh'), $launcher.Replace("`r`n", "`n") + "`n", $utf8)
        }
        $zipPath = Join-Path $releaseDir "word-review-web-$version-$($target.platform).zip"
        Compress-Archive -LiteralPath $portableDir -DestinationPath $zipPath -Force
        $hash = Get-Sha256 $zipPath
        [IO.File]::WriteAllText(($zipPath + '.sha256'), "$hash  $([IO.Path]::GetFileName($zipPath))`n", $utf8)
        Write-Output "Package: $zipPath"
        Write-Output "SHA256: $hash"
        $stageFull = [IO.Path]::GetFullPath($stageDir)
        $releaseFull = [IO.Path]::GetFullPath($releaseDir).TrimEnd('\') + '\'
        if (!$stageFull.StartsWith($releaseFull, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($stageFull) -notmatch '^package-[0-9a-f]{32}$') { throw 'Unsafe staging cleanup path' }
        Remove-Item -LiteralPath $stageFull -Recurse -Force
        $stageDir = $null
    }
} finally {
    if ($stageDir) { Write-Output "Incomplete staging retained: $stageDir" }
    Pop-Location
}
