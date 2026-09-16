[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'LicenseSystemBackup\config.json')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-BackupLog {
    param([string]$Message, [string]$Level = 'INFO')

    $logDirectory = Join-Path $env:LOCALAPPDATA 'LicenseSystemBackup\logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logPath = Join-Path $logDirectory 'backup.log'
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 2MB) {
        Move-Item -LiteralPath $logPath -Destination (Join-Path $logDirectory 'backup.previous.log') -Force
    }
    Add-Content -LiteralPath $logPath -Value ('{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}' -f (Get-Date), $Level, $Message)
}

$temporaryPath = $null
try {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Configuracao nao encontrada: $ConfigPath" }
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($required in @('backupUrl', 'destinationRoot', 'encryptedKeyPath')) {
        if (-not $config.$required) { throw "Campo obrigatorio ausente na configuracao: $required" }
    }
    if (-not (Test-Path -LiteralPath $config.encryptedKeyPath)) { throw 'Chave criptografada nao encontrada.' }

    $secureKey = (Get-Content -LiteralPath $config.encryptedKeyPath -Raw).Trim() | ConvertTo-SecureString
    $credential = [pscredential]::new('backup', $secureKey)
    $plainKey = $credential.GetNetworkCredential().Password
    if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'Nao foi possivel descriptografar a chave.' }

    $now = Get-Date
    $monthDirectory = Join-Path (Join-Path $config.destinationRoot $now.ToString('yyyy')) $now.ToString('MM')
    New-Item -ItemType Directory -Path $monthDirectory -Force | Out-Null
    $fileName = 'license-system-backup-{0}.jsonl' -f $now.ToString('yyyy-MM-dd-HHmmss')
    $finalPath = Join-Path $monthDirectory $fileName
    $temporaryPath = "$finalPath.download"

    Invoke-WebRequest -Uri $config.backupUrl -Headers @{ 'X-Backup-Key' = $plainKey } -OutFile $temporaryPath -UseBasicParsing -TimeoutSec 300
    if (-not (Test-Path -LiteralPath $temporaryPath) -or (Get-Item -LiteralPath $temporaryPath).Length -lt 100) {
        throw 'O servidor retornou um backup vazio ou incompleto.'
    }

    $manifest = (Get-Content -LiteralPath $temporaryPath -TotalCount 1) | ConvertFrom-Json
    $completion = (Get-Content -LiteralPath $temporaryPath -Tail 1) | ConvertFrom-Json
    if ($manifest.type -ne 'manifest' -or $manifest.format -ne 'license-system-jsonl') { throw 'Manifesto de backup invalido.' }
    if ($completion.type -ne 'complete') { throw 'O arquivo de backup nao foi concluido.' }

    Move-Item -LiteralPath $temporaryPath -Destination $finalPath -Force
    $temporaryPath = $null
    $size = (Get-Item -LiteralPath $finalPath).Length
    Write-BackupLog "Backup concluido: $finalPath ($size bytes)"
    Write-Output $finalPath
    exit 0
}
catch {
    if ($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    Write-BackupLog $_.Exception.Message 'ERROR'
    Write-Error $_.Exception.Message
    exit 1
}
