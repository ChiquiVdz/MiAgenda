# Transición a actividades comunes

> Registro histórico de la implementación anterior. Sus migraciones y adaptadores están retirados y recuperables; el estado vigente se documenta en [ARQUITECTURA_ACTUAL.md](ARQUITECTURA_ACTUAL.md).

`PROJECT.md` conserva las decisiones del proyecto. El diseño aprobado está en
`ACTIVIDADES_BASE_COMUN.md`; este documento registra qué está implementado realmente.

## Bloque 2, preparación de persistencia

- Migración aditiva `20261004150000_activity_foundation` con `Activity`,
  `ActivityCalendarLink` y `ActivityLegacySource`.
- Identidad única de evento por usuario/calendario/evento; máximo un vínculo actual
  por actividad. Las claves foráneas compuestas impiden mezclar propietarios.
- Tipo y propietario inmutables. La base de datos impide autorreferencias y más de
  un nivel de hijos, incluyendo cambios de principal cuando ya existen hijos.
- Los registros preparados tienen estado `staged`. No aparecen en la interfaz y
  no guardan una copia editable del progreso. Los servicios existentes siguen
  siendo la autoridad hasta el cambio explícito del siguiente tramo.
- El vínculo preparado permanece `pending`: el inventario de la base de datos
  no demuestra que el evento siga existiendo en Google.
- El preparador no crea vínculos nuevos para comidas ni para eventos de subtareas.
  Esos grupos tienen bloques posteriores propios.

## Herramientas de transición

Desde la raíz del proyecto, con Node y `DATABASE_URL` configurados:

```sh
node scripts/activity-inventory.cjs
node scripts/stage-activity-identities.cjs
```

El inventario es de solo lectura y publica únicamente conteos. El preparador usa
transacciones y el mismo bloqueo por usuario que las operaciones existentes.
Puede ejecutarse otra vez: las correspondencias y los eventos son únicos, no
se duplican identidades. Un grupo con traslados, programación de subtareas o
cambios de series pendientes, o con hijos anidados, se pospone.

Conserva el ID anterior si está disponible. Une recibos y overlays por el vínculo
exacto de Google; nunca por el título. Un recibo sin overlay correspondiente se
pospone: no se importa un evento posiblemente borrado ni se devuelve a Inbox.
Si las correspondencias contradicen una identidad existente, revierte el grupo.
Los datos anteriores, Google, recetas, inventario y consumos permanecen intactos.

## Pendiente para cerrar el bloque 2

La primera ejecución preparó un usuario, 3 pendientes de Inbox y 95 overlays de
tareas. Pospuesto: 3 recibos antiguos sin overlay asociado. El inventario previo
no encontró operaciones pendientes ni subtareas anidadas. La migración se
aplicó correctamente en la base de datos local configurada en Neon.

1. Refrescar los vínculos con Google y recuperar cualquier operación pendiente.
2. Cambiar los servicios de tareas principales y sus rutas de compatibilidad a
   la actividad común, sin dejar dos fuentes editables de completado.
3. Mantener la misma identidad al agendar, preservando el progreso de tareas
   completadas y los vínculos de hijos existentes.
4. Incorporar quitar horario con recuperación de intentos, etag, advertencia de
   Conservar/Destacar y retención; mantener los eventos de hijos independientes.
5. Adaptar programación de todo el día desde Inbox y revisión de retención,
   borrado externo, eliminación manual y recurrencias con servicios actuales.

La preparación de identidades **no equivale a completar el bloque 2**. Todavía no
hay un cambio visible que el usuario pueda revisar para esas funciones nuevas.
