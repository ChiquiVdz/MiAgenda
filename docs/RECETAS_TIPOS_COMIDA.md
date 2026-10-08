# Clasificación de recetas por tipo de comida

Implementado el 2026-10-08 según las decisiones del usuario.

- Los tipos son las filas activas personales de Planificar; no hay un catálogo paralelo de nombres.
- En el editor del recetario se pueden elegir varios tipos y guardar junto con la receta. La clasificación no es requisito para dejar de ser borrador.
- La relación `RecipeMealSlot` usa los IDs estables de receta/fila y claves de propietario en ambas referencias. Renombrar la fila mantiene la relación.
- Crear filas las hace seleccionables en el recetario al abrirlo o actualizarlo. Retirar una fila elimina sus clasificaciones, sin trasladarlas al destino de sus comidas ni borrar recetas; incrementa la revisión de las recetas afectadas para detectar ediciones antiguas.
- Las recetas anteriores comienzan sin clasificación. No se deduce su tipo por el nombre o por comidas pasadas.
- Sin búsqueda, las sugerencias solo incluyen recetas del tipo elegido y respetan el máximo de ingredientes faltantes. Con búsqueda por nombre o «Mostrar todas las recetas» se pueden elegir recetas de cualquier tipo o sin clasificar; se mantienen los avisos de faltantes.
- La clasificación orienta las sugerencias, no restringe el guardado de comidas. No cambia ingredientes, porciones, consumos ni snapshots ya planificados.
- No se agregan consultas por casilla: los tipos y sus asociaciones se incluyen en las lecturas existentes. Se filtran los candidatos antes de calcular su disponibilidad.

## Revisión manual

1. Abre una receta lista en Recetario, marca Desayuno y guarda.
2. En Planificar abre una celda de Desayuno: debe sugerir esa receta si cumple el filtro de faltantes.
3. Abre una celda de Cena: no debe sugerirla automáticamente. Escribe su nombre: debe aparecer y poder agregarse.
4. Marca también Cena en esa receta y guarda: debe sugerirse en ambos tipos.
5. Agrega una fila «Colación» en Planificar. Abre/actualiza Recetario, selecciónala en una receta y guarda.
6. Renombra Colación: su nuevo nombre debe aparecer en Recetario conservando la selección. Retira la fila: la receta sigue existiendo y pierde solo ese tipo.
7. Deja una receta sin tipos: no aparece en sugerencias iniciales; sí al buscarla o mostrar todas.

No se han ejecutado pruebas funcionales en este bloque; se entrega para revisión del usuario.
