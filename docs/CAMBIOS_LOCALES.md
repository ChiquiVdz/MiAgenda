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
| Conservar/Destacar, calendarios, alcances de serie | Con conexión directa |
| Editar/retirar/fusionar un ingrediente o cambiar cantidad ↔ disponibilidad | Con conexión directa |
| Revertir efectos antiguos con ingredientes ya retirados/sustituidos | Con conexión directa |

Las operaciones conectadas requieren enviar antes los cambios pendientes. La ventana local inicial comprende seis semanas: la anterior y cinco desde la actual. Las consultas fuera de ella siguen ofreciendo descarga explícita; no amplían automáticamente las operaciones contables offline.

## Un solo botón

**Actualizar** envía primero las colas con recibos idempotentes. Si todas se confirman, solicita un lote de retención y descarga la copia completa reciente. No envía mientras haya un conflicto por resolver. El contador cuenta operaciones, no objetos distintos.

**Borrados sin enviar** permite deshacer una eliminación. Un envío de resultado incierto debe reintentarse antes de deshacer o descartar sus operaciones. Borrar una ocurrencia recurrente offline afecta únicamente a esa ocurrencia; toda la serie y siguientes permanecen conectadas.

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

IndexedDB versión 3 migra sin borrar la copia y las tareas pendientes anteriores; impide que clientes antiguos sobrescriban la cola nueva. Web Locks coordina pestañas. Persistimos snapshot base, proyección, ambas colas, conflicto y payload inmutable antes de enviar. No se purga el almacenamiento local por cumplir cinco días; la retención se resuelve en el servidor después de sincronizar.

Tareas: hasta 500 comandos; prefijos de 30. Cocina: hasta 200 comandos; prefijos de 20. La cola de Cocina está limitada además a 4 MB y los cambios individuales a 55 KB; se avisa antes de guardar un cambio que exceda el límite. Los payloads tienen menos de 60 KB y se reducen cuando sea necesario. Cada lote de Cocina se confirma en una sola transacción usando los servicios existentes; un fallo no deja compras/consumos parciales de ese lote. Lotes anteriores ya confirmados se conservan. Recibos por propietario evitan duplicados, incluso al comprar y deshacer antes del primer envío; los IDs provisionales se sustituyen por los confirmados.

Los recibos del servidor conservan confirmación/referencias, no una copia completa permanente de Cocina. La proyección de reversión tiene límites de 5.000 registros por conjunto y el snapshot completo, 15 MB; excederlos informa y conserva la copia anterior. No hay tablas, migraciones ni dependencias nuevas. El navegador puede desalojar datos por falta de espacio: la copia no sustituye al respaldo de PostgreSQL, y los cambios sin enviar solo existen en ese dispositivo.

La fecha de completar una comida offline se conserva, limitada al presente del servidor si el reloj está adelantado. Las fechas de registro de recibos de compras se confirman al enviar.

## Revisar en iPhone

1. Con internet, cerrar/reabrir la versión nueva y pulsar **Actualizar**. Esperar que Info indique pantallas listas. Si estaba abierta una versión anterior, cerrar también otras pestañas antiguas.
2. Preparar conectadas dos comidas de una receta: la primera cocina 2 porciones y come 1; la segunda no cocina y come 1. Asegurar stock para la primera, dejando faltantes de otro ingrediente para probar Compras. Incluir un opcional y un tramo previo si se quieren comprobar.
3. Modo avión y Wi-Fi apagado: crear una tarea con hijos, borrarla y usar **Borrados sin enviar → Deshacer borrado**. Borrarla otra vez si se quiere comprobar el envío.
4. En Alacena cambiar una cantidad; crear un ingrediente y una receta. En Compras registrar una compra individual, comprobar Alacena y deshacerla. Comprar lo necesario para cocinar.
5. Completar el tramo previo: no debe consumir. Completar la primera comida y seleccionar opcionales: debe consumir una vez. Completar la segunda: usa las sobras sin otro descuento. Deshacer la primera debe pedir primero deshacer la segunda. Deshacer segunda y primera devuelve ingredientes.
6. Cerrar y volver a abrir sin internet: tarjetas, stock, recetas, compras, marcas y contador deben mantenerse. Reconectar por sí solo no debe enviar nada.
7. Pulsar **Actualizar**. El contador debe llegar a cero. En PC pulsar Actualizar y comprobar los mismos datos y ausencia de compras duplicadas.
8. Conflicto opcional: en iPhone dejar una corrección de Alacena sin enviar; modificar desde PC y actualizar allí. Al actualizar iPhone debe pedir decisión y conservar la cola.

Compilación y comprobación de tipos de aplicación/núcleo correctas. No se ejecutaron pruebas funcionales ni modificaciones de datos privados para simular este bloque; estos recorridos y pérdida real de conectividad en iPhone quedan para revisión. Compilar no demuestra por sí solo los recorridos offline.
