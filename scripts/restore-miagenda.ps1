param([string]$File)
. (Join-Path $PSScriptRoot 'local-common.ps1')
if (-not $File) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object Windows.Forms.OpenFileDialog
    $picker.InitialDirectory = $MiAgendaBackups
    $picker.Filter = 'Respaldo MiAgenda (*.miagenda)|*.miagenda'
    if ($picker.ShowDialog() -ne 'OK') { exit 0 }
    $File = $picker.FileName
}
Write-Output 'La recuperación se hace en una base separada y vacía.'
Write-Output 'Su conexión debe estar en reconstruction/core/.env.restore.local como MIAGENDA_RESTORE_DATABASE_URL.'
if ((Read-Host 'Escribe RESTAURAR para confirmar') -ne 'RESTAURAR') { exit 0 }
Invoke-MiAgendaData @('restore', '--file', $File, '--confirm', 'RESTAURAR-EN-BASE-VACIA')
