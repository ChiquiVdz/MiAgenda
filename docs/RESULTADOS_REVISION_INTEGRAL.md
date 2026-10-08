# Resultados de la revisión integral

Fecha: 7 de octubre de 2026. Núcleo propio, PostgreSQL de Neon y Google únicamente para acceso. PROJECT.md se leyó y no se modificó en este bloque.

Actualización de estado al 2026-10-08: este informe conserva la evidencia y la interfaz de su fecha (incluido el antiguo panel Sin existencias, retirado después). La [revisión reciente de Cocina](RESULTADOS_COCINA_CANTIDADES.md) añade 45 comprobaciones y aceptación visual del usuario. El [uso diario local](RESULTADOS_USO_DIARIO_LOCAL.md) tiene su propia verificación. No confundir observaciones históricas de este informe con controles que deban seguir visibles.

## Evidencia técnica

- **76 comprobaciones integrales aprobadas**: `reconstruction/core/integral-verification.json`. Se aplicaron todas las migraciones en un esquema temporal y se invocaron los servicios reales, con sus transacciones y restricciones de base de datos.
- **30 comprobaciones de retención aprobadas**: `reconstruction/core/retention-verification.json`. Incluyen límites de cinco días, lotes, protección de principal/hijos y exclusiones recurrentes que no reaparecen.
- **4 comprobaciones de acceso y aislamiento aprobadas**: `reconstruction/core/isolation-verification.json`. La sesión funciona incluso con un search_path que no incluye las tablas de la app.
- TypeScript de la aplicación y del núcleo: sin errores.
- Los esquemas temporales se eliminaron al terminar. No se alteraron fechas de completado ni cantidades de Cocina de la cuenta real.

## Flujos cubiertos con servicios reales

1. Inbox y subtareas: completar, deshacer, reabrir al añadir pendiente, un único nivel, agendar/quitar horario y conservar identidad.
2. Acceso y permisos: separación entre propietarios, revisión antigua rechazada, reintento idempotente, mismo comando con contenido diferente rechazado, origen de API y ausencia de sesión.
3. Calendarios: traslado conserva identidad y horario. Destacar activa Conservar, luego ambas marcas son independientes; sin horario se rechazan.
4. Recurrencias: lectura no materializa futuro, subtareas por clave y alcance, frecuencia nueva mantiene excepciones ligadas, borrar toda la serie las incluye, 31 y 29 de febrero ajustados.
5. Recetas y comidas: borrador automático, datos mínimos, equivalencias, versión planificada congelada, cocina combinada redondeada a cinco minutos.
6. Consumo: cocinar cuatro porciones descuenta ocho piezas, comer una deja tres; consumir dos sobras deja una sin otro descuento. Deshacer origen con dependientes se bloquea. Reversión devuelve exactamente el consumo y opcionales usados.
7. Disponibilidad y compras: el plan cercano desplaza la reserva del lejano, compras incluye semanas distintas, cantidad manual persiste, comprar reintentando no duplica, deshacer es exacto, jabón no crea ingrediente, libres al final, sin Cocinar no hay demanda.
8. Preparaciones previas: no completan ni consumen la comida, y conservan su completado al mover el bloque.
9. Copiar/borrar semanas: copias pendientes con identidades nuevas, versiones y fases conservadas, preparaciones inicialmente sin aceptar, destino ocupado rechazado. Borrar completadas conserva stock y tandas; pendientes libera demandas.
10. Sustitución: traslada existencias, actualiza pendientes, conserva versiones completadas e historial; cocinar/deshacer con el sustituto sigue siendo exacto. Retirar sin sustituto conserva el texto del paso.
11. Retención de comida completada: retira la actividad sin devolver ingredientes ni borrar su tanda real.

## Fallos corregidos

### Guardado de recetas

El disparador compartido intentaba acceder a ingredientId incluso al insertar una versión de receta que no tiene ese campo. PostgreSQL devolvía P2022. Se añadió la migración incremental `20261006000200_recipe_trigger_record_guard`, aplicada a miagenda_core; las validaciones de ingredientes se ejecutan únicamente en recipe_steps. Se comprobaron creación, edición, copia y sustitución.

### Sustitución con existencias

El movimiento de traslado omitía sourceRevision, exigido por inventory_operation_shape. Se registra ahora la revisión del saldo de origen. No se relajó la restricción ni se reescribió historial. Pruebas de traslado, consumo y reversión aprobadas.

### Acceso intermitente durante la revisión

Las consultas SQL añadidas para rendimiento no especificaban el esquema. El verificador había cambiado search_path a nivel de conexión compartida del pool de Neon, provocando 42P01 en el acceso. Se corrigió el verificador para usar SET LOCAL dentro de cada transacción de migración, y las consultas activas de acceso, actividades, Alacena y Planificar nombran explícitamente public. No se cambiaron permisos OAuth ni credenciales. Se agregaron diagnósticos que muestran solo códigos de error, sin tokens, consultas ni datos personales.

## Revisión del navegador

Se usó la cuenta autorizada: acceso, captura de tarea y subtarea, completar por último hijo, deshacer principal, agendar en General y comprobar salida de Inbox; detalle en Semana y Mes, Destacar/Conservar y aparición en Año. Crear Comida desde Agenda cargó el editor especializado, detectó la celda ocupada y abrió el bloque existente conservando fecha, hora, porciones y fases. La tarea «Revisión integral · tarea temporal» y su hijo se retiraron al finalizar.

Alacena mostró saldos, Guardar desactivado sin cambios y el desplegable Sin existencias. Recetario cargó recetas listas y desplegó pasos, ingredientes, equivalencias y opcionales sin guardar modificaciones.

Planificar mostró lunes a domingo, las mismas comidas visibles en Agenda y el aviso de faltantes del licuado. Compras se revisó como parte del recorrido; sus cantidades, opcionales y compras realizadas cargaron sin redirección a Inbox.

## Límites y siguiente revisión

La aprobación de servicios no demuestra todos los gestos de interfaz. La lista manual de REVISION_INTEGRAL.md sigue disponible para revisar preferencias visuales, arrastre/resize, accesibilidad, navegación móvil y carreras entre pestañas. No se realizó prueba de carga ni despliegue de producción. Consulta sin conexión, widget y módulos futuros siguen fuera de este bloque.

En desarrollo pg muestra una advertencia de futura retirada de consultas concurrentes sobre un mismo cliente; no fallaron las transacciones revisadas. Debe atenderse antes de actualizar a pg 9. La compilación inicial de páginas locales puede tardar más que visitas posteriores.
