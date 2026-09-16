[CmdletBinding()]
param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'LicenseSystemBackup')
)

$ErrorActionPreference = 'Continue'
$mutex = [Threading.Mutex]::new($false, 'Local\LicenseSystemBackupWatcher')
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

try {
    $backupScript = Join-Path $RuntimeDirectory 'backup-license-system.ps1'
    $configPath = Join-Path $RuntimeDirectory 'config.json'
    $statePath = Join-Path $RuntimeDirectory 'state.json'

    while ($true) {
        $now = Get-Date
        $lastSuccessfulDate = $null
        if (Test-Path -LiteralPath $statePath) {
            try { $lastSuccessfulDate = (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).lastSuccessfulDate }
            catch { $lastSuccessfulDate = $null }
        }

        if ($now.TimeOfDay -ge [TimeSpan]::FromHours(12) -and $lastSuccessfulDate -ne $now.ToString('yyyy-MM-dd')) {
            & $backupScript -ConfigPath $configPath
            if ($LASTEXITCODE -eq 0) {
                [ordered]@{
                    lastSuccessfulDate = $now.ToString('yyyy-MM-dd')
                    lastSuccessfulAt = (Get-Date).ToString('o')
                } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
            }
        }
        Start-Sleep -Seconds 60
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
