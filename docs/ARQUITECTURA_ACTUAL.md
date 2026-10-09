# Arquitectura actual de MiAgenda

Actualizado: 2026-10-08. Describe el código conectado, no funcionalidades futuras. `PROJECT.md`, especialmente 18/19, es el contrato; `MODELO_OBJETIVO.md` desarrolla el diseño aprobado. La reconstrucción está cerrada para uso diario local en PC.

## Una aplicación, una identidad de actividad

```text
Pantallas Next/React: Inbox · Agenda · Cocina
                    ↓ sesión verificada
                 /api/core
                    ↓
Actividad y recurrencias ↔ servicios especializados de Cocina
                    ↓
          Prisma + reglas SQL → PostgreSQL miagenda_core

Google → identidad para acceso con NextAuth, sin permisos de Calendar
```

`Activity` guarda identidad, propietario, tipo fijo, contenido, estado y parentesco. `ActivitySchedule` guarda su horario opcional. Inbox consulta principales de tipo tarea sin horario; programarlas cambia esa relación, no crea otra tarea. Un hijo puede estar programado mientras su padre no lo está. Solo se admite un nivel.

Una comida es Activity `meal` con `MealBlock`; sus pasos y preparaciones son hijos propios. Una receta del recetario es una definición versionada, no una actividad completada. Catálogo, stock, movimientos, tandas y recibos son datos especializados.

La captura global «＋ Anotar», montada en el layout, crea tareas de Inbox desde las pantallas autenticadas sin cambiar la página. La navegación se abre desde el lateral izquierdo; Cocina agrupa Alacena, Recetas, Planificar y Compras.

## Entradas y servicios

| Capa | Archivos principales | Responsabilidad |
|---|---|---|
| Acceso | `src/lib/auth.ts`, `core-runtime.ts`, `reconstruction/core/src/authentication.ts` | Sesión de base de datos, proveedor Google, sujeto de identidad; sin tokens Calendar persistidos |
| Transporte | `src/app/api/core/route.ts`, `reconstruction/core/src/http.ts` | Sesión, propietario, origen de mutaciones, comandos JSON hasta 64 KB, respuestas privadas |
| Actividades | `service.ts`, `queries.ts`, `views.ts`, `activity-reads.ts` | Identidad, contenido, hijos, horarios, flags, consultas y DTO común |
| Recurrencias | `recurrence.ts`, `series-*.ts` | Reglas, proyección por ventana, materialización de excepciones, alcances e identidad de familia |
| Inventario | `pantry.ts`, `ingredient-tracking.ts`, `ingredient-retirement.ts` | Catálogo personal, seguimiento por cantidad o disponibilidad, saldos, ajustes y sustitución explícita |
| Recetario | `recipes.ts`, `recipe-input.ts` | Borrador automático, revisiones y pasos inmutables |
| Planificación | `planner.ts`, `availability.ts`, `meal-weeks.ts` | Celdas, versiones congeladas, fases, reservas cronológicas, semanas y preparaciones previas |
| Cantidades por comida | `meal-amounts.ts`, `meal-amounts-server.ts` | Agrupación por ingrediente y opcionalidad, redondeo de piezas, ajustes manuales y reparto entre pasos |
| Consumo | `meal-consumption.ts` | Completado de comida, tandas reales, usos de porciones y reversión exacta |
| Compras | `shopping.ts`, `shopping-input.ts` | Faltantes calculados, cantidades elegidas, compra real y deshacer |
| Retención | `retention.ts`, rutas `/api/core/retention` y `/api/cron/retention` | Retirada por lotes y protección de relaciones/evidencias |

Los nombres de servicios sin prefijo corresponden a `reconstruction/core/src`. El cliente Prisma generado está en `reconstruction/core/generated`; no editarlo ni subirlo a Git. Esquema instalado: `reconstruction/core/schema.prisma`. SQL aplicado: `reconstruction/core/migrations`. `docs/schema.objetivo.prisma` es una referencia del diseño inicial, no el esquema que debe generar el cliente actual.

## Conexiones que deben permanecer comunes

| Acción | Resultado y responsable |
|---|---|
| Inbox → Agenda → Inbox | Conservar ID y progreso; modificar únicamente programación con ActivityService |
| Completar tarea o hijo | Recalcular principal con reglas comunes; las marcas rápidas son de esa instancia |
| Completar comida desde Agenda o Planificar | Ambas envían `setCompleted`; ActivityService delega a consumo, sin escribir completedAt desde la pantalla |
| Marcar pasos de cocina | `setMealStep` determina si corresponde completar; un paso aislado no descuenta |
| Crear comida desde Agenda | Mismo MealEditor, `saveMeal` y validación de celda que Planificar |
| Mover comida | `moveMeal` conserva actividad y consumo; verifica calendario Cocina y colisión de fila/fecha |
| Eliminar comida o semana | Retirar representación/reservas; conservar consumos y tandas. Eliminar no equivale a deshacer |
| Planificar o copiar semana | No cambia stock. Las consultas recalculan recursos y compras de todos los planes pertinentes |
| Comprar | Registrar cantidad efectiva y movimientos una vez; Solo disponibilidad activa Tengo sin cantidad ficticia y los artículos no alimentarios no crean stock |
| Sustituir ingrediente | Preferencia personal, traslado de stock en misma unidad y versiones nuevas; actualización de planes pendientes solo por elección explícita |
| Cambiar recurrencia | Alcances incluyen excepciones por identidad original; cambiar frecuencia conserva fechas protegidas/modificadas |

## Concurrencia, reintentos y actualización

- Todos los comandos usan el mismo bloqueo de propietario y espacio de recibos `(userId, commandId)`; efectos y recibo se confirman en una transacción. ActivityService y `executeOwnerCommand` aplican ese mismo protocolo.
- `revision` protege entidades; `dataRevision` permite rechazar consultas/confirmaciones antiguas. Un conflicto no autoriza sobrescribir silenciosamente.
- Los hooks conservan el mismo comando ante respuestas inciertas; bloquean otro guardado hasta resolverlo. Cambiar el contenido de un comando ya aplicado provoca conflicto de idempotencia.
- Lecturas de organización desde IndexedDB, incluso con internet. Al entrar se comprueban identidad/revisión y se pide permiso para descargar novedades; no hay recargas por foco/reconexión ni sondeo periódico. Guardar conectado mantiene la copia coherente y Actualizar fuerza una descarga. La línea de hora usa un temporizador local, no una consulta.
- LocalWorkspace conserva un snapshot acotado para todas las pantallas, navegación local y shell público con service worker. Los comandos y servicios siguen siendo comunes. Colas persistentes para tareas normales y Cocina, con envío manual, proyección contable y recibos idempotentes. Véase [copia local](COPIA_LOCAL.md); la revisión del snapshot impide mezclar páginas de revisiones distintas.
- Los formularios conservan revisiones esperadas; ante conflicto se debe revisar/recargar. Un reintento de una respuesta perdida recupera el resultado anterior, no recalcula un consumo nuevo.

## Retención e historial

Cinco días desde completado y nunca antes del fin, con excepciones Conservar y relaciones de hijos. Una principal conservada protege sus hijos. Retirar un detalle deja las exclusiones recurrentes y evidencias necesarias para evitar reapariciones/doble consumo y sostener sobras.

No confundir retirada de contenido visible con borrar físicamente todos sus registros. Las revisiones de recetas, evidencias de inventario y recibos idempotentes siguen persistidos. La compactación de recibos aún no tiene horizonte implementado; deberá definirse junto con los reintentos offline. Comprados muestra treinta días, pero ese filtro no elimina sus recibos.

El mantenimiento de usuario se solicita al actualizar explícitamente la copia en un lote corto; un cron protegido permite continuar con la app cerrada cuando se despliegue. `vercel.json` configura una llamada diaria; eso no demuestra que haya un despliegue o CRON_SECRET configurado. La base usa un pool de dos conexiones por proceso de Prisma; no es un límite global para todos los servidores.

El uso diario local tiene herramientas de apertura/cierre, compilación, respaldo cifrado y restauración. Una tarea de Windows ejecuta mantenimiento cuando la PC está disponible; actualizar la copia vuelve a intentarlo. Ver [guía local](USO_DIARIO_LOCAL.md) y [comprobación de herramientas](RESULTADOS_USO_DIARIO_LOCAL.md).

## Cantidades y seguimiento de ingredientes

El modo quantity/availability es una preferencia privada del usuario. Solo disponibilidad usa Tengo/Se terminó sin reservar ni consumir cantidades. Los movimientos numéricos históricos se conservan al cambiar modo; regresar a cantidad requiere indicar existencias reales.

`MealRecipe.ingredientQuantities` guarda ajustes por ingrediente y grupo obligatorio/opcional. Objeto vacío usa cálculo automático: sumar usos y redondear piezas hacia arriba, gramos/ml proporcionales. Los ajustes manuales persisten al cambiar porciones y pueden volver a cálculo automático. Valor nulo conserva el cálculo proporcional de planes antiguos. Editor, disponibilidad, Compras y consumo comparten esos importes; deshacer invierte los movimientos registrados. Copiar conserva ajustes; actualizar expresamente la versión de receta los recalcula. Sin Cocinar no se generan demandas.

## Límites actuales y trabajo posterior

- Creación y movimiento con hora en intervalos de quince minutos. Duración de cocina combinada redondeada a cinco minutos; no forzar la duración calculada de comida a quince.
- Agenda arrastra actividades con hora; Todo el día conserva edición por formulario.
- Reemplazo de ingredientes entre unidades distintas requiere diseño posterior; el actual exige misma unidad.
- Crear una serie y editar sus reglas está conectado; la conversión de una tarea aislada existente en serie no tiene un flujo dedicado.
- La zona predeterminada de varias superficies de Agenda es America/Mexico_City; no existe un editor de zona personal general.
- El límite de solicitudes vive por proceso. Seguridad/despliegue deberán evaluar varias instancias, HTTPS y configuración OAuth.
- Captura global y ajustes de interfaz de PC están implementados. La revisión visual de Cocina fue aceptada por el usuario; la primera adaptación móvil y copia local de consulta están implementadas; la primera publicación y el acceso en iPhone fueron confirmados. La cola local de tareas/Cocina requiere revisión de sus nuevos recorridos; faltan edición offline de series/planes, dashboard, widget y nuevos módulos.
- Rutinas con pasos relativos a otro completado y recurrencia desde el completado están discutidas, sin implementación.

## Evidencia y límites de revisión

La [revisión integral](RESULTADOS_REVISION_INTEGRAL.md) registra 76 comprobaciones integrales, 30 de retención y 4 de acceso/aislamiento, además de correcciones y recorridos de navegador. La [revisión reciente de Cocina](RESULTADOS_COCINA_CANTIDADES.md) añade 45 comprobaciones de cantidades, disponibilidad, compras y sobras; el usuario aceptó la revisión visual de Cocina. La [guía manual](REVISION_INTEGRAL.md) queda para futuras revisiones, no como bloque de cierre sin ejecutar. No se ha validado exhaustivamente cada gesto, accesibilidad, dispositivo, carga o carrera entre pestañas; el acceso publicado fue confirmado después por el usuario, y las pruebas específicas de las nuevas colas offline siguen pendientes.
