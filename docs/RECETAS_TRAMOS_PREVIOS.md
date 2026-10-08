# Tramos previos de recetas

Implementación: 2026-10-08. Google solo autentica.

## Funcionamiento

Al añadir o editar un paso, «Hacer este paso antes» permite indicar horas de anticipación sin guardar primero la receta. El texto del paso identifica el tramo. Cada límite incluye los pasos desde el límite anterior: C reúne A–B–C y E reúne D–E.

Planificar ofrece cada tramo sin seleccionar, muestra los pasos incluidos y permite ajustar fecha, hora y duración (5 minutos por defecto para nuevas preparaciones, también al copiar semanas). El encabezado muestra la receta; debajo aparece el paso previo. «Incluye» muestra el ingrediente de cada paso o su instrucción si no tiene ingrediente. Aceptarlo programa el propio paso como hijo de la comida; no crea una segunda casilla. Su reloj permite cambiar o quitar horario manteniendo el paso.

Completar C marca sus obligatorios y el propio C; los demás opcionales conservan sus marcas. E exige completar los obligatorios anteriores. Ningún tramo completa la comida ni descuenta inventario. Los opcionales cuantificados se preguntan al completar la comida, también cuando se pulsa el último obligatorio posterior a los tramos. Disponibilidad y pasos sin ingrediente siguen sin pregunta de consumo.

Deshacer un tramo exige corregir sus pasos posteriores. Deshacer una comida devuelve exactamente sus ingredientes, conserva los previos y respeta dependencias de sobras. Para corregir previos de una comida completada hay que deshacer primero la comida.

Las recetas/versiones anteriores conservan los recordatorios independientes. Para adoptar los tramos, activar la casilla del paso y guardar una versión nueva; actualizar expresamente un plan pendiente o crear otro. No se reinterpretan comidas anteriores.

## Revisión manual

1. Crear una receta con porciones, tiempo e ingrediente; agregar A, B, C, D, E y F. Marcar C y E como previos, C con más anticipación que E. Guardar.
2. Planificar cocinando. Ver C con A–B–C y E con D–E, inicialmente sin seleccionar. Aceptar ambos y guardar.
3. En Agenda completar C: A–B–C obligatorios quedan hechos; la comida sigue pendiente y Alacena no cambia.
4. Completar E: se marcan D–E sin descuento. Si se intenta E antes de C debe explicarse qué falta.
5. Completar F o el círculo de la comida: elegir opcionales cuantificados y confirmar. Alacena se descuenta una sola vez.
6. Deshacer la comida: vuelve exactamente el consumo; previos realizados permanecen marcados. Deshacer E antes de C para corregirlos.
7. Mover la comida: previos completados mantienen su horario; pendientes se reajustan solo al elegirlo. Quitar horario conserva la casilla.
8. Copiar una semana: copias pendientes, previos ofrecidos para las nuevas fechas, sin trasladar marcas ni consumos.

La entrega inicial se validó por compilación y migración. La [revisión funcional posterior](RESULTADOS_SUBTAREAS_PREPARACIONES.md) incluye 57 comprobaciones de subtareas, preparaciones y cruces, además de guardar una preparación de cinco minutos desde Agenda. El reloj de preparaciones permite editar su duración en minutos sin exigir un final múltiplo de 15.
