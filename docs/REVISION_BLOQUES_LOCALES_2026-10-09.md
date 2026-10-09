# Revisión de los últimos bloques locales — 9 de octubre de 2026

## Resultado

No se reprodujeron fallos de la aplicación en los escenarios cubiertos. Se registraron **139 comprobaciones correctas**, incluidas comprobaciones de aislamiento repetidas entre ejecuciones. También pasaron las comprobaciones de tipos de la aplicación y del núcleo.

Esta revisión cubre el comportamiento de datos, persistencia y sincronización de los bloques recientes. No constituye una aprobación visual ni una prueba de la versión publicada en iPhone.

Se respetó el alcance autorizado:

- Datos nuevos en esquemas PostgreSQL temporales, usando las migraciones y los servicios reales.
- Chromium aislado, IndexedDB, Web Locks y service worker reales para las comprobaciones locales.
- Ninguna rutina, receta ni existencia de la cuenta habitual fue modificada.
- Todos los esquemas temporales de estas ejecuciones se eliminaron.
- Sin cambios en funciones de la aplicación ni en PROJECT.md durante esta revisión. Solo se añadieron el banco de pruebas y los informes, y se actualizó el resultado del verificador existente.
- Sin commit, push ni despliegue en Vercel.

## Evidencia

| Grupo | Comprobaciones correctas | Resultado detallado |
| --- | ---: | --- |
| Subtareas recurrentes, calendario heredado y preparaciones previas en los servicios | 57 | `reconstruction/core/subtasks-preparations-verification.json` |
| Recurrencias locales, borrados, contenido, horarios, marcas, conflictos y separación hacia Inbox | 55 | `docs/revision-bloques-locales-2026-10-09.json` |
| Respuesta de envío ilegible y reintento del mismo lote | 6 | `docs/revision-envio-local-2026-10-09.json` |
| Cocina local: compras, preparaciones, consumo, sobras y conflicto de existencias | 21 | `docs/revision-cocina-local-2026-10-09.json` |

**Nota sobre el banco de pruebas:** el informe de recurrencias conserva un escenario fallido por una suposición incorrecta del simulador: al cortar el socket después del commit, Chrome pudo reintentar la petición y recibir su confirmación, cuando el simulador esperaba un rechazo. Se repitió ese escenario devolviendo una confirmación ilegible después del commit. Las cuatro comprobaciones funcionales de esa repetición pasaron; las otras dos comprueban el aislamiento. No se cambió código de la aplicación para resolverlo. Los intentos preliminares también requirieron preparar la caché offline y ajustar los comandos de prueba al contrato real; no se consideran fallos de MiAgenda.

## Qué se comprobó

### 1. Subtareas y calendarios

- Programar, cambiar y quitar horarios con los tres alcances en el motor conectado; persistencia y envío de horarios por alcance en la copia local.
- Reconocer subtareas renombradas por su identidad, omitir las eliminadas y conservar horarios de las completadas al aplicar cambios de horario por alcance.
- Mantener la diferencia de días entre la subtarea y su principal, incluso para una principal movida y al cruzar un límite de mes.
- Heredar el calendario de la principal, incluidas subtareas completadas.
- Agendar una principal de Inbox sin perder el horario ni la marca de su subtarea.
- Volver a Inbox y permitir elegir calendario de la subtarea cuando su principal ya no tiene uno.

### 2. Contenido, marcas y borrado de series

- Cambiar nombres y agregar subtareas por alcance sin materializar todas las fechas futuras.
- Reabrir las principales completadas al agregarles subtareas pendientes, conservando las demás marcas.
- Completar/deshacer por clave estable con marcas diferentes entre instancias.
- Completar/deshacer una principal y sus hijos por alcance.
- Borrar una instancia, las siguientes o toda la serie, incluyendo excepciones movidas.
- Usar la fecha original para el alcance de siguientes, aunque una excepción se haya movido hacia atrás.
- Deshacer borrados sin enviar, cerrar/reabrir sin internet y confirmar que lo borrado no reaparece al enviar.
- Rechazar un lote que intenta modificar la serie de otro propietario.

### 3. Persistencia, envío y conflictos

- Conservar contenido, horarios, marcas y cola en IndexedDB tras recargar sin conexión.
- Reconectar sin enviar automáticamente; enviar al pulsar Actualizar.
- Conservar los identificadores de hijos antes y después de confirmar un alta por alcance.
- Conservar un lote de resultado incierto e impedir descartarlo mientras falta confirmación.
- Reintentar exactamente el mismo payload sin aplicar el cambio dos veces.
- Detectar cambios remotos de una serie fuera de la ventana descargada.
- Aplicar la elección local a esas fechas lejanas o cancelar la operación conservando el servidor.
- Cancelar también las ediciones dependientes cuando se cancela un alta de subtareas en conflicto.
- Limitar al presente las marcas enviadas con el reloj del dispositivo adelantado.

### 4. Dejar de repetir y pasar a Inbox

- Revisar previamente sin modificar la serie.
- Pasar la elegida a Inbox sin cambiar su identidad y conservando sus hijos.
- Mantener horarios y marcas propios de las subtareas.
- Conservar las instancias pasadas y completadas.
- Probar ambas decisiones para futuras modificadas: conservarlas independientes o retirarlas.
- Mantener la separación al recargar sin internet y al enviar; no generar nuevas pendientes después del corte.

### 5. Preparaciones previas y Cocina

- Crear tramos previos desde la definición de la receta, incluso empezando por su primer paso.
- Programarlos cinco minutos sin duplicar casillas y heredando Cocina.
- Completar los tramos en orden; rechazar una reversión si hay un tramo posterior realizado.
- No consumir inventario ni completar la comida al completar un tramo previo.
- Pedir selección de opcionales al finalizar desde el bloque y conservar solo los seleccionados.
- Completar solo obligatorios mediante los pasos, sin asumir opcionales no marcados.
- Consumir una sola vez; reintentar sin duplicar el consumo.
- Conservar los horarios de preparaciones ya realizadas al mover una comida.
- Recalcular los datos usados por Agenda, Planificar, Alacena y Compras.

### 6. Cocina sin conexión

- Calcular Compras con las cantidades corregidas del plan y solo con Cocinar activo.
- Mostrar ingredientes por disponibilidad sin inventar gramos y marcarlos disponibles al comprarlos.
- Comprar cantidades elegidas, consumir exactamente esas cantidades planificadas y devolverlas al deshacer.
- Usar sobras reales en una segunda comida sin otro descuento de ingredientes.
- Mostrar el motivo al intentar deshacer el origen de sobras todavía usadas; conservar marcas y existencias tras el rechazo.
- Deshacer una compra todavía sin enviar y confirmar correctamente su referencia al sincronizar.
- Crear ingredientes y recetas sin conexión; editar el recetario sin alterar la versión congelada ni las cantidades del plan.
- Conservar la copia completa de Cocina al cerrar/reabrir sin internet.
- Detectar una corrección remota de existencias sin sobrescribirla. Las tareas normales pueden confirmarse antes de que se detenga Cocina; elegir Cocina del servidor no pierde esa tarea confirmada.

## Límites y pendientes de revisión

- No se probaron Safari ni un iPhone físico en esta ejecución. IndexedDB real en Chromium no demuestra por sí solo el comportamiento de almacenamiento, suspensión o recuperación de iOS.
- No se montaron los componentes visuales completos de React. Las lecturas y escrituras reales del cliente se ejecutaron en un banco aislado; la coherencia entre pantallas se comprobó mediante sus modelos de datos.
- Las rutas HTTP del banco delegan en servicios reales, pero no prueban los handlers de Next, Google OAuth, cookies, rate limits ni la configuración de producción.
- No se repitieron la revisión integral antigua de toda la app, la retención de cinco días, copias de semanas, migración de una instalación antigua de IndexedDB ni pruebas de carga. Este bloque revisa los cambios recientes indicados arriba.
- Algunas instrucciones anteriores en `docs/CAMBIOS_LOCALES.md` aún dicen que solo se comprobaron tipos: este informe añade la evidencia funcional automatizada. Su recorrido manual en iPhone sigue pendiente.

## Comprobación manual breve posterior

Cuando se decida publicar, hacer primero una prueba local de la interfaz y después repetirla en Safari/iPhone con series y recetas nuevas:

1. Actualizar. Preparar una serie con tres subtareas; renombrar una instancia, quitar una subtarea en otra y completar una tercera.
2. Sin conexión, cambiar nombre y horario para siguientes, agregar una subtarea a toda la serie y aplicar marcas por alcance. Cerrar/reabrir: comprobar tarjetas, casillas, horarios y contador.
3. Borrar toda una serie de prueba, deshacer el borrado y repetirlo. Reconectar: nada se envía hasta Actualizar; después no reaparecen excepciones.
4. Probar Dejar de repetir con una futura modificada, conservándola en una serie y retirándola en otra. La elegida queda en Inbox y sus hijos programados permanecen en Agenda.
5. Preparar dos comidas: A cocina dos porciones y come una; B usa la restante. Sin conexión, comprar, completar un tramo previo y completar A con un opcional. Completar B e intentar deshacer A: debe explicar la dependencia. Deshacer B y A devuelve el consumo.
6. Actualizar y comprobar los mismos resultados desde otro dispositivo. Revisar también legibilidad de los avisos, cierres de paneles, teclado táctil y recuperación tras suspender la app.

No se publica automáticamente al terminar esta revisión.
