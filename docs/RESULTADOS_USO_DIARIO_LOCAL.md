# Preparación de uso diario · 2026-10-07

Autorizado: herramientas locales, respaldo/restauración de comprobación y retirada de todos los datos funcionales de prueba. PROJECT.md no se modificó.

## Comprobaciones realizadas

- Sintaxis de JavaScript y PowerShell correcta; TypeScript sin errores.
- `next build` completado: todas las rutas, incluido el identificador local del servidor.
- Primera copia cifrada completa creada fuera del proyecto, en la carpeta privada local de Windows.
- Restauración de esa copia en un esquema temporal: **35 tablas**, filas y hashes iguales a la fuente. Reversión completa del ensayo; base activa intacta durante la comprobación.
- Borrado de pruebas en transacción después de comprobar nuevamente el respaldo y bloquear las tablas; compara la copia con el estado actual para evitar borrar cambios nuevos por accidente.
- Conservación de la identidad, sesión y catálogo global. General se vuelve a crear para que la cuenta existente pueda agendar desde el primer uso. Cocina se inicializa desde el servicio al abrir Planificar.
- Acceso directo instalado y tarea diaria de Windows registrada.
- Inicio local de producción confirmado por `GET /api/local-health`.
- Cierre del proceso iniciado por la herramienta y reapertura confirmados.
- Respaldo diario posterior a la limpieza creado; mantenimiento finalizado. Una segunda ejecución del mismo día no volvió a generar la copia.

## Conteos al terminar la limpieza

| Datos | Cantidad |
|---|---:|
| Cuentas | 1 |
| Actividades / series | 0 / 0 |
| Recetas / existencias / compras | 0 / 0 / 0 |
| Operaciones de inventario | 0 |
| Ingredientes comunes / privados | 41 / 0 |
| Calendarios General | 1 |

## Alcance

Lista para comenzar uso diario local en PC con internet. La sesión Google y los servicios de actividad/cocina usan el núcleo ya revisado. Este bloque no vuelve a realizar todas las pruebas integrales ni comprueba un ciclo real de siete días de rotación, una PC apagada o un fallo físico del equipo.

Se comprobó la restauración completa en esquema aislado del mismo servidor, no un desastre real ni otra instancia de Neon. La recuperación a una base separada se proporciona con rechazo de destinos ocupados y confirmación; usar una base recuperada requiere configurar explícitamente el núcleo.

Copias locales no protegen de perder la PC por sí solas: conservar también una copia externa y su clave. Mantenimiento requiere PC encendida, sesión Windows abierta e internet; la apertura de la app vuelve a intentarlo.
