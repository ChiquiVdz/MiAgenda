# Rendimiento general — 2026-10-06

Bloque autorizado después de la consolidación del núcleo. En la fecha de esta medición la revisión funcional integral estaba pendiente; se completó después y sus [resultados](RESULTADOS_REVISION_INTEGRAL.md) están disponibles. Este informe conserva las mediciones originales de lecturas y tipos, sin atribuirles cobertura funcional.

## Qué se cambió

- **Inbox/Agenda/detalles:** una consulta conjunta para la relación de recurrencia y su principal sustituye varias consultas anidadas. Solo se consultan los metadatos de Cocina cuando las actividades contienen pasos o comidas. Inbox utiliza la misma lectura común.
- **Planificar:** el origen de las porciones consumidas se obtiene con una proyección pequeña en una consulta, en vez de cargar por separado usos, tandas, versiones y completados completos. Conserva el último completado y la selección de opcionales, incluso después de deshacer.
- **Semana:** distribución de eventos y solapamientos calculados cuando cambia el período o su contenido; mover el reloj o abrir un cuadro ya no recalcula todos los eventos. Mapas de calendarios evitan búsquedas repetidas.
- **Mes/Año:** fechas analizadas una vez por evento, agrupaciones reutilizadas y formatos de fecha compartidos. El orden y las reglas de intersección se mantienen.
- **Inbox, Alacena, Recetario y Compras:** ordenar/filtrar listas depende de sus datos y de la búsqueda; no se repite al escribir una cantidad o cambiar otro campo. Formatos horarios reutilizados, con caché limitada que solo contiene formatos, nunca actividades ni datos personales.
- **Tabla del planificador:** mapa por fila/fecha para localizar cada comida, en lugar de recorrer toda la lista en cada celda.

No se modificó PROJECT.md ni el esquema. No se aplicaron migraciones ni cambios de inventario/actividades en el diagnóstico. Las transacciones coherentes, filtros por propietario, controles de revisión y comandos idempotentes siguen vigentes.

## Medición

Herramienta: `reconstruction/core/performance-app-audit.ts`. Tres rondas secuenciales sobre una cuenta con sesión vigente. PostgreSQL configura `default_transaction_read_only=on`: rechaza escrituras. Solo guarda tiempos, número de consultas, tamaño y huella de las respuestas; no registra contenidos, identificadores, SQL ni credenciales. La sesión se mide sin guardar su tamaño ni huella.

Datos en `performance-app-before.json` / `performance-app-after.json`. Medianas en milisegundos de los servicios, **no del tiempo total de una página ni de producción**. Incluyen transacción y comunicación con Neon. El número de consultas incluye las emitidas por Prisma para iniciar/cerrar la transacción.

| Lectura | Consultas antes → después | Mediana antes → después |
|---|---:|---:|
| Sesión | 1 → 1 | 96 → 70 ms |
| Inbox | 11 → 8 | 1238 → 696 ms |
| Calendarios | 4 → 4 | 570 → 421 ms |
| Agenda Día | 25 → 20 | 2604 → 1534 ms |
| Agenda Semana | 25 → 20 | 2577 → 1537 ms |
| Agenda Mes | 25 → 21 | 2573 → 1614 ms |
| Agenda Año/destacados | 14 → 9 | 1532 → 765 ms |
| Detalle de actividad | 17 → 13 | 1811 → 1041 ms |
| Alacena | 4 → 4 | 572 → 418 ms |
| Recetario | 5 → 5 | 669 → 486 ms |
| Planificar, una semana | 30 → 26 | 3077 → 1972 ms |
| Planificar, dos semanas | 30 → 26 | 3081 → 1960 ms |
| Compras | 9 → 9 | 1049 → 779 ms |
| Movimientos de un ingrediente | 4 → 4 | 570 → 417 ms |

**Interpretación:** los viajes a la base se redujeron aproximadamente 27% en Inbox, 20% en Día/Semana, 16% en Mes, 36% en Año, 24% en detalle y 13% en Planificar. La latencia del entorno también bajó entre rondas: incluso sesión, sin cambio de código, pasó de 96 a 70 ms. Por eso no debe atribuirse toda la diferencia de tiempo a las optimizaciones. Los números de consultas y la igualdad de las respuestas son evidencia más estable.

## Comprobaciones y límites

- TypeScript de la app y del núcleo finalizó sin errores después de los cambios.
- Las 13 lecturas de datos de las tres rondas conservan exactamente su respuesta serializada antes/después. La revisión de usuario no cambió durante cada medición. La lectura de sesión se excluye de la comparación por privacidad.
- Inspección de carga del navegador: Mes mostró 14 eventos, Año sus 12 meses y Planificar su tabla, sin avisos de error visibles. Un primer clic automatizado de Año a Planificar no navegó; repetido mediante el enlace visible, sí abrió Planificar. Esta observación no acredita toda la navegación. No se completaron/deshicieron comidas ni se ejecutó el plan integral en este bloque.
- Las listas actuales son pequeñas. No se midió una cuenta con cientos de recetas ni cientos de planes. Las mejoras de renderizado se basan en eliminar cálculos repetidos; no se atribuye un porcentaje de CPU sin perfil del navegador.
- La primera medición incompleta falló en una lectura de Agenda y se repitió. Los archivos de resultados contienen únicamente las rondas completas. El diagnóstico reintenta una lectura fallida una vez; no reintenta escrituras.
- Next está en desarrollo: compilar una ruta por primera vez, recargar módulos y las herramientas de desarrollo añaden consumo. Falta medir la versión de producción antes del despliegue.
- Planificar mantiene una proyección global de pendientes y reservas; no se limita a la semana visible porque rompería disponibilidad y compras.
- Se conserva la advertencia de compatibilidad de Prisma/pg sobre consultas concurrentes internas. No se actualizó pg ni se ocultó la advertencia.
- Se conserva la actualización explícita/al recuperar foco, sin sondeo continuo ni caché persistente por usuario. Una política offline y de invalidación se diseñará en su bloque aprobado.

## Repetir el diagnóstico

Desde la raíz, con Node 24: `node --experimental-transform-types reconstruction/core/performance-app-audit.ts after`. Requiere la configuración local del núcleo y acceso a Neon. `before` sobrescribe la línea base: guardar los archivos si se quiere conservar esta comparación.

Para el siguiente bloque consultar [revisión integral](REVISION_INTEGRAL.md): probar efectos, dependencias y persistencia, no solo carga de páginas. La guía incluye semanas, sustitución de ingredientes y creación de comidas desde Agenda.
