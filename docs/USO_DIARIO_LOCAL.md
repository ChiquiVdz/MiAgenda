# MiAgenda para uso diario en esta PC

Estado al 2026-10-08: herramientas locales preparadas, revisión integral ejecutada y últimos cambios de Cocina comprobados con 45 verificaciones y aceptación visual del usuario. Consultar [resultados de Cocina](RESULTADOS_COCINA_CANTIDADES.md), [preparación local](RESULTADOS_USO_DIARIO_LOCAL.md) y [copia local de consulta](COPIA_LOCAL.md). Esta guía corresponde al uso en PC; no a un despliegue público.

## Abrir y cerrar

Usa el acceso directo **Abrir MiAgenda** del escritorio. Inicia la versión compilada, abre Inbox y reutiliza el servidor si ya estaba encendido. El servidor escucha únicamente en esta PC, en `http://localhost:3000`.

Cerrar el navegador no borra tus datos ni detiene el servidor. Para detenerlo puedes ejecutar `scripts/stop-miagenda.ps1`; solo cierra el proceso iniciado por nuestra herramienta. Al apagar/reiniciar la PC tendrás que volver a usar el acceso directo.

En el menú Inicio de Windows, la carpeta **MiAgenda** ofrece **Abrir**, **Respaldar**, **Recuperar** y **Cerrar MiAgenda**. Las herramientas de respaldo y recuperación muestran su resultado en una ventana que puedes cerrar al terminar.

La versión diaria no se recompila automáticamente al editar código. Después de cambios: detenerla, ejecutar `scripts/build-local.ps1` y abrirla de nuevo. La vista `next dev` sigue disponible para desarrollo, pero no debe ocupar el mismo puerto durante el uso diario.

Los scripts requieren Node 22.18 o posterior; prefieren el Node 24 ya instalado con el entorno de trabajo. Si se retira ese entorno, instalar un Node compatible o actualizar la ruta del script común.

## Dónde están tus datos

Las actividades, recetas, alacena y compras se guardan en PostgreSQL/Neon. No dependen de que mantengas abierto el navegador. **Se requiere internet** para iniciar sesión, descargar la copia y guardar cambios. La [copia local](COPIA_LOCAL.md) permite consultar lo descargado y abrir las pantallas preparadas sin conexión; editar offline sigue pendiente.

Guardar tarda lo que tarde la conexión con Neon. Ante un error, usa el reintento de la app: conserva el comando para evitar dobles compras o consumos. No interpretes una pantalla sin respuesta como confirmación de que se guardó.

## Respaldos

La carpeta privada está en `%LOCALAPPDATA%\MiAgenda`:

- `backups\daily-….miagenda`: copias completas, comprimidas y cifradas con AES-256-GCM. Se guardan las últimas siete copias diarias exitosas.
- `backups\before-reset-….miagenda`: copia previa a la limpieza de pruebas. No entra en la rotación automática.
- `recovery.key`: clave necesaria para recuperar una copia. **No se guarda en Git.**
- `maintenance.log`: resultado del último mantenimiento y errores, sin conexiones ni credenciales.

Las copias incluyen cuentas, programación, versiones de recetas, recibos, movimientos y datos que permiten deshacer operaciones. Guardan también sesiones e identidad: son privadas y no deben compartirse. No incluyen los archivos de configuración OAuth de la app; estos deben conservarse por separado en un lugar privado.

La tarea de Windows **MiAgenda - respaldo y limpieza diarios** corre a las 09:00 y al iniciar sesión. Si se perdió la hora intenta ejecutarse cuando sea posible. También se ejecuta al abrir MiAgenda. Solo crea una copia por fecha UTC, evitando consultas y copias repetidas en cada apertura. No puede funcionar con la PC apagada ni sin internet; reintenta al volver a abrirla o en la próxima ejecución programada.

Para una copia inmediata adicional, ejecutar `scripts/backup-miagenda.ps1`. Para protegerte de perder la PC, copia un respaldo y `recovery.key` a una ubicación externa privada: perder la clave hace irrecuperables los archivos cifrados. Copiar ambos juntos conserva la capacidad de restaurar, pero quien obtenga ambos podrá leer tus datos.

## Recuperar

La herramienta **nunca reemplaza la base activa**. Recupera primero en otra base vacía:

1. Crear una base PostgreSQL separada, vacía.
2. Guardar su conexión en `reconstruction/core/.env.restore.local` como `MIAGENDA_RESTORE_DATABASE_URL="…"`. No pegarla en un chat ni en Git.
3. Ejecutar `scripts/restore-miagenda.ps1`; elegir el archivo y escribir `RESTAURAR`.
4. La herramienta reconstruye las migraciones incluidas, restaura todas las tablas y verifica su contenido. Si falla, revierte la transacción; si el destino tiene tablas, lo rechaza.
5. Revisar esa recuperación antes de sustituir la conexión de la app. El núcleo exige que la base de uso se llame `miagenda_core`; recuperar bajo otro nombre requiere un cambio explícito de configuración/infraestructura antes de usarla como núcleo.

Si es otra PC, primero instalar la app y colocar la clave original en `%LOCALAPPDATA%\MiAgenda\recovery.key`. El archivo elegido puede estar en otra carpeta; la herramienta siempre usa esa clave local. No generar otra para intentar recuperar copias antiguas.

No es necesario recuperar todo por un error pequeño: primero usar Deshacer cuando la app lo permita. El respaldo recupera el estado de su fecha, no los cambios posteriores.

## Retención

Se mantienen las reglas de PROJECT.md: cinco días desde completado y nunca antes del final programado; Conservar protege; una principal espera a hijos pendientes, futuros o conservados. El mantenimiento ejecuta lotes pequeños y guarda el inventario y la evidencia necesaria. La app también intenta limpiar al entrar a Inbox/Agenda. No elimina pendientes por haber vencido su fecha.

## Estado y límites

- Cuenta y catálogo común conservados; datos funcionales de prueba retirados con autorización. General queda disponible; Planificar inicializa Cocina y sus filas cuando se abre.
- El respaldo previo a esa limpieza se comprobó restaurando sus 35 tablas en un esquema temporal, comparando todos sus contenidos y revirtiendo el esquema temporal.
- La compilación local de producción incluye las funciones actuales; no implica que la app esté publicada en internet.
- Acceso público/iPhone real, altas de Inbox y edición sin conexión, notificaciones push y widget siguen pendientes. La adaptación móvil y consulta local están implementadas.
- Las comprobaciones de servicios de la revisión integral previa siguen documentadas en `RESULTADOS_REVISION_INTEGRAL.md`. Este bloque revisa las herramientas locales; no vuelve a afirmar una prueba exhaustiva de cada gesto de la interfaz.

Si el acceso directo falla, muestra un mensaje. Los registros del servidor están en `server.log` y `server-error.log` dentro de la carpeta privada. No enviar archivos enteros sin revisar su contenido.
