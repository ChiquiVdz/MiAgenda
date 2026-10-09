# Cambios locales y envío manual

Reglas aprobadas el 8 de octubre de 2026. Complementa `PROJECT.md` y sustituye los límites de la etapa inicial de consulta.

## Qué funciona localmente

Estas acciones se guardan en IndexedDB incluso con internet. Navegar, reconectar o cerrar la pantalla no las envía.

| Acción | Sin conexión |
| --- | --- |
| Crear, editar, completar/deshacer tareas normales y sus subtareas | Sí, solo la instancia elegida |
| Agendar, mover y quitar horario de tareas/subtareas | Sí, con calendarios descargados |
| Borrar una principal normal y sus hijos | Sí; se puede deshacer antes de enviar |
| Ajustar cantidades o Tengo/Se terminó en Alacena | Sí, manteniendo el modo de seguimiento |
| Crear ingredientes personalizados u ocultar sugerencias | Sí; se comprueban nombres similares |
| Crear, editar o retirar recetas | Sí; los planes mantienen su versión congelada |
| Agregar/quitar artículos libres y cambiar cantidades de Compras | Sí |
| Comprar individualmente/en conjunto y deshacer compras | Sí, con efecto local en Alacena |
| Completar/deshacer comidas y pasos/preparaciones previas | Sí, dentro de la ventana local de Planificar |
| Crear/editar/copiar/borrar planes de comidas, modificar sus horarios o filas | Con conexión directa |
| Borrar una principal recurrente: solo esta, siguientes o toda la serie | Local; permite deshacer antes de enviar |
| Nombre de principal, agregar/renombrar/eliminar subtareas recurrentes con tres alcances | Local; se envía al pulsar Actualizar |
| Horarios de principales y programar/cambiar/quitar horarios de subtareas por alcance | Local; se envía al pulsar Actualizar |
| Completar/deshacer tareas y subtareas recurrentes por alcance | Local; se envía al pulsar Actualizar |
| Dejar de repetir y pasar a Inbox | Revisión conectada previa; confirmación local hasta Actualizar |
| Conservar/Destacar, calendarios y frecuencia | Con conexión directa |
| Editar/retirar/fusionar un ingrediente o cambiar cantidad ↔ disponibilidad | Con conexión directa |
| Revertir efectos antiguos con ingredientes ya retirados/sustituidos | Con conexión directa |

Las operaciones conectadas requieren enviar antes los cambios pendientes. La ventana local inicial comprende seis semanas: la anterior y cinco desde la actual. Las consultas fuera de ella siguen ofreciendo descarga explícita; no amplían automáticamente las operaciones contables offline.

## Un solo botón

**Actualizar** envía primero las colas con recibos idempotentes. Si todas se confirman, solicita un lote de retención y descarga la copia completa reciente. No envía mientras haya un conflicto por resolver. El contador cuenta operaciones, no objetos distintos.

**Borrados sin enviar** permite deshacer una eliminación completa antes de enviarla. Un envío de resultado incierto debe reintentarse antes de deshacer o descartar sus operaciones. Borrar una principal recurrente admite los tres alcances; siguientes usa su fecha original y toda la serie incluye excepciones modificadas, hijos y horarios. La copia oculta lo descargado; el servidor aplica también las fechas no descargadas al pulsar Actualizar. El contenido y las subtareas por alcance también están implementados, como se describe abajo.

Antes del borrado de serie se compara una huella de su definición y todas sus instancias/hijos materializados, incluso fuera de la ventana descargada. Si cambió, se ofrece **Borrar también la versión actual** o **Cancelar mi borrado y conservar servidor**. Resolver requiere conexión, conserva el límite original y no envía automáticamente. Los borrados de serie se envían en lotes individuales idempotentes; los cambios propios enviados antes actualizan la huella solo si la anterior coincidía con el servidor.

Los cambios de contenido usan esa misma protección y lotes individuales. Subtareas se buscan por clave estable, no por nombre; una ausente no se recrea al renombrar o eliminar. Agregar crea hijos pendientes y reabre la principal. Las identidades de nuevos hijos de otras ocurrencias se calculan con Web Crypto siguiendo el esquema existente del servidor y quedan persistidas en el comando; la definición del servidor cubre futuras fechas sin materializarlas todas. Ante conflicto se elige **Aplicar mi cambio a la versión actual** o **Cancelar este cambio y conservar servidor**. Cancelar una alta cancela sus modificaciones dependientes; no toca tareas ajenas. Una serie retirada no se recrea al resolver. Cambios demasiado grandes se rechazan antes de guardar y conservan los pendientes anteriores.

**Info → Descartar cambios locales** solicita confirmación y protege los envíos sin confirmar. Cerrar sesión o cambiar de cuenta nunca elimina una cola pendiente silenciosamente.

## Cocina e inventario

La copia contiene una proyección contable acotada: existencias, entradas/recibos de compras, consumos activos, tandas/uso de porciones y la correspondencia entre pasos y comidas. No contiene credenciales. Es provisional; PostgreSQL sigue siendo la autoridad al enviar.

- Compras usa todos los planes pendientes con Cocinar activo, independientemente de la semana visible. Usa las cantidades elegidas y distingue disponibilidad de cantidad.
- Comprar suma exactamente la cantidad registrada. Una compra de disponibilidad marca Tengo sin inventar gramos/piezas. Deshacer respeta el stock que queda y la cadena de compras de disponibilidad.
- Completar consume una sola vez, usando los opcionales seleccionados. Las cantidades se agregan y redondean a precisión de stock después de sumarlas; se conservan piezas ajustadas/fracciones y planes antiguos proporcionales.
- Los pasos previos conservan el orden de sus tramos, no completan por sí solos la comida ni descuentan ingredientes. Los opcionales se preguntan al finalizar el bloque, como en el flujo conectado.
- Una comida cocinada offline genera sus tandas locales. Otra puede comer esas sobras; ambas operaciones se envían en su orden. Las sobras previstas de una comida todavía pendiente nunca se convierten en porciones reales.
- Deshacer devuelve el consumo registrado y revierte usos/tandas. Si otra comida usó las sobras, primero hay que deshacerla. Deshacer conserva los pasos de tramos previos conforme a las reglas existentes.
- Agenda, Planificar, Alacena y Compras se recalculan en la misma copia; navegar entre apartados no hace consultas automáticas para estas acciones.

## Conflictos

Tareas normales verifican revisiones de la principal y sus hijos. Se elige conservar cambios locales o servidor. Si se pretendía borrar una principal modificada remotamente, se ofrece confirmar el borrado o conservarla; no se recupera como una tarea nueva accidentalmente.

Cocina usa una comprobación conservadora de revisión global antes de aplicar un lote. Si otro dispositivo cambió datos desde la base de la cola, se detiene: las correcciones manuales nunca pisan existencias desconocidas silenciosamente. El aviso ofrece conservar y volver a validar la cola, o usar Cocina del servidor **descartando expresamente todos los cambios de Cocina aún no enviados**, sin descartar tareas normales. Si un ingrediente creado localmente coincide con otro existente y compatible, permite elegir ese ingrediente y cambiar las referencias de la cola. No unifica automáticamente nombres parecidos ni unidades distintas.

Si conservar encuentra stock insuficiente, porciones reales insuficientes, ingredientes incompatibles o dependencias, no se aplica el lote. La cola sigue guardada. Este bloque no incorpora un editor de operaciones individuales en conflicto; se puede revisar la elección o descartar expresamente la cola de Cocina y repetir los cambios necesarios.

Si la sesión caduca, hay que entrar con la cuenta original. Desconexión o error de respuesta no equivale a perder cambios ni a confirmar el envío.

## Garantías y límites

IndexedDB versión 7 migra sin borrar la copia y las tareas pendientes anteriores; impide que clientes antiguos sobrescriban la cola nueva. Las copias anteriores deben actualizarse para descargar las huellas de serie antes de permitir su borrado por alcance. Web Locks coordina pestañas. Persistimos snapshot base, proyección, ambas colas, conflicto y payload inmutable antes de enviar. No se purga el almacenamiento local por cumplir cinco días; la retención se resuelve en el servidor después de sincronizar.

Tareas: hasta 500 comandos; prefijos de 30. Cocina: hasta 200 comandos; prefijos de 20. La cola de Cocina está limitada además a 4 MB y los cambios individuales a 55 KB; se avisa antes de guardar un cambio que exceda el límite. Los payloads tienen menos de 60 KB y se reducen cuando sea necesario. Cada lote de Cocina se confirma en una sola transacción usando los servicios existentes; un fallo no deja compras/consumos parciales de ese lote. Lotes anteriores ya confirmados se conservan. Recibos por propietario evitan duplicados, incluso al comprar y deshacer antes del primer envío; los IDs provisionales se sustituyen por los confirmados.

Los recibos del servidor conservan confirmación/referencias, no una copia completa permanente de Cocina. La proyección de reversión tiene límites de 5.000 registros por conjunto y el snapshot completo, 15 MB; excederlos informa y conserva la copia anterior. No hay tablas ni dependencias nuevas. Finalizar repetición añade una migración de la validación de relaciones para separar explícitamente una actividad sin cambiar sus IDs. El navegador puede desalojar datos por falta de espacio: la copia no sustituye al respaldo de PostgreSQL, y los cambios sin enviar solo existen en ese dispositivo.

La fecha de completar una comida offline se conserva, limitada al presente del servidor si el reloj está adelantado. Las fechas de registro de recibos de compras se confirman al enviar.

## Revisar los cambios de contenido recurrente en PC local

Este bloque permanece solo en local. GitHub, Vercel y la versión instalada en iPhone no reciben estos cambios todavía.

1. Cerrar pestañas antiguas, abrir la versión local y pulsar **Actualizar** para descargar las huellas de serie. Preparar una serie diaria con dos subtareas y varias fechas.
2. Cambiar el nombre de una subtarea solo en una instancia; eliminar esa misma subtarea en otra. Completar una tercera instancia y programar otra subtarea, para comprobar que sus marcas y horarios se conservan.
3. Sin conexión, cambiar el nombre de la principal con **Esta y las siguientes**. Deben cambiar la elegida y las posteriores según su fecha original; las anteriores quedan iguales.
4. Agregar dos subtareas con **Toda la serie**. Deben aparecer pendientes y reabrir las principales completadas. Renombrar una subtarea existente para toda la serie debe encontrar también la instancia renombrada y omitir aquella donde fue eliminada.
5. Eliminar una subtarea con **Esta y las siguientes**: desaparece también su horario en ese alcance. Cerrar y reabrir debe conservar los cambios y el contador pendiente.
6. Reconectar no debe enviar nada. Pulsar **Actualizar**, esperar contador cero y comprobar una fecha futura recién descargada: debe reflejar la estructura nueva sin duplicados.
7. Para conflictos, dejar un cambio local pendiente y modificar/enviar la misma serie desde otro navegador. Al actualizar deben ofrecerse **Aplicar mi cambio a la versión actual** y **Cancelar este cambio y conservar servidor**. Probar cada elección con una serie distinta. Cancelar una alta también cancela las ediciones pendientes que dependían de esas subtareas nuevas.

Se comprobaron los tipos de aplicación y núcleo. Este recorrido funcional queda pendiente de revisión; la frecuencia continúa requiriendo conexión.

## Revisar horarios recurrentes en PC local

Este bloque también permanece solo en local. IndexedDB versión 7 conserva las colas anteriores y evita que una pestaña antigua sobrescriba los nuevos comandos de horario.

1. Preparar una serie diaria con dos subtareas. Mover una principal a otra fecha, renombrar una subtarea en una instancia, eliminarla en otra y completar esa subtarea en una tercera. Pulsar **Actualizar** y cerrar pestañas antiguas.
2. Sin conexión, cambiar hora/duración de la principal usando **Esta y las siguientes**. Deben conservar sus fechas actuales, incluyendo la movida; el alcance se decide por su fecha original. Las anteriores no cambian.
3. Programar una subtarea para el día anterior con **Toda la serie**. Debe conservar esa diferencia de días y heredar el calendario de cada principal. La renombrada se identifica por clave; la eliminada no reaparece y la completada conserva su horario.
4. Quitar el horario de esa subtarea con **Esta y las siguientes**. Solo las pendientes del alcance pierden el horario, Conservar y Destacar; sus casillas y marcas permanecen. Repetir con **Solo esta** usando otra instancia.
5. Cambiar nombre y horario juntos desde Editar. Cerrar/reabrir y comprobar que se conserva el resultado local. Reconectar no debe enviar automáticamente.
6. Pulsar **Actualizar** y comprobar otra fecha futura recién descargada. Los horarios deben coincidir sin duplicar actividades. Para un conflicto, modificar la serie desde otro navegador antes de enviar y probar aplicar sobre la versión actual o cancelar, con series distintas.

Para terminar la serie y quitar la fecha existe el flujo explícito Dejar de repetir y pasar a Inbox, con revisión previa. Estos escenarios tienen comprobaciones funcionales automatizadas; ver REVISION_BLOQUES_LOCALES_2026-10-09.md. La revisión física en iPhone sigue pendiente.

## Revisar finalizar repetición y completado por alcance en PC local

Ambos bloques están preparados para la publicación autorizada del 9 de octubre. La migración `20261009000100_detach_recurrence` permite quitar explícitamente la relación con la serie manteniendo los IDs; no modifica tareas existentes. La cola usa IndexedDB versión 7.

### Completar/deshacer

1. Actualizar la copia y preparar una serie con tres subtareas. Renombrar una de ellas en una instancia, eliminarla en otra y dejar distintas marcas y horarios por fecha.
2. Sin conexión, desde el flujo de alcance de Agenda completar una subtarea con **Esta y las siguientes**. Solo cambia esa casilla por identidad, incluyendo la renombrada; donde fue eliminada no aparece de nuevo. Las anteriores y demás casillas mantienen sus marcas.
3. Desmarcarla con **Toda la serie**. Completar luego una principal con **Esta y las siguientes**: sus hijos también se completan. Deshacer una principal para toda la serie desmarca sus hijos; horarios y nombres no cambian.
4. Cerrar/reabrir y comprobar pendientes y marcas. Reconectar no envía. Pulsar **Actualizar**, comprobar contador cero y una fecha futura recién descargada.
5. Para conflictos, dejar una operación sin enviar, modificar/enviar la serie desde otro navegador y probar aplicar a la versión actual o cancelar en series diferentes.

### Dejar de repetir y pasar a Inbox

1. Preparar una serie de prueba con una pasada, otra completada, una futura modificada y una subtarea con horario propio. Pulsar **Actualizar** antes de revisar.
2. Abrir Editar en la principal elegida y pulsar **Dejar de repetir y pasar a Inbox…**. La revisión consulta todas sus excepciones, también fuera de la descarga. Mostrar las futuras modificadas; conservarlas independientes está seleccionado por defecto. Los cambios sin guardar en el editor no forman parte de esta acción.
3. Confirmar: la elegida debe estar en Inbox, sin recurrencia, conservando nombre, hijos y marcas. Su subtarea programada permanece en Agenda. Las futuras modificadas conservadas quedan independientes con sus horarios; las futuras sin cambios desaparecen. Las pasadas/completadas y el progreso previo permanecen.
4. Cerrar/reabrir antes de enviar y comprobar persistencia. Pulsar **Actualizar** y comprobar Inbox, Agenda y una fecha futura recién descargada: no reaparecen repeticiones pendientes nuevas. Guardar algún cambio en la tarea independiente no modifica la serie antigua.
5. Con otra serie, desactivar conservar modificadas y confirmar: esas futuras pendientes y sus hijos también se retiran; las pasadas/completadas se mantienen. Cancelar la revisión no cambia nada.

La revisión inicial de finalizar repetición requiere internet y copia al día. Después de revisarla, la confirmación se guarda y persiste localmente. Si hay una subtarea descargada cuya principal futura está fuera de la copia, se pide descargar esa fecha antes de separar la serie, para no proyectar relaciones incompletas. Los servicios y la persistencia de este recorrido se comprobaron automáticamente; ver el informe del 9 de octubre. Safari físico sigue pendiente.

## Revisar en iPhone

El bloque de borrado recurrente del 2026-10-09 está incluido en la publicación autorizada de esta entrega. Para revisarlo en PC local: actualizar la copia, preparar una serie de prueba con subtareas y una instancia movida/renombrada, desconectarse y probar los tres alcances por separado. Siguientes debe respetar la fecha original; toda la serie debe ocultar también la excepción. Deshacer antes del envío restaura todo. Cerrar/reabrir conserva el borrado pendiente. Al reconectar no se envía hasta Actualizar; después también desaparecen las instancias fuera de la descarga. Para conflicto, modificar y enviar una instancia desde otro navegador antes de enviar el borrado; comprobar ambas decisiones usando series de prueba distintas. La resolución explícita descarga una copia nueva y retira las consultas de fechas adicionales, que pueden volver a descargarse.

1. Con internet, cerrar/reabrir la versión nueva y pulsar **Actualizar**. Esperar que Info indique pantallas listas. Si estaba abierta una versión anterior, cerrar también otras pestañas antiguas.
2. Preparar conectadas dos comidas de una receta: la primera cocina 2 porciones y come 1; la segunda no cocina y come 1. Asegurar stock para la primera, dejando faltantes de otro ingrediente para probar Compras. Incluir un opcional y un tramo previo si se quieren comprobar.
3. Modo avión y Wi-Fi apagado: crear una tarea con hijos, borrarla y usar **Borrados sin enviar → Deshacer borrado**. Borrarla otra vez si se quiere comprobar el envío.
4. En Alacena cambiar una cantidad; crear un ingrediente y una receta. En Compras registrar una compra individual, comprobar Alacena y deshacerla. Comprar lo necesario para cocinar.
5. Completar el tramo previo: no debe consumir. Completar la primera comida y seleccionar opcionales: debe consumir una vez. Completar la segunda: usa las sobras sin otro descuento. Deshacer la primera debe pedir primero deshacer la segunda. Deshacer segunda y primera devuelve ingredientes.
6. Cerrar y volver a abrir sin internet: tarjetas, stock, recetas, compras, marcas y contador deben mantenerse. Reconectar por sí solo no debe enviar nada.
7. Pulsar **Actualizar**. El contador debe llegar a cero. En PC pulsar Actualizar y comprobar los mismos datos y ausencia de compras duplicadas.
8. Conflicto opcional: en iPhone dejar una corrección de Alacena sin enviar; modificar desde PC y actualizar allí. Al actualizar iPhone debe pedir decisión y conservar la cola.

Compilación y comprobación de tipos de aplicación/núcleo correctas. La revisión reciente registró 139 comprobaciones correctas de servicios y cliente local real con datos aislados; ver REVISION_BLOQUES_LOCALES_2026-10-09.md. Estos recorridos en Safari y la pérdida real de conectividad en iPhone quedan para revisión.
