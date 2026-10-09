# Modelo objetivo de MiAgenda

Estado: modelo lógico aprobado el 2026-10-03. El núcleo que desarrolla este modelo está conectado; su implementación y límites actuales se describen en [ARQUITECTURA_ACTUAL.md](ARQUITECTURA_ACTUAL.md). La comprobación integral del cierre sigue pendiente.

El usuario aprobó reconstruir núcleo y base de datos conservando interfaz y reglas aprovechables, así como este modelo y la actualización de `PROJECT.md`. Google se conserva únicamente para iniciar sesión. `PROJECT.md` es la base vigente y este documento desarrolla su modelo lógico. La aprobación del diseño no significa que se haya reconstruido el código o la base.

## 1. Autoridad y límites

- PostgreSQL es la autoridad de actividades, calendarios, horarios, recurrencias y datos de módulos.
- Google identifica al usuario. El acceso solicita `openid email profile`, sin permisos de Calendar. No se requieren refresh tokens de Calendar ni consultas a esa API.
- Los datos se guardan bajo un `userId` interno. La identidad externa se vincula mediante proveedor y sujeto (`sub`), no por coincidencia de nombre o correo.
- Una actividad mantiene su ID al editar, completar, programar, mover o quitar horario.
- Toda la organización de acciones de MiAgenda usa la misma base `Activity`: Inbox, Día/Hoy, Agenda, comidas planificadas y actividades de futuros módulos. Las pantallas son vistas de esa base; no crean entidades de tarea separadas. Los tipos comparten contrato común y cada módulo agrega propiedades y reglas especializadas.
- Los módulos extienden actividades y usan servicios especializados. Sus movimientos, catálogos y mediciones no se convierten automáticamente en actividades.
- Web primero; API común para móvil/widget después. Finanzas, ejercicio y dashboard son extensiones futuras, no funcionalidades de esta reconstrucción.

Referencia para autenticación: [OpenID Connect de Google](https://developers.google.com/identity/openid-connect/openid-connect). La configuración concreta de la biblioteca de autenticación se revisará al implementar.

## 2. Entidades del núcleo

Nombres conceptuales; el esquema físico de Prisma se deriva después de aprobar reglas. Todas las entidades privadas incluyen propietario y las relaciones verifican el mismo propietario.

| Entidad | Contenido y responsabilidad |
|---|---|
| `User` | Identidad interna, zona horaria y preferencias personales |
| `AuthIdentity` / `Session` | Vínculo con Google y sesión propia; separados del dominio de agenda |
| `Calendar` | Nombre, color, propietario y vínculo opcional a módulo; ID interno |
| `CalendarPreference` | Visibilidad por usuario, conservada al cambiar de vista |
| `Activity` | Identidad y contenido de una tarea, comida o subtarea materializada |
| `ActivitySchedule` | Programación opcional, con calendario propio y fechas |
| `RecurrenceSeries` | Familia lógica permanente de una tarea recurrente |
| `SeriesSegment` | Definición de contenido/regla efectiva desde un punto de la serie |
| `SeriesStepDefinition` | Definición de subtarea con clave estable entre repeticiones |
| `OccurrenceOverride` | Excepción de una repetición: edición, borrado o vínculo a una instancia materializada |
| `SeriesProgressRule` | Marcas de subtarea/principal aplicables a un alcance sin crear miles de instancias |
| `CommandReceipt` | Identificador, huella de solicitud y resultado de un comando reintentable |

### Activity

| Campo | Regla |
|---|---|
| `id` | ID propio; formato que también pueda generarse desde un cliente para Inbox sin conexión |
| `userId` | Propietario inmutable |
| `kind` | `task` o `meal` inicialmente; tipo fijo |
| `title`, `description` | Contenido propio de MiAgenda, no una copia editable de Google |
| `parentId` | Opcional; mismo usuario, sin autorreferencia ni segundo nivel |
| `position` | Orden de hijos, separado de fecha y hora |
| `completedAt` | Fuente única de completado por actividad/instancia |
| `keep`, `highlighted` | Solo cuando hay programación activa |
| `revision` | Revisión para impedir sobrescribir cambios hechos desde otra pantalla/dispositivo |
| `lifecycle` | Activa o retirada; retirada nunca aparece como pendiente nueva |
| `seriesId`, `occurrenceKey` | Solo si pertenece a una repetición; permanecen al editar o mover la instancia |
| `createdAt`, `updatedAt` | Fechas operativas, distintas del horario planeado |

Una subtarea es `Activity` de tipo `task`. Puede tener horario, conservarse, destacarse y mostrarse en todas las vistas. No puede tener otras subtareas. Los pasos de una comida son hijos directos del bloque, con metadata especializada.

### ActivitySchedule

- Una actividad materializada tiene como máximo una programación activa.
- `timed`: inicio/fin como instantes UTC y zona IANA de referencia; fin estrictamente posterior al inicio.
- `allDay`: fechas de calendario, fin exclusivo y zona de referencia. No convertir todo el día en medianoche UTC.
- Una tarea puede carecer de horario o tener cualquiera de ambos modos. Una comida requiere `timed`.
- La zona inicial es `America/Mexico_City`. Cambiar de zona en el dispositivo no reescribe automáticamente horarios existentes.
- El calendario se relaciona con la programación. Las tareas sin horario no necesitan calendario. Un hijo programado de un padre en Inbox puede elegirlo.
- Un hijo programado hereda obligatoriamente el calendario de su principal programada, sin selector. Cambiar el calendario de la principal traslada también sus hijos programados, incluso completados, conservando horarios y marcas. Si la principal está en Inbox, cada hijo puede elegir calendario; al agendar la principal todos adoptan el suyo. Regla aprobada el 2026-10-08, aplicada también a los datos existentes mediante `20261008000400_subtask_inherit_calendar`.
- Quitar horario a una tarea mantiene ID, texto, progreso e hijos, limpia Conservar/Destacar con aviso y no quita horarios de sus hijos.
- Quitar horario a una subtarea deja su casilla en el padre. Una comida no admite quitar horario ni entrar a Inbox.

### Vistas, no identidades distintas

Inbox consulta actividades principales `task`, activas y sin horario. Un hijo sin horario se representa dentro de su padre; un hijo con horario también se muestra en Agenda, incluso si el padre está en Inbox.

Agenda consulta horarios del rango y calendarios seleccionados. Cocina consulta actividades `meal` y sus datos. Ocultar un calendario cambia presentación; no excluye planes de compras, reservas ni cálculos.

Al eliminar un calendario con contenido, ofrecer dos opciones explícitas: trasladar sus actividades/series a otro calendario o borrar su contenido y eliminar el calendario. Mostrar antes el alcance, incluidas subtareas vinculadas y excepciones recurrentes afectadas. Validar y confirmar el conjunto en una transacción; no dejar una operación aplicada a medias.

La opción de borrar usa las reglas comunes y del módulo: elimina la presentación y planes que corresponda, cancela generación de las series afectadas y recalcula reservas/compras. No deshace compras ni consumos reales; conserva evidencias mínimas necesarias por tandas, dependencias e historial. Si una dependencia impide una eliminación coherente, explicar el conflicto antes de confirmar y no forzar un borrado en cascada.

El calendario vinculado a Cocina se protege mientras ese módulo lo use: se puede borrar su contenido con las mismas reglas, pero no eliminar la estructura requerida por el módulo. Un calendario común puede eliminarse después de trasladar o borrar su contenido.

## 3. Completado y subtareas

### Tareas normales

- Marcar una casilla directamente modifica solo esa instancia.
- Completar la principal completa sus subtareas. Terminar todas las subtareas completa la principal.
- Si una subtarea se desmarca, la principal vuelve a pendiente.
- Deshacer desde el círculo de una principal normal desmarca principal y todas sus subtareas.
- Si una subtarea ya completada se edita, conserva su completado salvo que se cambie expresamente.
- Agregar una subtarea pendiente a una principal completada la vuelve pendiente. Si se eliminan todos los hijos, la principal conserva su estado hasta una acción explícita; no se completa por una lista vacía.

### Comidas

- El bloque es la actividad principal y su completado es único. Cada receta incluida es metadata de ese bloque, no otra actividad padre.
- Un paso lleva función `preparation` o `priorReminder`. Los pasos obligatorios de preparación participan en el completado automático; opcionales y preparaciones previas no lo bloquean.
- Completar todas las preparaciones obligatorias completa el bloque y registra el consumo de los ingredientes correspondientes. Los opcionales usados se derivan de pasos marcados.
- Si no hay pasos obligatorios aplicables, el bloque se completa por su círculo; no se completa automáticamente al crear una lista vacía ni al marcar un recordatorio previo.
- El círculo del bloque pregunta únicamente por opcionales con cantidad efectiva que se descontará. Los de Solo disponibilidad y los pasos sin ingrediente se pueden marcar paso a paso; el círculo conserva sus marcas actuales sin asumir que se usaron ni recuperar automáticamente su selección anterior al deshacer. Sin opcionales cuantificados, completa directamente.
- No hay descuentos por marcar un paso aislado. Estado del bloque, movimientos, tandas y usos se confirman juntos al completar.
- Si no se puede completar por falta de inventario/sobras, se muestra el conflicto y no se confirma un bloque completado con consumo incompleto.
- Deshacer revierte exactamente los movimientos registrados y las marcas de preparación según la regla de comidas. Una preparación previa que ya se realizó conserva su estado; no volver a descongelar por deshacer una comida.
- Mover una comida conserva todos los pasos realizados y ofrece reajustar horarios de preparaciones previas pendientes; no cambia una hora elegida manualmente sin aceptación.

## 4. Recurrencia propia y ligera

Regla de cambio de frecuencia aprobada el 2026-10-05: conservar completadas, pendientes pasadas e instancias futuras modificadas (incluidos horario, contenido, hijos, marcas y Conservar). Sustituir únicamente futuras pendientes sin cambios. Las nuevas empiezan pendientes. La excepción conserva identidad/familia y corresponde a una fecha concreta; no añade ese día a la nueva regla. Acortar la fecha final usa la misma política. Mostrar resumen y revisión esperada antes de confirmar.

- Inicialmente para tareas; las comidas siguen planificándose y copiándose mediante su módulo. No introducir recurrencia de consumo de alimentos sin diseñarla.
- Una familia lógica conserva `seriesId` al dividir «esta y las siguientes». `SeriesSegment` guarda cambios efectivos y límites; no se trata cada tramo como una serie desconectada.
- Las ocurrencias futuras se calculan en el rango solicitado. La consulta de Año no crea 365 tareas persistidas.
- Una ocurrencia se materializa cuando necesita progreso, cambios, hijos programados, Conservar/Destacar o evidencias específicas.
- `occurrenceKey` corresponde a su fecha/hora original dentro de la regla, y permanece tras moverla. Hay unicidad por usuario/serie/clave.
- La subtarea tiene una identidad por instancia y una `definitionKey` estable para marcas de serie; no se compara el texto del paso.
- Renombrar en una instancia conserva esa clave; eliminar un paso no hace que otro con el mismo nombre sea el mismo paso.
- «Esta» modifica una ocurrencia. «Esta y las siguientes» empieza en la ocurrencia original seleccionada. «Toda la serie» incluye excepciones y todos los segmentos de su familia.
- Las marcas por alcance actualizan instancias materializadas y guardan una instrucción efectiva para las futuras, sin crearlas todas. Afectan únicamente la subtarea con la clave elegida; si no existe, no se agrega.
- Los cambios estructurales se validan antes de confirmarse; mostrar alcance/efectos cuando se eliminan o sustituyen pasos con cambios particulares.
- Una repetición pendiente pasada sigue pendiente y debe aparecer en consulta de pendientes vencidos. Resolver esa consulta desde el inicio de la serie/límites, sin recortar los pendientes a ocho meses.
- No crear infinitas filas para cumpleaños; recurrencia sin fin es una regla con expansión limitada por petición.
- Retirar una ocurrencia guarda una exclusión compacta para que no reaparezca. Eliminar toda una serie termina su generación y trata sus excepciones como parte de la misma familia.
- Cambios de hora y zona deben resolverse en tiempo local de la serie, usando biblioteca/estándar revisados. [RFC 5545](https://www.rfc-editor.org/info/rfc5545/) es la referencia de formato; políticas de producto pueden exigir ajustes explícitos a la expansión estándar.

Decisión confirmada: día 31 y 29 de febrero se ajustan al último día del mes cuando esa fecha no existe. Conservar el día original como ancla: 31 de enero → 28/29 de febrero → 31 de marzo, sin convertir toda la serie en día 28. Un cumpleaños del 29 de febrero ocurre el 28 en años no bisiestos y vuelve al 29 en años bisiestos. Esta política requiere normalización explícita; no se presupone que la expansión estándar la implemente.

## 5. Cocina: entidades especializadas

| Entidad | Función |
|---|---|
| `Ingredient` | Catálogo global o ingrediente privado, nombre normalizado y unidad canónica |
| `IngredientPreference` | Seguimiento por cantidad/disponibilidad y ocultar/sustituir para un usuario, sin modificar el catálogo de todos |
| `PantryBalance` | Saldo numérico propio y estado disponible, con origen de la última compra de disponibilidad; cero válido, nunca negativo |
| `InventoryMovement` | Compra, ajuste, consumo y reversión; cantidad decimal y origen explícito |
| `Recipe` / `RecipeRevision` | Definición e identidad estable, versión con nombre, porciones base, tiempo y pasos |
| `RecipeStep` | Orden, texto, cero o un ingrediente, cantidad para porciones base, equivalencia, opcionalidad y anticipación |
| `MealSlot` | Fila del planificador, nombre y hora predeterminada del usuario |
| `RecipeMealSlot` | Clasificación personal de una receta en una o varias filas activas, con propietario común; no es parte del snapshot cocinado |
| `MealBlock` | Extensión uno a uno de Activity `meal`: fila, Comer/Lavar, indicador agregado de cocina y tiempos |
| `MealRecipe` | Receta del bloque, versión/snapshot, porciones a cocinar y a comer, override de tiempo y cantidades de ingredientes elegidas para esa preparación |
| `MealStepData` | Vínculo de actividad hija con receta/paso de origen y cantidades congeladas |
| `CookedBatch` | Tanda real de una receta con porciones y origen verificable |
| `PortionUse` | Uso real de una tanda por una comida; no una segunda copia del inventario crudo |

### Ingredientes y cantidades

Confirmado para el primer bloque de Alacena: reutilizar los 41 ingredientes comunes depurados, sin importar saldos de prueba anteriores; sugerir el ingrediente existente ante nombres parecidos, permitiendo crear uno distinto con confirmación explícita; unidad inmutable después de cualquier movimiento o existencia no nula. Un saldo cero sin movimientos permite corregir la unidad de un personalizado. Los globales solo los administra la aplicación.

- Alacena, pasos y compras enlazan al mismo ID de ingrediente. Normalizar mayúsculas/espacios/acentos no resuelve automáticamente sinónimos o plurales: selección de catálogo y sustitución explícita resuelven esas equivalencias.
- Catálogo global administrado por la aplicación. Ingredientes privados pertenecen a su usuario. Borrar un global para uno no lo borra para otros.
- Si está usado, ofrecer sustitución por existente, creación de sustituto o retirada de referencias con vista previa del efecto. No destruir movimientos reales ya registrados; conservar identidad mínima mientras tengan dependencias.
- Cantidades en decimal con hasta tres posiciones; unidad canónica fija por ingrediente. Convertir g/kg y ml/l cuando corresponda en límites del sistema; equivalencias humanas son texto de receta, no stock adicional.
- Un paso usa como máximo un ingrediente; si se usa en varios pasos, se suman cantidades para cálculos y se conserva el origen por paso.
- La cantidad de un paso se define para las porciones base de la revisión; para `n` porciones se escala una sola vez. Ejemplo: 200 g para una receta de 2 porciones equivale a 100 g por porción.

- Seguimiento personal por ingrediente: **Por cantidad** o **Solo disponibilidad**, sin cambiar el catálogo de otros usuarios. Disponibilidad usa «Tengo / Se terminó»; nunca representa una cantidad ficticia ni se descuenta o reserva al cocinar.
- En disponibilidad, los pasos admiten ingrediente sin cantidad y una indicación humana opcional («al gusto», «un chorrito»). Los obligatorios exigen Tengo; los opcionales conservan su selección habitual.
- Cambiar a disponibilidad conserva saldos y movimientos numéricos históricos. Volver a cantidad requiere indicar las existencias reales y genera el ajuste necesario sin reescribir consumos ni recibos. Las versiones planificadas sin cantidad mantienen su indicación y no inventan un descuento; para cuantificarlas se edita la receta y se actualiza expresamente el plan.

### Bloques, tiempos y sobras

- Una celda de fila/día del planificador tiene como máximo un bloque activo. Admite varias recetas en ese bloque. El planificador conserva lunes–domingo.
- Filas iniciales personales: Desayuno, Comida y Cena; editables y eliminables. Eliminar una fila revisa todas las fechas y ofrece traslado o borrado de planes. Un traslado a celdas ocupadas se bloquea para decidir su combinación expresamente.
- Etapa de planificación: completado de comida y pasos de cocina bloqueado hasta implementar consumos/sobras; preparaciones previas pueden completarse independientemente. No se permite descontar stock provisionalmente ni duplicar el estado.
- Hora inicial propuesta por la fila y editable por bloque. Cocinar pertenece a cada receta; Comer/Lavar y sus defaults personales editables pertenecen al bloque.
- Cocina combinada, solo de las recetas que se cocinarán: mayor tiempo de preparación + mitad de la suma de los demás; redondear hacia arriba al siguiente múltiplo de 5 minutos. Respetar un override explícito del bloque.
- Cocinar se elige por receta: desactivado equivale a cero porciones a cocinar; Comer/Lavar se eligen por bloque. El indicador cookingEnabled del bloque resume si se cocina alguna receta. Una receta aparece una sola vez por bloque.
- Porciones a cocinar y a comer comienzan iguales y luego son independientes. Cocinar descuenta ingredientes por lo preparado; comer usa porciones de tandas.
- Al planificar, proponer piezas redondeadas hacia arriba y permitir editar cantidades reales por receta/comida, incluidas fracciones; gramos y mililitros siguen proporcionales. Sumar los usos del mismo ingrediente antes del redondeo, separando obligatorios y opcionales. Disponibilidad, Compras, pasos y consumo usan la cantidad elegida; el recetario no cambia. Cantidades manuales se mantienen al cambiar porciones y pueden volver al cálculo automático. Solo disponibilidad sigue sin cantidad.
- Si un ingrediente se repite, distribuir su cantidad elegida entre pasos según los aportes originales, sin multiplicar el redondeo. Los opcionales conservan su selección individual. Copiar una semana conserva cantidades manuales; actualizar expresamente una receta propone cantidades calculadas de la nueva versión. Planes anteriores sin ajustes conservan su cálculo proporcional hasta cambiar porciones o elegir cantidades nuevas; los consumos históricos nunca se recalculan.
- Una tanda tiene identidad por receta, nunca un saldo común de pollo, pasta y otros alimentos. Decisión confirmada al diseñar el esquema físico: compartir sobras entre versiones de la misma receta y mostrar qué versión se cocinó. Si es otro platillo, crear otra identidad de receta. La versión del consumo y sus ingredientes reales no cambian por usar las sobras en un plan de una revisión posterior.
- Planear proyecta reservas; completar crea consumos reales. La misma sobra no puede reservarse/consumirse dos veces.
- Completado aprobado contra existencias reales aunque se adelante un plan posterior; recalcular las reservas pendientes. Usar primero porciones recién cocinadas en el bloque y después tandas reales más antiguas de la misma receta, con origen/versión visibles.
- La prioridad es fecha/hora más cercana, con desempate estable. Recalcular faltantes en posteriores cuando se modifica un plan anterior.
- Desempate aprobado: creación más antigua y después ID. Permitir planificar con sobras proyectadas de comidas pendientes, mostrando la dependencia de cocinar su origen; completar exige porciones realmente existentes. Las reservas previstas no escriben movimientos ni tandas.
- Si no hay porciones cocinadas suficientes: mostrar falta cocinar y, si procede, faltantes de ingredientes. No activar Cocinar silenciosamente.
- Deshacer una cocinada se bloquea si comidas posteriores ya consumieron sus sobras; indicar cuáles requieren corrección primero.
- Borrar de la agenda una comida ya consumida no devuelve ingredientes. Conservar la evidencia mínima necesaria separada de su presentación.
- No añadir «Desechar sobras»; fue rechazado.

### Recetas y preparaciones previas

- El recetario es una definición, no una tarea pendiente que se complete. Puede compartir tarjeta desplegable de pasos con otras pantallas.
- Borrador se determina automáticamente: recetas con nombre pueden omitir porciones, duración, pasos o ingredientes; son planificables al indicar porciones base, duración, al menos un paso y un ingrediente válido con cantidad positiva o seguimiento por disponibilidad sin cantidad. No hay casilla manual ni descripción editable de receta. La opcionalidad pertenece al paso, también sin ingrediente; con ingrediente abarca su contribución. Crear un personalizado dentro del editor utiliza las mismas reglas del catálogo.
- El plan referencia una revisión/snapshot para conservar ingredientes y pasos aunque se edite o retire la definición.
- Decisión confirmada: editar el recetario no actualiza automáticamente comidas ya planificadas. Mantienen su revisión; el usuario puede actualizar expresamente una comida pendiente, revisando efectos sobre pasos, horarios, porciones y reservas. Comidas completadas nunca se reescriben automáticamente.
- Un paso puede proponer un pendiente anterior (p. ej. descongelar 12 horas antes). Al planear se ofrece, inicialmente sin seleccionar; el usuario acepta y ajusta hora/duración.
- Recordatorio aceptado = hijo programado del bloque; no un evento en Google. Duración inicial de 5 minutos, editable.
- Nuevos pasos previos: `RecipeStep.priorGroup` guarda un límite de tramo en la revisión. La actividad `preparation` del propio paso recibe el horario aceptado; no se duplica como `priorReminder`. Desde la creación se elige anticipación sin título separado. Los registros anteriores conservan `priorGroup=false` y su semántica independiente.
- Los límites particionan los pasos: C incluye A–B–C; E incluye D–E. Completar el límite marca obligatorios y el paso pulsado, conserva otras marcas opcionales, exige los obligatorios de tramos anteriores y nunca finaliza la comida. Deshacer exige corregir primero pasos posteriores. Los opcionales con consumo se preguntan al finalizar el bloque, incluso desde el último paso posterior a los tramos.
- Consumo único al completar el bloque; los tramos no generan movimientos. Deshacer el bloque conserva las marcas previas, devuelve solo sus movimientos y exige deshacer primero la comida para corregir esos tramos. Al mover, los previos completados mantienen estado y horario.
- Copiar comidas copia configuraciones pendientes, no consumos ni progreso ni reservas reales de la semana de origen; ofrecer las preparaciones previas para las nuevas fechas.

## 6. Compras

| Entidad | Función |
|---|---|
| `ShoppingNeed` | Proyección agrupada de faltantes, con desglose obligatorio/opcional |
| `ShoppingEntry` | Artículo pendiente o libre y cantidad elegida por el usuario |
| `PurchaseReceipt` / `PurchaseLine` | Compra efectiva con cantidad realmente comprada, fecha y reversión |

- Considerar todos los planes pendientes pertinentes, aunque no estén en la semana visible o su calendario esté oculto.
- Sumar por ID de ingrediente; guardar/mostrar aportes obligatorios y opcionales. Un ingrediente puede tener ambos tipos de demanda.
- Obligatorios tienen prioridad de stock sobre opcionales. Los opcionales no impiden sugerir una receta.
- Necesidad calculada, cantidad que se pretende comprar y cantidad realmente comprada son valores distintos. Recalcular no debe sobrescribir una cantidad editada en el formulario.
- Compras individuales/globales incrementan alacena una sola vez por comando; no marcan una comida realizada.
- Compra por disponibilidad: recibo sin cantidad ni movimiento numérico, con disponibilidad y origen anteriores. Comprar activa Tengo; deshacer restaura el estado anterior únicamente si sigue siendo la última operación de disponibilidad. Cambios manuales, cambio de modo o sustitución invalidan esa reversión para no sobrescribirlos.
- Una necesidad sin cantidad de una versión histórica, cuyo ingrediente volvió a Por cantidad, solicita al usuario la cantidad real que compra; no inventa una cantidad predeterminada.
- Deshacer compra usa la cantidad registrada. Si ya no hay stock para retirarla, mostrar conflicto; nunca dejar saldo negativo.
- Artículos libres al final; ingrediente libre referenciado incrementa su saldo al comprar. Un texto como jabón no incrementa inventario alimentario ni crea un ingrediente automáticamente.
- Comprados se agrupan en panel desplegable de los últimos 30 días. Este límite de consulta no elimina evidencias. Retención de recibos separada de tareas; su plazo se define antes de compactar, y puede ampliarse al añadir finanzas.
- Solo las comidas pendientes con Cocinar activo aportan ingredientes a Compras, en cualquier semana. Faltan sobras sin Cocinar: aviso en el plan, sin compra de ingredientes ni activación automática de cocina.

## 7. Retención y dependencias

- Completar no elimina. Plazo mínimo: cinco días desde el completado y no antes del fin programado. Pendientes no se purgan por antigüedad.
- Conservar impide purga de detalle; Destacar activa Conservar, y ambos se pueden cambiar después independientemente.
- Decisión aprobada el 2026-10-05: Conservar una principal protege también sus subtareas mientras esa protección siga activa, sin cambiar sus banderas individuales.
- Los hijos conservan su propio progreso. Purgar su evento no debe perder una casilla todavía necesaria para representar un padre activo.
- No purgar una regla recurrente al limpiar una aparición. Mantener exclusiones compactas para ocurrencias retiradas.
- Decisión confirmada: posponer la purga de una principal mientras un hijo pendiente, futuro o conservado impida retirarlo. No crear un Conservar manual automáticamente ni cambiar su fecha de completado: es una protección por dependencia. Al desaparecer el impedimento, reevaluar el conjunto con sus plazos. El borrado manual se diferencia de la purga y avisa del alcance.
- Borrado manual valida hijos, tandas y consumos antes de confirmar. No devuelve ingredientes ni reescribe historial por borrar una presentación.
- Referencias de consumo/tandas se retienen mientras sean necesarias, sin títulos ni instrucciones completos cuando ya no se necesitan.
- Seguimiento selectivo futuro: contribución mínima por ocurrencia y agregado por período. Una tarea no afecta una gráfica salvo que se haya elegido medirla. Las tareas vencidas siguen pendientes.
- Registro mínimo y detalle tienen retenciones diferentes. Una política concreta de estadísticas/recibos se acuerda antes de borrarlos o implementarlos; no guardar indefinidamente todo por defecto.

## 8. Comandos, consultas y restricciones

- Los Route Handlers autentican, validan formato y delegan. Los servicios aplican reglas comunes y especializadas; los módulos no importan mutuamente servicios formando ciclos.
- Comandos explícitos: crear, editar, programar, quitar horario, establecer completado, conservar/destacar y eliminar. Las acciones especializadas usan el mismo punto de aplicación desde todas las vistas.
- `setCompleted(true/false)` con `commandId` y revisión esperada; reintentar devuelve el resultado original. Una misma clave con otro payload se rechaza.
- Transacción única para cambios que deben confirmarse juntos: consumo/estado/tandas, compra/saldo, programación/relaciones. OAuth no se ejecuta dentro de esas transacciones de negocio.
- Todos los escritores de inventario participan del mismo protocolo; ajustar cantidad absoluta requiere revisión y crea movimiento por la diferencia.
- Unicidad de identidad Google de acceso, programación por actividad, balance por usuario/ingrediente, ocurrencia materializada, paso de instancia y reversión de movimiento.
- Claves de propietario en relaciones privadas; autorización por sesión, nunca confiar en `userId` recibido del cliente.
- Índices por propietario/fecha, padre/orden, serie/ocurrencia y movimientos/origen. No declarar índices para cada campo sin consultas que los requieran.
- Datos de negocio y relaciones en tablas; JSON acotado/validado para payload de comando, snapshots y definiciones que no requieran relaciones. No volver a poner toda la jerarquía en varios JSON editables.
- Leer no inicia sincronización con Google ni reconstruye compras en una transacción de escritura. Las consultas comparten proyección coherente y precargan estado pertinente una vez por operación.
- Al entrar, comprobar identidad/revisión y ofrecer novedades sin descargarlas automáticamente. No sondear periódicamente ni descargar al recuperar foco o reconectar. Navegar y guardar acciones locales habilitadas no consulta al servidor. El único botón «Actualizar» envía los pendientes y después descarga. El reloj de la línea horaria se actualiza localmente.
- La expansión recurrente y la proyección de cocina usan el mismo contrato de rango; no limitar reservas a lo visible ni perder pendientes antiguos por paginación.

## 9. Preparación para después

- Sin conexión: consulta de última copia, altas de Inbox y edición/completado de tareas normales e hijos de la instancia seleccionada. Las acciones habilitadas usan guardado local también con internet. El único botón «Actualizar» envía manualmente primero y descarga después. Agendar/cambiar/quitar horarios de tareas normales e hijos también es local, incluida creación programada y arrastre, solo esa instancia, con calendarios descargados y herencia de calendario. Crear calendarios, eliminar principales, alcances de serie y Cocina siguen requiriendo conexión.
- Cola persistente con IDs estables, lotes inmutables, recibo atómico y revisión de principal/hijos antes de aplicar. Conflictos requieren elegir versión; borrados permiten recuperar como nuevo Inbox o descartar. No descartar pendientes al fallar red/sesión/almacenamiento. Cerrar sesión exige sincronizar o confirmar descarte; no purgar localmente. Fecha de completado según acción en dispositivo, nunca futura respecto al servidor.
- Dashboard, precios/paquetes, presupuestos, ejercicio y widgets se diseñan sobre estas interfaces. No crear sus tablas completas ni nuevos módulos ahora.
- Widget nativo requiere plataforma elegida en otra fase; PWA/web móvil no promete widget nativo automático.

## 10. Ejemplos de identidad y efectos

1. «Examen el jueves» en Inbox → programar → misma Activity con Schedule. Quitar horario → misma Activity, mismo progreso y ninguna copia del examen.
2. Padre «Preparar viaje» en Inbox + hijo «Comprar boleto» programado → padre permanece Inbox; hijo aparece Agenda y sigue en su lista de subtareas.
3. «Rutina» recurrente → cambiar nombre de un paso el martes no cambia su clave; marcarlo para siguientes lo busca por clave, no por el nombre.
4. Lunes cocinar 4 porciones de pasta y comer 2 → consumo de ingredientes para 4 y una tanda con 2 disponibles. Martes comer 3 sin cocinar → avisar falta cocinar 1; no reutilizar esas 2 para otro día también.
5. Compra de 12 huevos cuando faltan 7 → recibo y aumento de 12; completar después una comida descuenta su consumo, no la cantidad de la lista de compras.

## 11. Aprobación y siguiente bloque

Confirmado: reconstrucción por bloques, reutilización de piezas, stack general, Google solo login, núcleo propio, tipo fijo, un nivel, restricciones de Inbox y seguimiento selectivo futuro.

Confirmado también: fechas inexistentes usan último día manteniendo ancla; purga de padre se pospone por hijos dependientes; planes mantienen revisión de receta hasta actualización explícita.

Reglas aprobadas: deshacer principal normal desmarca hijos; agregar hijo pendiente reabre principal; preparaciones previas no completan automáticamente comida; política de calendario de hijos. El borrado de calendario ocupado ofrece trasladar o borrar su contenido, con validaciones y preservación de consumos reales.

El modelo lógico y el reemplazo de `PROJECT.md` están aprobados. El siguiente bloque será el esquema físico y acceso en base aislada, todavía sin recuperar todos los módulos a la vez. Las decisiones de implementación que afecten comportamiento o introduzcan casos no cubiertos se consultarán antes de aplicarlas.

## Horarios de subtareas recurrentes — 2026-10-08

`SeriesStepDefinition` incorpora calendario con FK compuesta de propietario, modo, zona, diferencia de días respecto a la principal, hora local y duración. Todos estos campos quedan vacíos sin horario. Límite operativo: hasta 366 días de diferencia/duración, con intervalos de 15 minutos en modo horario.

Programar/cambiar/quitar permite solo esta, siguientes o toda la familia. El día de referencia es la fecha local actual de cada principal materializada; sin horario se toma su fecha original. Las proyecciones usan la fecha de la ocurrencia. Se reemplazan horarios de pendientes; se omiten completadas, pasos ausentes y retirados. Identidad de paso estable, no texto.

Para completadas virtuales, `scheduleHistory` retiene las definiciones anteriores con la secuencia de cambio; el progreso elige la definición que existía al completar, sin materializar todo el pasado ni el futuro. Las instancias materializadas conservan su horario real. El calendario siempre sigue a la principal programada, también en el historial proyectado de completadas. Al deshacer una marca virtual se materializa primero su horario histórico y se conserva como excepción individual.

Las vistas proyectan tanto principales como hijos programados, en el calendario heredado aunque caigan el día anterior/siguiente al rango de la principal. Los hijos solo se materializan al modificar una instancia. Dividir segmentos o cambiar frecuencia copia sus definiciones de horario. Borrar/trasladar un calendario trata también las definiciones y el historial relativo: si la principal está en Inbox, los hijos conservan su calendario independiente hasta agendarla.

Empalmes permitidos, sin desplazamiento automático. Completar casillas continúa siendo rápido y por instancia; no se introducen dependencias de inicio o fin entre tareas.
