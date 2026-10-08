# Retirar y reemplazar ingredientes — núcleo propio

Implementado el 2026-10-06. PROJECT.md no se modificó. No se añadieron dependencias.

Estado actualizado el 2026-10-08: los servicios de sustitución, consumo y reversión están comprobados en la [revisión integral](RESULTADOS_REVISION_INTEGRAL.md). La guía siguiente incorpora el acceso actual y los modos de seguimiento; los pasos manuales quedan para repetir la comprobación, no como bloque técnico sin revisar.

## Uso

En Alacena, seleccionar el ingrediente en el catálogo y pulsar **Eliminar o reemplazar** abre la revisión de recetas, comidas pendientes y existencias. Ofrece reemplazar por otro ingrediente existente, crear un sustituto desde el mismo flujo o eliminar las referencias del recetario sin sustitución. La X de la selección solo la cierra; Quitar de Alacena no equivale a retirar referencias de recetas.

- Los reemplazos requieren la misma unidad canónica y modo de seguimiento compatible (Por cantidad/Solo disponibilidad). No se convierte entre gramos, mililitros y piezas. Crear el sustituto usa esa unidad fija. Las cantidades se suman sin coma flotante y se valida el máximo permitido; disponibilidad conserva su estado y el historial numérico anterior.
- La retirada es personal mediante IngredientPreference.retiredForUser/replacementId. No borra el catálogo global, las evidencias ni los ingredientes de otros usuarios. El ingrediente deja de estar en los selectores activos y la alacena del usuario.
- Existencias positivas se trasladan al sustituto mediante ajustes de inventario balanceados. Sin sustituto, se exige ajustar previamente las existencias a cero; no desaparecen a escondidas.
- Recetario: se crea una revisión nueva preservando claves de pasos, instrucciones, opcionalidad, equivalencias y preparaciones previas. Quitar el ingrediente mantiene el texto y elimina su cantidad/equivalencia. Si ya no quedan ingredientes, la receta pasa a borrador.
- Se muestran las comidas pendientes y se ofrece aplicarles el cambio, inicialmente sin seleccionar. Cada revisión congelada se copia por separado, cambiando solo el ingrediente elegido; no se incorporan otras ediciones recientes del recetario. Se conservan fechas, porciones, tiempos, progreso y recordatorios.
- Si quitarlo dejara una comida pendiente sin ingredientes, esa aplicación se bloquea: usar un sustituto o corregir/eliminar el plan primero. Los planes excluidos mantienen su referencia anterior y sus faltantes; será necesario editarlos antes de comprar o cocinar con el sustituto. Comprar un ingrediente retirado pide corregir ese plan, evitando inventario oculto.
- Compras: los faltantes se recalculan desde las versiones que quedaron en los planes. Se trasladan los artículos independientes pendientes y se suman cantidades elegidas de los duplicados automáticos. Las entradas anteriores se retiran, no se reescriben, para mantener los recibos.
- Las comidas completadas, los recibos, las tandas y los movimientos originales permanecen intactos.
- Deshacer conserva la reversión exacta contra el ID original y agrega ajustes balanceados hacia/desde el sustituto actual. También se soportan cadenas de sustituciones de igual unidad, cantidades máximas y ausencia de stock. Las dependencias de sobras siguen bloqueando el deshacer cuando corresponde.
- Deshacer un consumo de un ingrediente retirado sin sustituto vuelve a hacerlo visible cuando devuelve existencias. Las referencias que se quitaron del recetario no se reconstruyen automáticamente.
- Ingredientes eliminados permite recuperar los retirados sin sustituto, sin restaurar recetas ni alterar existencias. Los ingredientes unificados se usan a través de su sustituto. No se pueden crear nuevos IDs con el mismo nombre normalizado de un ingrediente histórico.

## Integridad y rendimiento

GET ingredientImpact entrega revisión global, cantidad y listas de recetas/comidas afectadas. POST retireIngredient valida esa revisión dentro del mismo bloqueo por propietario y transacción que usa el resto del núcleo. Un reintento confirmado reproduce el recibo; no vuelve a transferir existencias. Una escritura concurrente invalida la revisión y exige revisarla de nuevo. Todo el reemplazo se confirma o revierte junto.

La revisión de impacto se solicita al abrir el diálogo o cambiar la revisión de datos, sin sondeo. Ingredientes eliminados se consulta solo al desplegarlo y permite paginación. Las consultas habituales de catálogo excluyen retirados mediante la preferencia del propietario.

Migración `20261006000100_recipe_snapshot_copy`: permite copiar un nombre histórico de ingrediente ya registrado para ese usuario, manteniendo unidad y acceso válidos; las revisiones y los pasos históricos siguen siendo inmutables. Aplicada exclusivamente a miagenda_core.

En el bloque inicial solo se comprobó TypeScript. Después, la revisión integral probó traslado de existencias, actualización de planes pendientes, versiones históricas y consumo/reversión; consultar su informe para alcance y correcciones. Las cantidades manuales por comida también se trasladan o combinan al sustituir sus referencias, según la implementación posterior.

## Revisión manual

1. Crear dos ingredientes de prueba de la misma unidad, con nombres distintos, y registrar 4 y 6 piezas.
2. Crear una receta con el primero y planificar una comida pendiente con ella. Opcionalmente completar otra comida para revisar después el historial y Deshacer.
3. En Alacena, seleccionar el primero en el catálogo y pulsar Eliminar o reemplazar. Elegir reemplazo por el segundo y comprobar nombres afectados y suma propuesta.
4. Marcar aplicar a las comidas pendientes y confirmar. El original desaparece; el sustituto tiene las existencias sumadas. Recetario y plan pendiente usan el sustituto; horarios, porciones y progreso permanecen.
5. Abrir Compras y comprobar que los faltantes actualizados se agrupan por el sustituto. Los recibos existentes conservan sus nombres originales.
6. Si se completó una comida antes de reemplazar, deshacerla después: devuelve la cantidad consumida al sustituto. Si se compró el original antes de reemplazar, deshacer la compra resta su cantidad del sustituto; si ya no alcanza, se bloquea sin cambios parciales.
7. Crear otro ingrediente de prueba sin stock y una receta que solo use ese ingrediente. Eliminar sin reemplazo mantiene el texto del paso y convierte la receta en borrador. Recuperarlo desde Ingredientes eliminados no reconstruye la referencia de la receta.
8. Intentar eliminar sin sustituto un ingrediente con stock: se bloquea. Cancelar el diálogo no altera nada. Crear sustituto y cancelar deja ese ingrediente nuevo disponible, pero no ejecuta la retirada.
9. Para comprobar versiones congeladas: planificar una receta, editar después otro paso en el recetario y reemplazar el ingrediente aplicando a pendientes. El plan conserva su otro paso anterior y el recetario conserva su edición más reciente.
10. Si se revisa el reemplazo y otra pestaña cambia datos antes de confirmar, se pide actualizar; no se aplica parte del reemplazo ni se duplica un traslado.
