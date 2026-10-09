# Inbox y tareas con envío manual

Bloques aprobados el 8 de octubre de 2026. Complementa la copia de consulta; estas reglas sustituyen su limitación histórica de solo lectura.

## Uso

Las tareas normales se guardan en el dispositivo incluso si tiene internet. No se envían al salir de un campo, navegar, reconectar ni cerrar la pantalla.

| Acción | Local, sin consultar servidor |
| --- | --- |
| Crear tarea sin horario desde Inbox o Anotar | Sí |
| Editar nombre/descripción de tarea normal | Sí |
| Agregar, renombrar o eliminar subtareas normales | Sí |
| Completar/deshacer principal o subtareas normales | Sí, solo esa instancia |
| Crear tarea programada, agendar/cambiar/quitar horarios, arrastrar y ajustar duración | Sí, tareas normales y subtareas, solo esa instancia |
| Conservar/Destacar o crear calendario | Requiere conexión |
| Borrar una principal o afectar varias repeticiones | Requiere conexión |
| Modificar Cocina, completar comidas/preparaciones o comprar | Requiere conexión |

Solo se ofrecen calendarios descargados. Programar o mover no crea nuevas repeticiones. Las fechas fuera de los intervalos descargados conservan el aviso de descarga explícita; no se presupone tener todos sus eventos. Quitar horario mantiene la actividad, hijos y progreso, limpia Conservar/Destacar y no desprograma hijos.

La principal se completa cuando se completan sus hijos, y agregar uno pendiente la reabre. Completar/deshacer la principal modifica sus hijos conforme al núcleo existente. No se altera inventario localmente.

- **Actualizar (único botón):** envía primero; si todo se confirma, pide la limpieza al servidor y descarga la copia nueva.
- **Sin enviar:** identifica las tareas afectadas; la barra cuenta comandos pendientes, no tareas distintas.
- **Info → Descartar cambios locales:** pide confirmación. Si un envío quedó sin confirmar, primero debe reintentarse para saber qué recibió el servidor.

Las acciones que aún necesitan servidor se bloquean si hay pendientes. Primero sincronizar. No interpretar el estado Sin enviar como un respaldo en Neon.

## Conflictos y retención

Antes de enviar, el servidor compara principal e hijos con las revisiones descargadas. Si alguien cambió la misma tarea, el lote no se aplica: se ofrece conservar los cambios locales o usar la versión del servidor. Conservar cambios reemplaza texto y marcas de ese conjunto y los horarios modificados localmente; los horarios sin cambios locales mantienen la versión del servidor. Si un hijo desapareció, se recupera como nuevo hijo y solo recupera su horario si fue modificado localmente. Si un calendario dejó de existir, se pide otro calendario descargado antes de conservar los cambios. Si la principal fue eliminada o ya no pertenece a su recurrencia, se ofrece recuperar como nueva tarea en Inbox con sus hijos, sin horarios, o descartar sus cambios. Una tarea nueva cuyo calendario desapareció puede conservar su horario eligiendo otro.

Si caduca la sesión o la cuenta es diferente, se conservan los pendientes para entrar con la cuenta original. No se borran por una respuesta de error. Cerrar sesión con pendientes requiere sincronizarlos o descartarlos expresamente.

La fecha de completar es la del dispositivo al realizar la acción; un reloj adelantado se limita al presente del servidor. No se purga nada en IndexedDB. Después del envío, la retención de cinco días la aplica el servidor junto con las protecciones de subtareas y Conservar. Una tarea completada hace más de cinco días puede retirarse al actualizar después de sincronizar.

## Implementación y límites

IndexedDB conserva snapshot base, proyección visible, cola y lote pendiente de confirmar. Web Locks coordina escrituras entre pestañas; se necesita un navegador que disponga de esa API. No se guardan credenciales. La estructura de IndexedDB pasa a versión 2 sin borrar la copia de formato 1 existente: impide que una pantalla antigua de solo consulta sobrescriba la cola. Después de publicar, cerrar y volver a abrir las pantallas de la versión anterior.

Cada lote inmutable tiene ID y recibo por propietario, se persiste antes de usar la red y se confirma en una transacción. El servidor valida sesión, origen, propietario esperado, acciones permitidas y revisiones. Un reintento no duplica altas ni efectos. Se envían prefijos de hasta 30 comandos y menos de 60 KB; la cola admite hasta 500 comandos, con aviso antes de superarlos. No se compactan recibos ni se añaden tablas o migraciones.

Falta de espacio o borrado de datos del sitio puede eliminar cambios que nunca se enviaron. No sustituye el respaldo de la base de datos. Se conserva la última copia descargada al fallar una actualización.

## Revisión manual del bloque

1. Abrir la versión nueva con internet y esperar que Info indique pantallas listas para abrir sin conexión.
2. Crear «Prueba local» en Inbox, agregar dos subtareas y renombrar una. Ver Sin enviar y el contador. Sin sincronizar, cerrar y volver a abrir: deben conservarse.
3. Desactivar Wi-Fi y datos móviles. Completar un hijo y después el otro: se completa la principal. Deshacer la principal desmarca los dos. Agregar otro hijo pendiente debe mantenerla pendiente.
4. Ir a Agenda y usar Anotar: guarda en Inbox sin salir de Agenda. Cambiar entre apartados mantiene las modificaciones.
5. Reconectar: los pendientes deben seguir sin enviarse. Pulsar Actualizar; el contador debe llegar a cero. En otro dispositivo, Actualizar debe mostrar lo enviado.
6. Con una tarea ya sincronizada, modificar su nombre en un dispositivo sin enviar y hacer otro cambio en otro dispositivo y sincronizarlo. En el primero, Actualizar debe ofrecer ambas versiones. Elegir servidor descarta solo los cambios de esa tarea; elegir mis cambios requiere otro Actualizar.
7. Repetir borrando la principal desde el dispositivo conectado antes de enviar la edición pendiente del otro: debe ofrecer Recuperar en Inbox o Descartar.
8. En una recurrencia, editar/marcar solo una instancia y sincronizar: las otras deben conservar sus estados. Programar una subtarea, cambiarle horario y quitarlo en «Solo esta» debe persistir localmente; siguientes/toda la serie siguen requiriendo conexión y sincronización previa.
9. Sin conexión, agendar una principal desde Inbox: desaparece de Inbox y se ve en Agenda en las fechas descargadas. Moverla y ajustar duración; cerrar y volver a abrir debe mantener el horario. Quitar horario la devuelve a Inbox con sus subtareas y marcas, y desactiva Conservar/Destacar.
10. Agendar un hijo cuando la principal esté en Inbox, después agendar la principal en otro calendario descargado: el hijo adopta ese calendario, conservando horas y marcas. Cambiar el calendario de la principal debe trasladar también los hijos completados. Quitar horario a la principal no quita el de sus hijos.
11. Reconectar sin sincronizar no debe enviar estos horarios. Actualizar y luego Actualizar en otro dispositivo debe reflejarlos. Si otra pantalla cambia el horario de la misma tarea, comprobar ambas elecciones del conflicto.
12. Intentar cerrar sesión con pendientes: debe conservarlos e indicar qué hacer. No borrar datos del sitio para probar: eso elimina los cambios sin enviar.

En herramientas de red, crear/editar/completar/agendar/mover/quitar horario con las acciones admitidas no debe enviar POST ni GET a la API. Al pulsar Actualizar se envían los pendientes a `/api/core/local/sync` y después se descarga la copia y se pide retención. La comprobación breve de entrada permanece. Las operaciones explícitas conectadas y la instalación de recursos sí usan red.

Compilación de producción y revisión de tipos de aplicación/núcleo correctas. No se han ejecutado pruebas funcionales de esta cola ni simulado pérdida real de red en iPhone en este bloque; no presentar compilación o tipos como esas pruebas. Los bloques están publicados; su revisión funcional en iPhone continúa.
