[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupKey,
    [string]$DestinationRoot = 'G:\Meu Drive\Backups - Sistema de Licencas MT5',
    [string]$BackupUrl = 'https://sistema-de-licen-as-flow.vercel.app/api/admin/backup',
    [switch]$SkipInitialBackup
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BackupKey) -or $BackupKey.Length -lt 32) { throw 'A chave de backup e invalida.' }
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) { throw 'A pasta de destino nao foi informada.' }

$sourceScript = Join-Path $PSScriptRoot 'backup-license-system.ps1'
$sourceWatcher = Join-Path $PSScriptRoot 'watch-license-system-backup.ps1'
if (-not (Test-Path -LiteralPath $sourceScript)) { throw "Executor nao encontrado: $sourceScript" }
if (-not (Test-Path -LiteralPath $sourceWatcher)) { throw "Monitor nao encontrado: $sourceWatcher" }

$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'LicenseSystemBackup'
$runtimeScript = Join-Path $runtimeDirectory 'backup-license-system.ps1'
$runtimeWatcher = Join-Path $runtimeDirectory 'watch-license-system-backup.ps1'
$configPath = Join-Path $runtimeDirectory 'config.json'
$encryptedKeyPath = Join-Path $runtimeDirectory 'backup-key.dpapi'

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceScript -Destination $runtimeScript -Force
Copy-Item -LiteralPath $sourceWatcher -Destination $runtimeWatcher -Force
$BackupKey | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $encryptedKeyPath -Encoding UTF8

[ordered]@{
    backupUrl = $BackupUrl
    destinationRoot = $DestinationRoot
    encryptedKeyPath = $encryptedKeyPath
    installedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$startupDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$launcherPath = Join-Path $startupDirectory 'Sistema de Licencas Backup.vbs'
$launcher = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$runtimeWatcher""", 0, False
"@
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ASCII

if (-not $SkipInitialBackup) {
    & $runtimeScript -ConfigPath $configPath
    if ($LASTEXITCODE -ne 0) { throw 'A automacao foi instalada, mas o primeiro backup falhou.' }
}

Start-Process -FilePath 'wscript.exe' -ArgumentList ('"{0}"' -f $launcherPath) -WindowStyle Hidden
[pscustomobject]@{
    Automation = 'Sistema de Licencas Backup'
    Schedule = 'Diariamente, uma vez, apos 12:00'
    StartupLauncher = $launcherPath
    Destination = $DestinationRoot
}
