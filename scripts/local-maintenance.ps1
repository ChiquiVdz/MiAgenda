. (Join-Path $PSScriptRoot 'local-common.ps1')
$mutex = New-Object Threading.Mutex($false, 'Local\MiAgendaDailyMaintenance')
$acquired = $false
try {
    $acquired = $mutex.WaitOne(0)
    if (-not $acquired) { exit 0 }
    $log = Join-Path $MiAgendaLocal 'maintenance.log'
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1MB) { Move-Item -LiteralPath $log -Destination (Join-Path $MiAgendaLocal 'maintenance.previous.log') -Force }
    "`nInicio: $(Get-Date -Format s)" | Out-File -LiteralPath $log -Append -Encoding utf8
    & $MiAgendaNode (Join-Path $PSScriptRoot 'local-data.mjs') daily 2>&1 | Out-File -LiteralPath $log -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        'El mantenimiento falló; se reintentará en la próxima apertura o ejecución diaria.' | Out-File -LiteralPath $log -Append -Encoding utf8
        exit 1
    }
} finally { if ($acquired) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
