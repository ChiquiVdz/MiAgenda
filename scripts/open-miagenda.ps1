try {
    . (Join-Path $PSScriptRoot 'local-common.ps1')
    $mutex = New-Object Threading.Mutex($false, 'Local\MiAgendaLocalLauncher')
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne(60000)
        if (-not $acquired) { throw 'Otra apertura está en curso. Intenta de nuevo en un momento.' }
        $health = $null
        try { $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/local-health' -TimeoutSec 3 } catch {}
        if ($health -and $health.app -eq 'MiAgenda' -and $health.mode -ne 'production') { throw 'MiAgenda está en modo de desarrollo. Cierra la vista de desarrollo antes de abrir la versión diaria.' }
        if (-not $health) {
            $portBusy = $false
            $probe = New-Object Net.Sockets.TcpClient
            try { if ($probe.ConnectAsync('127.0.0.1', 3000).Wait(1000)) { $portBusy = $probe.Connected } } catch {} finally { $probe.Dispose() }
            if ($portBusy) { throw 'El puerto 3000 está ocupado por otro servicio. No se cerró ese servicio.' }
            if (-not (Test-Path -LiteralPath (Join-Path $MiAgendaRoot '.next\BUILD_ID'))) { throw 'Falta compilar la versión diaria. Ejecuta scripts\build-local.ps1.' }
            $server = Start-Process -FilePath $MiAgendaNode -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3000') -WorkingDirectory $MiAgendaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $MiAgendaLocal 'server.log') -RedirectStandardError (Join-Path $MiAgendaLocal 'server-error.log') -PassThru
            @{ pid = $server.Id; startedAt = $server.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $MiAgendaLocal 'server.json') -Encoding utf8
            for ($attempt = 0; $attempt -lt 45; $attempt++) {
                Start-Sleep -Seconds 1
                try { $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/local-health' -TimeoutSec 2; break } catch {}
                if ($server.HasExited) { throw 'No se pudo iniciar MiAgenda. Revisa el registro local del servidor.' }
            }
        }
        if (-not $health -or $health.app -ne 'MiAgenda' -or $health.mode -ne 'production') { throw 'No se confirmó el inicio de MiAgenda.' }
        Start-Process 'http://localhost:3000/inbox'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'local-maintenance.ps1') + '"')) -WindowStyle Hidden
    } finally { if ($acquired) { $mutex.ReleaseMutex() }; if ($mutex) { $mutex.Dispose() } }
} catch {
    if ($MiAgendaLocal) { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $MiAgendaLocal 'launcher-error.log') -Encoding utf8 }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'MiAgenda') | Out-Null
    exit 1
}
