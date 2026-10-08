. (Join-Path $PSScriptRoot 'local-common.ps1')
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Abrir MiAgenda.lnk'))
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'open-miagenda.ps1') + '"'
$shortcut.WorkingDirectory = $MiAgendaRoot
$shortcut.Description = 'Abrir MiAgenda para uso diario en esta PC'
$shortcut.Save()
$programs = Join-Path ([Environment]::GetFolderPath('Programs')) 'MiAgenda'
if (-not (Test-Path -LiteralPath $programs)) { New-Item -ItemType Directory -Path $programs | Out-Null }
foreach ($tool in @(
    @{ Name = 'Abrir MiAgenda'; Script = 'open-miagenda.ps1'; Interactive = $false },
    @{ Name = 'Respaldar MiAgenda'; Script = 'backup-miagenda.ps1'; Interactive = $true },
    @{ Name = 'Recuperar MiAgenda'; Script = 'restore-miagenda.ps1'; Interactive = $true },
    @{ Name = 'Cerrar MiAgenda'; Script = 'stop-miagenda.ps1'; Interactive = $true }
)) {
    $link = $shell.CreateShortcut((Join-Path $programs ($tool.Name + '.lnk')))
    $link.TargetPath = $shortcut.TargetPath
    $options = '-NoProfile -ExecutionPolicy Bypass '
    if ($tool.Interactive) { $options += '-NoExit ' } else { $options += '-WindowStyle Hidden ' }
    $link.Arguments = $options + '-File "' + (Join-Path $PSScriptRoot $tool.Script) + '"'
    $link.WorkingDirectory = $MiAgendaRoot
    $link.Save()
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'local-maintenance.ps1') + '"') -WorkingDirectory $MiAgendaRoot
$triggers = @((New-ScheduledTaskTrigger -Daily -At '09:00'), (New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'MiAgenda - respaldo y limpieza diarios' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Output 'Acceso directo creado y mantenimiento diario registrado. No requiere mantener abierto el navegador.'
