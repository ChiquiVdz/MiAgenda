$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$MiAgendaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$MiAgendaLocal = Join-Path $env:LOCALAPPDATA 'MiAgenda'
$MiAgendaBackups = Join-Path $MiAgendaLocal 'backups'
$runtimeCandidate = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$MiAgendaNode = $runtimeCandidate
if (-not (Test-Path -LiteralPath $MiAgendaNode)) {
    $MiAgendaNode = (Get-Command node.exe -ErrorAction Stop).Source
}
$nodeVersion = & $MiAgendaNode -p 'process.versions.node'
if ([version]$nodeVersion -lt [version]'22.18.0') { throw 'Se necesita Node 22.18 o posterior para las herramientas locales.' }
Set-Location -LiteralPath $MiAgendaRoot
if (-not (Test-Path -LiteralPath $MiAgendaLocal)) { New-Item -ItemType Directory -Path $MiAgendaLocal | Out-Null }
if (-not (Test-Path -LiteralPath $MiAgendaBackups)) { New-Item -ItemType Directory -Path $MiAgendaBackups | Out-Null }
# Private backups and logs, inherited only by this Windows user and SYSTEM.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
& icacls.exe $MiAgendaLocal /inheritance:r /grant:r (('*' + $identity.Value + ':(OI)(CI)F')) '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron proteger los archivos locales de MiAgenda.' }
$env:MIAGENDA_BACKUP_DIR = $MiAgendaBackups
function Invoke-MiAgendaData([string[]]$DataArguments) {
    & $MiAgendaNode (Join-Path $PSScriptRoot 'local-data.mjs') @DataArguments
    if ($LASTEXITCODE -ne 0) { throw 'La operación no terminó. Los detalles se muestran arriba o en el registro de mantenimiento.' }
}
