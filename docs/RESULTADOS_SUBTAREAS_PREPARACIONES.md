# Revisión de subtareas y preparaciones previas

Fecha: 8 de octubre de 2026. Revisión funcional solicitada antes de añadir funciones. PROJECT.md conserva sus reglas aprobadas y no se modifica en este bloque.

## Resultado

**57 comprobaciones aprobadas** con servicios reales, Prisma, PostgreSQL y todas las migraciones en un esquema temporal aislado. Informe: `reconstruction/core/subtasks-preparations-verification.json`, con `failure: null` y `temporarySchemaRemoved: true`.

Se verificaron estos cruces:

- **Recurrencia:** programar, cambiar y quitar horario con los tres alcances; identificación estable después de renombrar; omisión de eliminadas; conservación del horario de completadas; cruce de mes; proyección sin crear indefinidamente instancias; cambio de frecuencia y borrado de la serie con excepciones.
- **Calendarios:** los hijos heredan el calendario de su principal programada, también al cambiarlo y aunque estén completados. Mantienen horas y marcas. Los filtros incluyen hijos fuera del día de la principal. Un hijo de Inbox puede tener calendario propio hasta agendar la principal, momento en que adopta el suyo.
- **Preparaciones:** crear límites previos desde los pasos, reutilizar la misma casilla, duración inicial de cinco minutos y completar/deshacer tramos respetando su orden. Un tramo no consume inventario ni completa la comida; tampoco presupone sus opcionales.
- **Finalización:** exigir selección de opcionales cuantificados al terminar el bloque, consumo único incluso al reintentar, completar solo obligatorios y reversión exacta. Disponibilidad no genera descuentos numéricos. Mover la comida conserva el horario de sus tramos completados.
- **Pantallas:** las consultas compartidas de Inbox, Agenda, Planificar, Alacena y Compras reflejan programación, calendario, compras, completado y reversión. Retirar un plan pendiente libera sus demandas sin alterar existencias.

## Corrección realizada

El reloj de una preparación utilizaba el formulario general, que exigía que la hora final coincidiera con intervalos de 15 minutos. Esto impedía guardar preparaciones de cinco minutos.

Ahora las preparaciones muestran su **duración editable en minutos**. El inicio mantiene los intervalos aprobados de 15 minutos, y el final se calcula según la duración. Las tareas normales conservan su formulario habitual. Sin nuevas dependencias ni migraciones.

Comprobaciones de tipos del núcleo y la aplicación, y compilación de producción local: correctas.

## Comprobación en navegador

En la cuenta autorizada se revisaron el reloj de una subtarea recurrente, sus tres alcances y calendario heredado. En Planificar se comprobó una preparación inicialmente sin seleccionar, con duración de cinco minutos, y que cambiar el inicio modifica su hora sugerida.

También se guardó una comida temporal con una preparación, se abrió desde Agenda y se guardó su horario de cinco minutos correctamente. El intento de completar sin suficientes existencias mostró el faltante y no produjo consumo. La comida temporal se retiró al finalizar mediante el servicio de Planificar: sin completados, sin celda ni horarios activos. Las recetas y existencias anteriores se conservaron.

La conexión de control del navegador dejó de responder durante la limpieza; esta se terminó mediante el servicio real y se verificó en la base. No se atribuye al usuario una revisión visual de todos los casos automatizados.

![Preparación de cinco minutos guardada desde Agenda](evidencia/preparacion-cinco-minutos.jpg)

## Repetir la revisión

Desde la raíz, con la conexión del núcleo configurada:

```powershell
& 'C:/Users/emimt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --experimental-transform-types reconstruction/core/verify-subtasks-preparations.ts
```

Debe terminar con `DONE 57 comprobaciones` y `Esquema temporal eliminado`. El verificador no utiliza cuentas ni existencias reales.

## Límites

La revisión cubre los casos indicados, no garantiza ausencia de cualquier fallo posible. No incluye móvil, despliegue público, notificaciones, offline, pruebas de carga ni todos los gestos de arrastre. Las revisiones anteriores de cantidades, sobras y copia de semanas siguen documentadas por separado en `RESULTADOS_COCINA_CANTIDADES.md`.
