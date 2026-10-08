# Base común de actividades — bloque 1

> Documento histórico de la transición de la implementación anterior. No describe la arquitectura activa. Consultar [PROJECT.md](../PROJECT.md) y [ARQUITECTURA_ACTUAL.md](ARQUITECTURA_ACTUAL.md); no reactivar vínculos de Google Calendar de este diseño.

## Estado y alcance

Diseño para revisión, acordado en la conversación con Emilio. Este documento describe el modelo objetivo y la transición; no significa que ya estén implementados. En este bloque solo se añade documentación. No se modifica el esquema de Prisma, no se aplican migraciones y no se escriben datos ni eventos de Google.

`PROJECT.md` sigue siendo la base del proyecto, especialmente sus secciones 18 y 19. No se ha modificado. Este diseño concreta la evolución solicitada para la implementación existente y conserva la separación entre Google Calendar y los datos propios de MiAgenda.

## 1. Decisiones de producto confirmadas

- Todas las actividades comparten identidad, propietario, título, descripción opcional, completado y posibilidad de tener subtareas.
- Tipos iniciales fijos: tarea/evento y comida. No se ofrece convertir una comida en tarea ni una tarea en comida durante esta transición.
- Inbox muestra las tareas principales sin programación. Agendar una tarea la retira de Inbox sin cambiar su identidad ni su progreso.
- Una subtarea puede tener su propio evento aunque su principal permanezca en Inbox. La subtarea sin horario se ve dentro de su principal, no como otro pendiente principal duplicado en Inbox.
- Solo un nivel de subtareas. Una subtarea no puede ser principal de otras subtareas.
- Conservar y Destacar requieren programación. Las tareas de todo el día también cumplen ese requisito.
- Activar Destacado activa Conservar; después pueden modificarse independientemente. Activar Conservar no activa Destacado.
- Quitar el horario de una tarea elimina su evento y desactiva Conservar y Destacar, con aviso antes de confirmar. Conserva identidad, texto, subtareas, marcas y fecha de completado. Sus subtareas programadas conservan sus horarios.
- Quitar el horario de una subtarea conserva su casilla en la principal; no crea un pendiente principal en Inbox.
- Las comidas requieren fecha y hora. No pueden agregarse a Inbox ni quitar su horario. Se pueden reprogramar o eliminar siguiendo las reglas existentes.
- La receta del recetario es una definición reutilizable, no una actividad que se complete. Planificarla crea una instancia con sus propios pasos, porciones y consumo.
- Una comida puede reunir varias recetas. Los pasos dependen directamente de la actividad de comida; agruparlos visualmente por receta no crea otro nivel de subtareas.
- Los eventos ya existentes en Google se incorporan al modelo persistido cuando requieren datos propios de MiAgenda. Consultar un calendario no genera registros para todos sus eventos.
- Completar no borra inmediatamente. Se mantienen los cinco días, Conservar, la protección de eventos futuros y la prohibición de purgar masters recurrentes.

## 2. Modelo lógico objetivo

Los nombres y campos siguientes son una especificación conceptual para preparar las migraciones posteriores, no una declaración de Prisma ya aplicada.

### Activity: identidad y estado común

| Campo | Propósito |
| --- | --- |
| `id` | Identidad estable, independiente de la pantalla y del ID de Google. |
| `userId` | Propietario; toda consulta y operación se aísla por usuario. |
| `kind` | `task` o `meal`, fijo después de crear la actividad. |
| `title`, `description` | Contenido local si no está programada; copia de presentación si tiene evento. |
| `parentId` | Principal opcional. Debe ser del mismo usuario y no tener principal propia. |
| `position` | Orden de subtareas dentro de su principal. |
| `completedAt` | Estado común de completado. Se conserva al agendar o quitar horario. |
| `keep`, `highlighted` | Propiedades propias de MiAgenda, disponibles con programación. |
| `revision` | Control de cambios simultáneos; una marca o edición invalida una versión anterior. |
| `lifecycle` | Visible o retirado; distingue una actividad activa de un origen mínimo retenido por dependencias. |
| `createdAt`, `updatedAt` | Auditoría operativa. No sustituyen la fecha del evento. |

Una subtarea utiliza el mismo modelo `Activity`. Su función especializada se determina por la relación y sus datos adicionales: un paso de comida puede ser `task` con datos de preparación, sin convertirse en una segunda comida.

No se crea un campo `section = inbox/agenda/cocina` para decidir su identidad. Las vistas se obtienen de sus relaciones y capacidades: Inbox sin programación, Agenda con programación y Cocina por tipo y vínculos especializados. Los filtros de calendarios siguen siendo preferencias de presentación.

### ActivityCalendarLink: conexión con Google

Una actividad tiene como máximo un vínculo actual con un evento. Cada evento tiene como máximo una actividad por usuario. La unicidad usa `userId + googleCalendarId + googleEventId`, porque distintos usuarios pueden consultar el mismo evento compartido.

El vínculo guarda los IDs de Google, etag, estado de sincronización y las copias de tiempos necesarias para consultar y calcular retención. Distingue vínculo confirmado, operación pendiente, evento ausente y vínculo retirado por retención. Una petición en curso no hace aparecer una tarea como agendada antes de que Google confirme su evento.

Google sigue siendo autoridad de título, descripción del evento, fecha, hora, duración, calendario y recurrencia cuando hay vínculo confirmado. Editar esos datos pasa por su API y verifica el etag. Los campos locales de presentación son copias, no una segunda agenda independiente.

Las tareas admiten fecha con hora o evento de todo el día. Las comidas admiten únicamente horario de inicio y fin. Se conserva la convención de Google de fin exclusivo en eventos de todo el día.

### Datos especializados de Cocina

- `Recipe` y sus pasos siguen definiendo cómo preparar algo, con ingredientes, cantidades por porción, opcionales y anticipación sugerida.
- La actividad `meal` tiene una extensión de bloque para Cocinar/Comer/Lavar, tiempos personales y duración ajustada.
- Cada `MealPlan` existente corresponde a una receta dentro del bloque, con sus porciones, cantidades congeladas e identidad propia. Se mantiene su ID para conservar ledger, tandas y usos de sobras.
- Cada subtarea de preparación enlaza al plan y al identificador del paso de origen. Guarda su carácter obligatorio/opcional y los datos congelados necesarios para calcular cantidades usadas.
- La receta reutilizable no recibe marcas de las instancias. Editar el recetario no reescribe las preparaciones ya planificadas.
- Las reservas, compras, tandas, usos y movimientos de inventario siguen siendo datos especializados. No se añaden a todas las tareas.

### Definición de serie e instancia

El master de Google y la definición versionada de subtareas pertenecen a la serie. Cada aparición tiene su propia identidad y estado en MiAgenda cuando necesita persistencia.

Las subtareas usan una identidad propia por instancia y una clave estable de definición para aplicar cambios a una serie. Se relacionan por esa clave, nunca por coincidencia de nombre. El vínculo de familia debe conservar los tramos separados y las excepciones ya registradas en `TaskSeriesMember`.

Consultar recurrencias futuras no materializa una serie infinita en la base de datos. Las reglas versionadas y las instrucciones de marcas existentes se mantienen hasta que el bloque de recurrencias adapte su resolución.

## 3. Operaciones comunes y reglas especializadas

Una capa de operaciones recibe identidad, usuario, revisión y un identificador del intento. Comprueba permisos y llama a las reglas correspondientes antes de confirmar el cambio.

| Operación | Comportamiento |
| --- | --- |
| Crear tarea | Crea una actividad local o una actividad vinculada a Google, según tenga programación. |
| Agendar | Crea el vínculo para la misma actividad. Conserva sus hijos e identidad. |
| Reprogramar | Actualiza Google con etag; conserva marcas y vínculos. |
| Quitar horario | Solo tareas/subtareas; borra el evento con etag y conserva la actividad como principal de Inbox o casilla, según corresponda. |
| Completar/deshacer | Aplica el estado común y las reglas del tipo y de su principal. |
| Conservar/Destacar | Comprueba programación y utiliza la misma regla en todas las vistas. |
| Eliminar manualmente | Elimina la actividad y los eventos de sus subtareas, después de comprobar el conjunto y las reglas de Cocina. |
| Purga automática | Retira únicamente lo elegible por su propia retención; no equivale al borrado manual del conjunto. |

Para tareas normales se conserva completar todas las subtareas desde la principal y completar la principal al terminar todas sus subtareas. Las subtareas programadas conservan su propio final para retención aunque se marquen antes de su horario.

Para comidas se conserva la excepción de pasos obligatorios y opcionales: terminar los obligatorios completa el bloque; el círculo conserva la selección rápida de opcionales. Una preparación previa marcada no consume ingredientes por separado. Completar la comida registra el consumo una vez, dentro de una transacción. Deshacer devuelve exactamente lo registrado y respeta las dependencias de sobras. Un paso de comida llama a esas reglas de su principal, no al comportamiento de una tarea normal independiente.

## 4. Persistencia segura y retención

- La programación y su eliminación se registran como operaciones recuperables antes de modificar Google. Los reintentos reutilizan el ID de evento del mismo intento; una respuesta perdida no crea otra actividad ni otro evento.
- Quitar horario se confirma tras verificar o recuperar el borrado en Google. Hasta entonces no se presenta una actividad simultáneamente como pendiente de Inbox y evento activo confirmado.
- Eliminar un evento directamente en Google no se interpreta como «Quitar horario» ni devuelve automáticamente una actividad a Inbox. Se identifica como eliminación externa y se conservan las reglas actuales de reconciliación e historial mínimo.
- Quitar horario conserva `completedAt`. Si la tarea ya cumplió cinco días, pasa a ser elegible para la limpieza de Inbox; el aviso debe explicar esto cuando corresponda.
- La retención de una principal no borra automáticamente hijos futuros o conservados. Se retiene solo el origen necesario hasta retirar el último vínculo dependiente.
- Si se purga el evento de una subtarea antes de que desaparezca su principal, se conserva la información mínima de su casilla y progreso necesaria para representar la principal. No se la devuelve a Inbox ni se mantiene su evento como activo.
- Al retirar comidas se conserva únicamente la información de origen/consumo necesaria para las tandas y usos de sobras. La migración no recalcula ni revierte consumos existentes.
- Al desaparecer las dependencias, se elimina el registro mínimo que ya no sea necesario. No se crea un archivo permanente de todas las actividades terminadas.
- Ninguna actividad puede enlazar una principal de otro usuario, enlazarse a sí misma o generar un segundo nivel de subtareas.

## 5. Correspondencia con la implementación actual

| Estructura actual | Destino o adaptación |
| --- | --- |
| `InboxItem` activo | Actividad principal `task` sin vínculo confirmado de Google. |
| Recibo de traslado de Inbox | Correspondencia con la actividad que ya tiene ese evento; nunca otra actividad visible. |
| `EventOverlay` normal | Estado de una actividad `task` más su vínculo con Google. |
| `EventOverlay` de comida | Actividad `meal` más datos especializados de bloque. |
| `checklist` JSON de Inbox/overlay | Actividades hijas; se mantienen las claves originales de pasos. |
| `ScheduledSubtask` | Vínculo de Google de la misma actividad hija, asociado por identidad a su principal. |
| `ActivityChecklist` | Definición versionada de subtareas de serie; no confundir con una instancia completada. |
| `TaskSeriesMember`, `TaskChecklistMark` | Relaciones e instrucciones de serie que debe preservar el bloque 4. |
| `Recipe.steps` | Definición reutilizable, conserva sus IDs y metadata. |
| `MealPlan.preparationSteps` | Datos congelados y actividades hijas de la comida, agrupadas por receta. |
| `MealPlan`, `InventoryLedger`, `CookedBatch`, `PortionUse` | Conservan identidades y referencias; se adapta el enlace a la actividad de comida. |

Una subtarea que ya tiene evento se identifica por su principal y clave de paso, incluyendo `mealStepKey(planId, stepId)` en Cocina. Se convierte en una sola actividad hija; no se crea otra por separado para el evento.

Para IDs que proceden de varias tablas se conserva el ID existente cuando sea inequívoco. En otros casos se crea una correspondencia explícita y única entre identidad anterior y nueva. Los IDs de Google no se cambian. Los recibos de traslado se unen por su vínculo comprobado, nunca por título.

## 6. Transición por bloques

### Bloque 1 — este documento

Cerrar reglas, modelo lógico, correspondencias y criterios de revisión. Sin cambios de funcionamiento.

### Bloque 2 — tareas principales de Inbox y Agenda

1. Inventariar los registros reales y las operaciones pendientes antes de migrar.
2. Añadir las estructuras comunes y correspondencias sin eliminar las actuales.
3. Migrar por grupos reanudables, conservando progreso, IDs y vínculos. Un traslado a medias debe resolverse antes del cambio de fuente de ese grupo.
4. Cambiar los servicios de tareas principales a la identidad común. Las rutas existentes pueden actuar como adaptadores de compatibilidad.
5. Incorporar quitar horario, tareas de todo el día y restricciones de Conservar/Destacar.
6. Mantener subtareas y series existentes mediante adaptadores hasta sus respectivos bloques.

No hay dos fuentes editables del mismo estado. Antes del cambio de un grupo, manda el servicio existente; después, manda la actividad común y las rutas de compatibilidad delegan en él. Los campos antiguos no se convierten en una segunda fuente de marcas.

### Bloque 3 — subtareas

Convertir casillas y eventos vinculados en actividades hijas únicas; adaptar programación, edición, marcas y borrado. Aplicar un nivel máximo.

La implementación anterior permite algunos vínculos anidados. El inventario debe detectar si existen datos reales de ese tipo: no se eliminan ni se aplanan silenciosamente. Si aparecen, se presenta su estructura para acordar su conversión antes de migrar el grupo afectado.

### Bloque 4 — recurrencias

Adaptar definiciones, instancias, excepciones y alcances de edición/borrado/marcas. Conservar IDs de definición y familias partidas. La retención sigue sin borrar masters.

### Bloque 5 — Cocina

Enlazar bloques, planes y pasos al modelo común, manteniendo el ledger y los vínculos de preparaciones previas. Adaptar completar/deshacer, compras y proyección cronológica. No ejecutar descuentos o devoluciones como parte de la migración.

### Bloque 6 — consolidación

Compartir presentación y controles donde correspondan. Retirar estructuras antiguas solo cuando ningún flujo dependa de ellas, haya correspondencias completas y se haya revisado su comportamiento. Actualizar documentación de implementación y eliminar adaptadores ya innecesarios.

## 7. Revisión antes de avanzar de cada bloque

Estos son criterios para la revisión posterior; no se han ejecutado pruebas en este bloque documental.

- Una tarea mantiene su identidad y progreso al pasar Inbox → Agenda → Inbox.
- No aparecen actividades duplicadas por recibos, reintentos o eventos de subtareas.
- Una subtarea agendada mantiene el vínculo al agendar o quitar horario de su principal.
- Todo el día habilita Conservar/Destacar; quitar horario los desactiva con aviso.
- No se puede poner una comida en Inbox ni añadir subtareas a una subtarea.
- Las series conservan excepciones y los tres alcances, incluso con nombres o pasos modificados.
- La migración de Cocina deja iguales inventario, movimientos, tandas y usos; completar y deshacer siguen siendo idempotentes y respetan las dependencias.
- La purga no elimina eventos futuros, conservados o masters; el borrado manual respeta su conjunto y los consumos ya realizados.
- Los conflictos de Google requieren actualizar/reintentar; nunca se sobrescribe otro cambio sin etag.
- Los datos y relaciones de un usuario nunca se pueden consultar ni modificar desde otra cuenta.

## 8. Trabajo pendiente previo a esta reorganización

Después de revisar las preparaciones previas ya implementadas, quedaban dos mejoras: ofrecer reajustar las pendientes cuando se mueve una comida y ofrecer agendar preparaciones de comidas/semanas copiadas. No se incluyen dentro del diseño ni se dan por terminadas; se retomarán sobre la base común después de integrar Cocina.
