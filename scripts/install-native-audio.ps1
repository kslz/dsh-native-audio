param([string]$Profile = 'desktop')
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid profile name.' }
$dshHomePath = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profilePath = Join-Path $dshHomePath "profiles/$Profile"
$packagePath = Join-Path $profilePath 'package.json'
$audioArchive = Join-Path $PSScriptRoot 'dsh-native-audio-0.2.4.tgz'
if (-not (Test-Path -LiteralPath $packagePath)) { throw "DSH profile not found: $profilePath" }
if (-not (Test-Path -LiteralPath $audioArchive)) { throw "Package not found: $audioArchive" }
$profilePackage = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if (-not $profilePackage.dsh.profile.bundles) { throw 'Profile bundle list is missing.' }
$runtimePath = Join-Path $dshHomePath 'dsh-runtimes/dsh-primary-runtime/dependencies'
$nodePath = Join-Path $runtimePath 'node/bin/node.exe'
$pnpmPath = Join-Path $runtimePath 'pnpm/bin/pnpm.cjs'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'DSH bundled Node runtime not found.' }
if (-not (Test-Path -LiteralPath $pnpmPath)) { throw 'DSH bundled pnpm runtime not found.' }
$backupPath = Join-Path $profilePath ('.native-audio-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupPath | Out-Null
foreach ($name in @('package.json', 'pnpm-lock.yaml', 'cordis.patch.yml')) {
  $sourcePath = Join-Path $profilePath $name
  if (Test-Path -LiteralPath $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $backupPath $name) }
}
& $nodePath $pnpmPath '--dir' $profilePath 'add' '--ignore-scripts' "file:$audioArchive"
if ($LASTEXITCODE -ne 0) { throw "Package installation failed. Backup: $backupPath" }
$profilePackage = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if (@($profilePackage.dsh.profile.bundles) -notcontains 'dsh-native-audio') {
  $profilePackage.dsh.profile.bundles = @($profilePackage.dsh.profile.bundles) + 'dsh-native-audio'
  [System.IO.File]::WriteAllText($packagePath, ($profilePackage | ConvertTo-Json -Depth 50) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
Write-Output "Installed native audio for profile '$Profile'."
Write-Output "Backup: $backupPath"
Write-Output 'Fully quit and restart DSH to load the update.'
