# Crear comidas desde Agenda

Bloque implementado el 2026-10-06. PROJECT.md y el esquema físico no se modificaron. Sin dependencias nuevas.

Estado actualizado el 2026-10-08: el flujo compartido y la celda ocupada se revisaron en el [cierre integral](RESULTADOS_REVISION_INTEGRAL.md); los últimos cálculos de Cocina y su aceptación visual están en el [informe reciente](RESULTADOS_COCINA_CANTIDADES.md). El editor actual se abre como cuadro lateral, sin oscurecer el resto de la pantalla.

## Funcionamiento

- Crear actividad ofrece Tarea o Comida. Se abre desde el botón Crear, un espacio libre de Semana o un día vacío de Mes. En Día y Año está disponible el botón Crear.
- Tarea conserva el flujo de programación y recurrencia. Comida usa el mismo MealEditor del planificador, en src/app/core/meal-editor.tsx, incrustado en el cuadro lateral; no existe un segundo editor ni un modelo de comida independiente.
- Semana proporciona fecha y hora de la celda pulsada. Mes y el botón Crear proporcionan fecha y la hora actual redondeada al próximo cuarto de hora. El usuario puede cambiarlas.
- El tipo de comida se sugiere por cercanía entre la hora elegida y las horas predeterminadas de las filas, con desempate por posición/ID. La fila es editable. No se cambia la hora pulsada por la predeterminada de la fila.
- Se conserva el flujo de recetas listas, porciones a cocinar/comer, tiempos por receta, Cocinar/Comer/Lavar, tiempo combinado redondeado a cinco minutos, disponibilidad cronológica y preparaciones previas inicialmente sin seleccionar.
- Cocinar se elige por receta; Comer y Lavar pertenecen al bloque. Cada receta admite ajustes de cantidades para esa comida: piezas propuestas hacia arriba, gramos/ml proporcionales y cantidades manuales persistentes. Solo disponibilidad usa Tengo sin consumo numérico. Disponibilidad, Compras y consumo usan esas mismas cantidades.
- Una celda ya ocupada muestra su comida y bloquea crear otra. Ofrece abrir el bloque existente para añadir recetas, explicando que descartará el borrador actual y conservará los datos del bloque existente. No se mezcla contenido sin confirmar ni se sobrescribe su horario por la hora pulsada en Agenda.
- Si la comida está completada, se ofrece verla en Planificar y se exige deshacerla antes de cambiar recetas, porciones o consumos. El enlace utiliza la identidad interna y la página determina su semana.
- Las celdas de la semana cargada se revisan desde la consulta existente. Si se elige otra semana, GET mealCell revisa solo la celda elegida, por usuario, con cancelación de consultas anteriores. Para abrir una comida de esa otra semana se carga su contexto completo una vez.
- El servidor mantiene la comprobación de celda ocupada dentro del bloqueo por propietario de saveMeal. Si otra pestaña ocupó la celda mientras se editaba, el guardado se rechaza sin crear un bloque parcial; el refresco muestra el bloque existente. No se crea una tarea genérica para representar una comida.
- Guardar o eliminar desde el editor refresca Agenda. Los faltantes de Compras se derivan de todos los planes pendientes con Cocinar activo al entrar/actualizar, igual que al guardar desde Planificar. Planificar no consume inventario; completar mantiene su protocolo transaccional anterior.
- Se respeta la selección de calendarios visibles. Si Cocina está oculto, se avisa después de guardar; no se activa el filtro a escondidas. Año sigue mostrando solo destacados.
- El componente de creación de comidas se carga bajo demanda al elegir Comida, y los datos de Cocina se consultan al abrir ese flujo. No se agrega sondeo ni carga de recetas a las consultas normales de Agenda.
- El mismo hook de comandos del planificador conserva IDs de operación para reintentos. Se bloquea cambiar tipo/cerrar durante escrituras o resultados inciertos hasta resolver el mismo guardado. Las lecturas pueden cancelarse cerrando el diálogo.

## Cómo revisar

1. En Agenda Semana, pulsar un espacio vacío de un día a las 14:15. Cambiar Tipo de elemento a Comida. Deben conservarse fecha/14:15 y sugerirse la fila más cercana; se puede elegir otra.
2. Añadir una receta lista, cambiar porciones/tiempo y guardar. Ver la comida en Agenda y en la misma celda de Planificar. Si faltan ingredientes y Cocinar está activo, comprobar Compras. Alacena no debe disminuir al planificar.
3. Volver a crear Comida para esa misma fecha/fila. Aparece el aviso y Guardar no crea una segunda comida. Pulsar Abrir comida existente, añadir otra receta y guardar: sigue siendo un solo bloque, con las dos recetas y el horario anterior del bloque.
4. Cambiar fecha/fila en el formulario hacia una celda ocupada. Debe poder elegirse otro destino o abrir esa comida tras el aviso. Probar también una fecha de otra semana.
5. En Mes, pulsar un espacio vacío de otro día y elegir Comida. Comprobar fecha, hora editable y acceso al mismo editor. Desde Día, comprobar el botón Crear.
6. Elegir Tarea: siguen disponibles nombre, calendario, horario y recurrencia, sin preguntas de recetas ni inventario. Cancelar no guarda una actividad.
7. Ocultar Cocina, crear una comida y guardar. Sigue oculta en Agenda, aparece en Planificar y se avisa que hace falta activar Cocina para verla en Agenda. La selección de los demás calendarios permanece.
8. Intentar crear en una celda con una comida completada. Se muestra enlace al bloque existente y se pide deshacerla antes de añadir recetas; no se alteran consumos reales.
9. Elegir una receta con preparación previa: sus opciones empiezan sin seleccionar y solo se crean las aceptadas. Guardar desde Agenda debe conservar el comportamiento del planificador.

En el bloque inicial se comprobó TypeScript sin pruebas funcionales. Posteriormente, la revisión integral cubrió los servicios y recorrió la creación desde Agenda/celda ocupada en navegador. La revisión reciente de Cocina comprobó cantidades y consumo, y el usuario aceptó su presentación en PC. La guía anterior queda para revisiones posteriores; no afirma cobertura de todos los gestos o dispositivos.
