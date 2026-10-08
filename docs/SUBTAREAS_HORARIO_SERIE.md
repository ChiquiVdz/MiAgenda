# Horarios de subtareas por alcance

Implementado el 2026-10-08. Requiere las migraciones aditivas `20261008000300_recurring_subtask_schedules` y `20261008000400_subtask_inherit_calendar`.

## Uso

Abrir una principal recurrente, desplegar sus subtareas y pulsar el reloj. El selector permite Solo esta, Esta y las siguientes o Toda la serie. Elegir fecha, hora y fin; guardar. El calendario se hereda de la principal programada y no se puede elegir otro; si la principal está en Inbox, sí se puede elegir. Al agendarla, sus hijos adoptan su calendario. Cambiar el calendario de una principal traslada también sus hijos completados, sin cambiar horas ni marcas. La fecha elegida se interpreta como diferencia de días respecto a esa principal cuando se aplica un alcance de serie.

Ejemplo: MRN RTN del lunes, Bañarme lunes 8:00–8:15. Toda la serie programa cada Bañarme a las 8:00 del día de su propia principal. Elegir el domingo corresponde al día anterior en cada repetición.

Cambiar o quitar usa los mismos alcances. Completadas conservan su horario; eliminadas se omiten; renombradas se encuentran por identidad. Quitar horario mantiene casilla y progreso. Arrastrar es solo esa instancia. El reloj ofrece alcance también en Día, sin cambiar el completado rápido por instancia.

## Revisión manual

1. Crear una tarea diaria de prueba, con fecha final en dos semanas. Agregar Bañarme a toda la serie.
2. En su reloj, elegir 8:00–8:15 del mismo día y Toda la serie. Revisar hoy, mañana y la siguiente semana: debe aparecer también como actividad propia, ligada a su principal.
3. Cambiar a 8:30 desde una instancia intermedia, Esta y siguientes. Anteriores mantienen 8:00; posteriores, 8:30.
4. Marcar una Bañarme completada; renombrar otra y eliminar otra solo de esa instancia. Cambiar hora para toda la serie: completada conserva su hora, renombrada se actualiza y eliminada no reaparece.
5. Quitar horario para siguientes: desaparece de Agenda como actividad independiente en pendientes, pero sigue como casilla de su principal. Completadas permanecen como estaban.
6. Programar el día anterior: no aparece selector de calendario. Ocultar el calendario de la principal oculta también su subtarea. Cambiar el calendario de la principal mueve ambas sin cambiar horas ni marcas. Comprobar un día situado en el borde de semana o mes.
   Con una principal en Inbox, programar una subtarea eligiendo calendario; después agendar la principal en otro calendario y comprobar que la subtarea lo adopta.
7. Cambiar frecuencia de la principal: las nuevas repeticiones mantienen el horario de sus subtareas. Borrar toda la serie retira también sus subtareas programadas.
8. Arrastrar una Bañarme: solo cambia esa instancia. Las demás mantienen su regla.

La entrega inicial validó tipos y compilación. La [revisión funcional posterior](RESULTADOS_SUBTAREAS_PREPARACIONES.md) comprueba los tres alcances, renombradas, eliminadas, completadas, calendario heredado y cambios desde Inbox con servicios reales en un esquema aislado; también incluye un recorrido puntual en navegador.
