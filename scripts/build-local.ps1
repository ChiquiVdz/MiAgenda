. (Join-Path $PSScriptRoot 'local-common.ps1')
& $MiAgendaNode scripts/prepare-local-worker.mjs
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las pantallas sin conexión.' }
& $MiAgendaNode node_modules/next/dist/bin/next build
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la versión diaria.' }
Write-Output 'Versión diaria preparada. Abre MiAgenda desde su acceso directo.'
