# Plan de comprobación integral del cierre

Estado: revisión ejecutada el 7 de octubre de 2026. Consulta [resultados y límites](RESULTADOS_REVISION_INTEGRAL.md). El usuario autorizó su cuenta y sus datos de prueba. La [mejora general de rendimiento](RENDIMIENTO_GENERAL.md) ya se realizó después de consolidar. No modificar fechas de retención de registros ajenos a la prueba sin dejar evidencia de qué se tocó. Las casillas de abajo se mantienen como guía de revisión manual; no equivalen a cobertura automatizada de cada gesto o dispositivo.

Actualización del 2026-10-08: [cantidades y disponibilidad de Cocina](RESULTADOS_COCINA_CANTIDADES.md) tienen 45 comprobaciones aprobadas y revisión visual aceptada por el usuario. Este documento es una guía para futuras revisiones, no una lista de bloques que siga pendiente de ejecutar íntegramente. Los recorridos originales reflejan la interfaz de su fecha: el panel Sin existencias y el acceso visible a movimientos se retiraron después; las cantidades ahora pueden ajustarse por comida.

## Registro de resultados

Para cada caso: datos usados, acción, resultado esperado, resultado observado y corrección si falla. Revisar persistencia recargando y volver a los apartados relacionados. Distinguir inspección estática, prueba por API y prueba visual. Marcar aprobado solo con evidencia; no basta con que TypeScript compile.

## Recorrido manual, paso a paso

Utilizar nombres con «Revisión» para reconocer lo creado. Hacer la prueba de Cocina con ingredientes personales nuevos: así otros planes existentes no alteran las cantidades esperadas. Si se interrumpe, anotar dónde quedó y no comprar/completar otra vez por suponer que falló.

1. **Carga:** entrar y recorrer Inbox → Agenda → Alacena → Recetario → Planificar → Compras. Repetir la vuelta. La primera puede incluir compilación local; comparar especialmente la segunda. Revisar también escribir en búsquedas, desplegar pasos y abrir/cerrar cuadros.
2. **Inbox:** crear «Revisión actividad» y dos subtareas. Marcar una; completar principal; deshacer principal; agregar otra subtarea. Revisar que contenido y progreso persistan tras recargar.
3. **Horarios:** agendar una subtarea manteniendo principal en Inbox; debe aparecer en Agenda ligada a su principal. Quitar horario debe conservar su casilla. Agendar principal y comprobar que sale de Inbox.
4. **Agenda:** pasar por Día, Semana, Mes y Año; navegar anterior/siguiente y volver con Hoy. Filtrar calendarios. Mover/ajustar una tarea de prueba en Semana. Abrir detalle desde Mes. Destacar un evento, comprobar Conservar automático y localizarlo en Año; después desactivar cada opción por separado.
5. **Serie:** crear una tarea recurrente lunes/martes/viernes con dos subtareas. Modificar solo un martes y marcar una sub. Probar «esta y siguientes» y «toda la serie» para marcas/edición. Cambiar frecuencia a lunes/viernes: conservar el martes modificado; borrar toda la serie debe incluirlo.
6. **Alacena/Receta:** crear «Revisión piezas» (piezas, saldo 20) y «Revisión líquido» (ml, saldo 1000). Crear receta de una porción y diez minutos; un paso obligatorio usa 2 piezas y otro opcional usa 50 ml. Agregar equivalencia y una preparación previa. Debe dejar de ser borrador al cumplir los requisitos. Guardar/recargar.
7. **Planificar:** en una celda vacía cocinar 4 porciones y comer 1; otro día, sin Cocinar, comer 2 de esa misma receta. Comprobar preparaciones propuestas inicialmente sin seleccionar, poder aceptarlas/cambiarles horario y ver ambas comidas en Agenda. Planificar no cambia saldos reales.
8. **Consumo/sobras:** completar la primera desde su círculo **sin usar el opcional**: piezas 20 → 12, líquido queda 1000 y sobran 3 porciones. Completar la segunda: quedan 1 porción, piezas siguen en 12. Deshacer la primera debe exigir corregir la segunda. Deshacer segunda y luego primera: piezas vuelven a 20 y líquido sigue en 1000. Comparar los saldos visibles; los movimientos permanecen internos. Probar nuevamente el opcional: cocinar 4 consume además 200 ml; deshacer devuelve esos mismos 200 ml.
9. **Compras:** quitar esos planes pendientes para aislar la prueba. Poner el saldo de piezas en 0; planificar cocinar 1 porción: deben faltar 2 piezas en Compras. Cambiar la cantidad a 12 y comprar solo ese artículo: Alacena debe tener 12. Deshacer compra devuelve 0. Agregar jabón, comprobar posición al final y la X; probar compra individual y compra de todos. Ver el opcional debajo de la cantidad total. Desactivar Cocinar elimina la necesidad de ingredientes de ese plan.
10. **Últimos tres bloques:** en una semana vacía copiar la anterior; todas las comidas copiadas deben quedar pendientes, con reservas y compras recalculadas. Revisar la acción de cada semana en vista de dos semanas. Borrar semana completada debe quitar tarjetas sin devolver lo consumido. Retirar/reemplazar un ingrediente usado, comprobando el aviso y las referencias. Crear una comida desde Agenda y editarla desde Planificar: debe ser la misma comida.
11. **Persistencia y errores:** recargar después de cada grupo y comparar los apartados relacionados. Con dos pestañas, modificar algo en una y recuperar foco/Actualizar en otra; comprobar que trae cambios. Si hay conflicto, revisar el aviso y reabrir el cuadro; si el resultado es incierto, usar Reintentar en vez de recrear manualmente.

La prueba de retención sin esperar cinco días, aislamiento entre propietarios e idempotencia por API requiere el recorrido técnico controlado descrito abajo. El usuario no necesita cambiar fechas internas ni secretos para revisar la interfaz.

## 1. Acceso, propietario y errores

- [ ] Acceso Google solo con identidad; entrar/salir; sesión caducada y recuperación sin bloquear cuadros.
- [ ] API sin sesión rechaza; origen indebido rechaza mutación. No imprimir tokens ni URLs de conexión.
- [ ] Un propietario de prueba no puede consultar/mutar actividades, recetas, ingredientes privados o recibos del usuario. Crear datos aislados mediante servicios para esta prueba, sin hacerse pasar por otra cuenta OAuth.
- [ ] Comando repetido con mismo ID/payload no duplica efecto; mismo ID con payload diferente se rechaza.
- [ ] Respuesta perdida/reintento y conflicto de revisión permiten recuperar el flujo sin sobrescribir cambios.
- [ ] Cerrar cuadros con X/Escape funciona después de error; comprobar revisiones frescas al abrir de nuevo.

## 2. Actividades e Inbox

- [ ] Crear, editar, completar/deshacer principal e hijos; agregar hijo pendiente reabre principal.
- [ ] Agendar/quitar horario conserva ID, contenido y progreso. Hijo agendado de padre Inbox aparece en Agenda.
- [ ] Flags solo programados; activar Destacar activa Conservar y luego ambos son independientes.
- [ ] Borrar principal retira hijos y horarios. Paginación tras un cambio externo no mezcla datos viejos/nuevos.

## 3. Agenda y calendarios

- [ ] Día/Semana/Mes/Año, navegación descendente, selector/Hoy, filtros y destacados.
- [ ] Semana domingo–sábado; indicador y línea de hora solo en fecha real de hoy; desplazamiento inicial.
- [ ] Crear Tarea desde toolbar/Mes/Semana, detalle, subtareas rápidas, solapamientos y arrastre/resize de quince minutos.
- [ ] Crear/editar calendario; trasladar o retirar contenido con preview. Cocina mantiene su estructura protegida.
- [ ] Cambiar horario de subtarea desde Planificar funciona con su calendario actual; quitarlo conserva casilla.

## 4. Recurrencias y retención

- [ ] Reglas diarias/semanales/mensuales/anuales, intervalos, con y sin fecha final; sin crear futuro infinito.
- [ ] Día 31 y 29 de febrero ajustados sin perder ancla. Cambios por esta/siguientes/toda incluyen excepciones.
- [ ] Marcas/edición/eliminación de subtareas por clave estable, omitiendo pasos ausentes/renombrados correctamente.
- [ ] Cambio de frecuencia conserva pasadas, completadas y excepciones futuras; borrar toda la serie las incluye.
- [ ] Retención simulada con registros controlados; pendientes/Conservar/hijos protegidos no se pierden. Exclusiones no reaparecen.
- [ ] Retención de comidas conserva stock, tandas, usos y posibilidad de usar sobras reales.

## 5. Recetas, planificación y consumo

- [ ] Receta rápida → borrador → lista con porciones, tiempo, paso e ingrediente; equivalencia y opcionalidad del paso.
- [ ] Editar recetario no reescribe planes; actualización explícita de pendiente sí recalcula.
- [ ] Filas, multirreceta, fases, porciones cocinar/comer y tiempos; cocina combinada redondeada a cinco minutos.
- [ ] Plan cercano desplaza reservas del lejano; modificar/quitar origen recalcula ingredientes y sobras, también entre semanas.
- [ ] Preparaciones inicialmente sin seleccionar, horario editable, realizados conservados al mover.
- [ ] Pasos obligatorios completan comida; círculo pregunta opcionales con ingrediente/cantidad; descuento único.
- [ ] Cocinar produce tandas; comer usa real; sin Cocinar no inventa porciones. Deshacer dependientes antes del origen.

## 6. Último bloque: semanas

- [ ] Copiar anterior solo con destino vacío; revisión automática, versiones/porciones/fases/horarios conservados, todo pendiente.
- [ ] Preparaciones copiadas inicialmente sin seleccionar; datos nuevos no reutilizan consumos previos.
- [ ] Borrar semana pendiente libera reservas; borrar completadas no devuelve ingredientes ni destruye sobras reales.
- [ ] Dos semanas: acciones independientes; compras incluye planes de cualquiera.

## 7. Último bloque: ingredientes

- [ ] Preview de stock/recetas/planes; sustituto existente o nuevo de misma unidad; cantidades y revisiones correctas.
- [ ] Actualizar pendientes explícitamente o mantener revisión anterior; completadas e historial intactos.
- [ ] Sin sustituto: retirada personal, pasos conservados como texto, borrador si pierde último ingrediente; restricciones de stock explicadas.
- [ ] Compra/deshacer/consumo/reversión tras reemplazo conserva los movimientos exactos y no duplica ni produce negativos.
- [ ] Recuperar retirado sin sustituto; ningún cambio afecta catálogo/preferencias de otro usuario.

## 8. Último bloque: comidas desde Agenda

- [ ] Elegir Comida conserva fecha/hora y utiliza MealEditor; aparece en Agenda y Planificar.
- [ ] Celda ocupada avisa; abrir existente para añadir recetas sin duplicar bloque. Completada requiere deshacer para editar.
- [ ] Cambiar fecha/fila fuera de semana consulta destino; conflicto concurrente no sobrescribe.
- [ ] Calendario Cocina oculto permanece oculto; aviso ayuda a mostrarlo. Año sigue mostrando solo destacados.

## 9. Compras y recorrido completo

- [ ] Todos los planes pendientes con Cocinar activo contribuyen; opcionales no bloquean sugerencias pero sí aparecen en compras.
- [ ] Cantidad elegida sobrevive recálculos; libres abajo; comprado individual/todo aumenta stock una sola vez.
- [ ] Deshacer compra exacta, bloqueo por saldo insuficiente y comprados de treinta días conservan evidencias.
- [ ] Recorrido: crear receta → planificar dos semanas → comprar → cocinar varias porciones → comer sobras → deshacer dependientes → sustituir ingrediente → copiar/borrar semana.
- [ ] Recarga/foco entre cambios mantiene coherencia en todos los apartados, sin reutilizar revisiones antiguas.

## Cierre

Conservar un informe de fallos/correcciones y límites conocidos. El respaldo/restauración local ya se comprobó en su [bloque específico](RESULTADOS_USO_DIARIO_LOCAL.md). Eso no declara lista la producción pública: despliegue, configuración de seguridad, estrategia de respaldo del entorno de destino y revisión móvil son etapas posteriores.
