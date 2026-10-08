. (Join-Path $PSScriptRoot 'local-common.ps1')
$stateFile = Join-Path $MiAgendaLocal 'server.json'
if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $server = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($server -and $server.ProcessName -eq 'node' -and $server.StartTime.ToUniversalTime().ToString('o') -eq $state.startedAt) {
        Stop-Process -Id $server.Id
        Write-Output 'MiAgenda se cerró. Tus datos permanecen en la base.'
    }
    Remove-Item -LiteralPath $stateFile
}
