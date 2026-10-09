# Proyecto: MiAgenda — actividades y calendario propios con módulo de cocina

**DISEÑO APROBADO el 2026-10-03.** Este contrato sustituye el diseño basado en Google Calendar. Describe el objetivo de la reconstrucción; no afirma que ya esté implementado. `PROJECT.md` es la fuente principal del proyecto.

## 1. Objetivo general

MiAgenda es una aplicación personal para organizar actividades, subtareas y horarios, conectada a módulos especializados. La información y la programación pertenecen a MiAgenda y se guardan en PostgreSQL. Google se utiliza únicamente para iniciar sesión.

El primer módulo es Cocina. La base debe permitir después Finanzas, Ejercicio y un dashboard, conectando sus operaciones con actividades sin duplicar estados ni identidades.

**Toda la organización de acciones de la app se basa en `Activity`.** Inbox, Día/Hoy, Agenda, comidas planificadas y actividades de otros módulos usan esa misma identidad, estado y capacidades comunes. Cada módulo agrega propiedades y reglas sobre esa base. Catálogos, recetas reutilizables, saldos, movimientos y mediciones son datos especializados vinculables a actividades; no se convierten en tareas por compartir una pantalla.

## 2. Acceso con Google

- Mantener «Iniciar sesión con Google» como única forma de acceso inicialmente.
- Solicitar identidad/perfil básico (`openid email profile`), sin permisos de Calendar.
- Usar identidad interna y vincularla al sujeto del proveedor; los datos se guardan en MiAgenda, no en Google.
- Crear sesión propia segura mediante una biblioteca mantenida; no implementar manualmente OAuth ni contraseñas.
- Retirar integración Calendar, tokens destinados a ella y sincronización remota cuando se reconstruyan sus flujos.

## 3. Actividad común y agenda

- Toda tarea, comida planificada o subtarea comparte identidad propia y estado común. El tipo queda fijo.
- Las actividades tienen nombre, descripción opcional, completado y posibilidad de un nivel de subtareas.
- El horario es opcional para tareas y subtareas, obligatorio con hora para comidas.
- Inbox contiene principales de tipo tarea sin horario. No admite recetas/comidas. Agendar o quitar horario conserva identidad y progreso.
- Captura rápida desde cualquier pantalla guarda en Inbox y permite continuar donde se estaba.
- Un hijo puede tener horario aunque su padre esté en Inbox. Puede verse, editarse, completarse, conservarse o destacarse desde Agenda como otra actividad programada, manteniendo su relación.
- Si la principal está programada, todas sus subtareas programadas heredan obligatoriamente su calendario, sin selector independiente. Cambiar el calendario de la principal traslada también las subtareas, incluidas las completadas, conservando horarios y marcas. Si la principal está en Inbox, sus subtareas pueden elegir calendario; al agendarla adoptan el suyo. La regla también se aplica a subtareas existentes.
- Calendarios propios seleccionables, con nombre/color e identificación del módulo cuando corresponda. La visibilidad se conserva entre vistas.
- Borrado de calendario ocupado: ofrecer trasladar actividades/series a otro calendario o borrar su contenido y eliminar el calendario, mostrando alcance y dependencias antes de confirmar. Borrar contenido no deshace consumos ni compras; conserva sus evidencias mínimas. El calendario vinculado a Cocina puede vaciarse con esas validaciones, pero su estructura se protege mientras el módulo la necesite.
- Vistas Día, Semana, Mes y Año. Agenda Semana de domingo a sábado; Cocina de lunes a domingo.
- Selector de vista lleva al período de hoy. Botón Hoy solo si hoy está fuera del período mostrado; vuelve al período actual.
- Año: doce meses y destacados de los calendarios visibles; acceso a Mes. Mes: crear en espacio vacío, detalle de evento, Ver semana y Ver más. Semana: detalle inicial con subtareas y acciones, acceso a Día desde el encabezado.
- Día permite edición rápida de subtareas. Marcar una casilla modifica esa instancia sin preguntas de alcance; los alcances de serie se ofrecen desde el flujo de Agenda correspondiente.
- Arrastrar/mover/ajustar con intervalos de 15 minutos y formularios alternativos. No recuperar los botones de ±15 minutos/±1 día que el usuario retiró.
- Línea horaria solo en el día actual y desplazamiento inicial cerca de la hora actual. Resolver eventos solapados en columnas.

## 4. Cocina y alacena

Cocina conserva un área propia con alacena, recetario, planificador y compras. Sus actividades también aparecen en Agenda cuando su calendario está visible.

- Catálogo común seleccionable/buscable; ingredientes personalizados privados.
- Alacena, recetas y compras usan el mismo ID; nombres normalizados evitan duplicados por formato, no sustituyen una decisión explícita sobre sinónimos.
- Unidades canónicas fijas y cantidades decimales. Equivalencias humanas pertenecen a receta, no al stock.
- Inicio de reconstrucción de Alacena: reutilizar el catálogo común depurado y comenzar sin existencias anteriores. Nombres parecidos ofrecen usar el existente o confirmar un ingrediente distinto; no fusionarlos automáticamente. Bloquear cambios de unidad cuando haya existencias o cualquier movimiento registrado.
- Seguimiento personal por ingrediente: **Por cantidad** o **Solo disponibilidad**, sin cambiar el catálogo de otros usuarios. Disponibilidad usa «Tengo / Se terminó»; nunca representa una cantidad ficticia ni se descuenta o reserva al cocinar.
- En disponibilidad, los pasos admiten ingrediente sin cantidad y una indicación humana opcional («al gusto», «un chorrito»). Los obligatorios exigen Tengo; los opcionales conservan su selección habitual.
- Cambiar a disponibilidad conserva saldos y movimientos numéricos históricos. Volver a cantidad requiere indicar las existencias reales y genera el ajuste necesario sin reescribir consumos ni recibos. Las versiones planificadas sin cantidad mantienen su indicación y no inventan un descuento; para cuantificarlas se edita la receta y se actualiza expresamente el plan.
- Guardar cantidades crea un ajuste verificable y evita sobrescribir cambios concurrentes. Guardar permanece desactivado si el formulario no cambió.
- Retirar ingrediente usado ofrece sustitución, creación de sustituto o eliminación de referencias con explicación de efectos. No alterar el catálogo global de otros usuarios ni destruir consumos reales.

## 5. Recetas y pasos

- Una receta es una definición reutilizable, no una tarea que se completa en el recetario.
- Permitir crear recetas rápidamente con nombre. Borrador se calcula automáticamente: no planificar hasta indicar porciones base, duración, al menos un paso y al menos un ingrediente válido: cantidad positiva en seguimiento por cantidad, o sin cantidad en seguimiento por disponibilidad. Al completar esos datos deja de ser borrador; no hay casilla manual. Un paso sin ingrediente también puede ser opcional. Permitir crear ingredientes personalizados desde el editor, respetando duplicados, sugerencias y unidades del catálogo.
- Recetario sin descripción: porciones y tiempo visibles, pasos editables en la tarjeta desplegada y entrada rápida de instrucción con ingrediente opcional. La opcionalidad abarca todo el paso y su ingrediente.
- Nombre, porciones base, duración y pasos estructurados; cada paso admite cero o un ingrediente, cantidad, equivalencia y marca opcional.
- Los ingredientes se obtienen de los pasos; sumar cuando se repiten, evitando introducirlos dos veces.
- Cantidades expresadas para las porciones base y escaladas una vez al planear.
- Cada comida planificada conserva versión/snapshot de la receta; lo completado nunca se reescribe por una edición del recetario.
- Editar el recetario no actualiza planes existentes automáticamente. Una comida pendiente puede actualizarse expresamente, recalculando sus efectos.
- Desde la creación de un paso se puede marcar «Hacer este paso antes» e indicar anticipación; su propio texto identifica la preparación. Cierra un tramo desde el anterior paso previo: A–B–C y D–E si C y E son previos. Puede ser el primer paso.
- Se ofrece al planificar inicialmente sin seleccionar; el usuario decide y cambia horario/duración. Programar usa el mismo paso hijo, sin duplicar casillas. Completar un tramo marca sus obligatorios y el paso pulsado, conserva los opcionales marcados y nunca completa automáticamente la comida ni descuenta inventario. Los opcionales con cantidad se preguntan al completar el bloque, no cada tramo; los de disponibilidad mantienen la regla de la sección 8.
- Los tramos se completan en orden y no se deshace uno con pasos posteriores completados. Deshacer el bloque devuelve su consumo una sola vez, conservando los tramos previos realizados; para corregirlos, primero deshacer la comida. Las versiones planificadas anteriores conservan sus recordatorios independientes hasta actualización explícita.
- Preparaciones aceptadas se programan como hijos propios de MiAgenda; duración inicial de 5 minutos editable.
- Las tarjetas del recetario, Inbox y Día comparten presentación desplegable cuando corresponda.
- Clasificación personal de recetas por las filas activas de Planificar, con varios tipos por receta. Crear una fila la ofrece como clasificación; renombrarla conserva sus relaciones; retirarla elimina solo esa clasificación, sin borrar recetas ni cambiar versiones de comidas.

## 6. Sugerencias y disponibilidad

- Calcular disponibilidad considerando alacena, porciones cocinadas y reservas de todos los planes pendientes pertinentes.
- Prioridad a fecha/hora más cercana; faltantes aparecen en los planes posteriores cuando recursos no alcanzan.
- Opcionales no impiden sugerir. Los obligatorios tienen prioridad sobre los opcionales al reservar inventario.
- Sin búsqueda, sugerir solo recetas clasificadas para la fila elegida, respetando el filtro de faltantes. Buscar por nombre o elegir «Mostrar todas las recetas» permite encontrar recetas de cualquier tipo y sin clasificación, manteniendo sus avisos de disponibilidad. La clasificación no restringe qué receta se puede planificar.
- Permitir mostrar recetas con pocos ingredientes faltantes; límite inicial de sugerencias de tres ingredientes faltantes configurable.
- Recalcular al agregar, cambiar o borrar un plan; ocultar calendario no libera sus reservas.
- A igual fecha/hora, priorizar el plan creado primero, con ID como desempate estable.
- Permitir reservar sobras previstas de una comida pendiente para planes posteriores, indicando de qué preparación dependen. No son porciones reales ni descuentan inventario; al completar se exigirán tandas realmente cocinadas. Recalcular estas dependencias al cambiar o retirar el plan de origen.

## 7. Planificador de comidas

- Tabla de una o dos semanas, lunes–domingo, con filas de comida editables/eliminables y hora predeterminada personal.
- Inicializar Desayuno, Comida y Cena como filas personales editables/eliminables. Al quitar una fila con comidas, ofrecer trasladarlas a otra fila o borrar sus planes, revisando todas las fechas y sin fusionar celdas ocupadas automáticamente.
- Durante la reconstrucción, habilitar primero planificación y programación; mantener bloqueado el completado de comidas y pasos de cocina hasta integrar consumos y sobras. Las preparaciones previas pueden completarse sin completar la comida ni consumir inventario.
- Una celda tiene como máximo un bloque activo, con una o varias recetas distintas. No agregar dos veces la misma receta al bloque; modificar sus porciones en la tarjeta existente.
- Sugerencias dentro del selector al agregar al bloque; mostrar aviso de faltantes en planes.
- Editar recetas, porciones, hora, fases y tiempos; completar/deshacer directamente desde cada bloque.
- Cocinar se elige por receta; Comer y Lavar pertenecen al bloque. Sin cocinar una receta, sus porciones a cocinar son cero y no aporta ingredientes a Compras. El indicador de cocina del bloque resume si se cocina alguna receta. Defaults personales de comer/lavar modificables por instancia.
- Tiempo de cocina combinado (solo recetas que se cocinarán) = receta más larga + mitad de la suma de las otras; redondear hacia arriba al siguiente múltiplo de cinco minutos, con override por bloque.
- Porciones a cocinar y a comer iguales por defecto, independientes después.
- Al planificar, proponer piezas redondeadas hacia arriba y permitir editar cantidades reales por receta/comida, incluidas fracciones; gramos y mililitros siguen proporcionales. Sumar los usos del mismo ingrediente antes del redondeo, separando obligatorios y opcionales. Disponibilidad, Compras, pasos y consumo usan la cantidad elegida; el recetario no cambia. Cantidades manuales se mantienen al cambiar porciones y pueden volver al cálculo automático. Solo disponibilidad sigue sin cantidad.
- Copiar semana anterior solo cuando destino está vacío; revisión automática de recetas copiadas. Copiar configuraciones, no completados/consumos; recalcular disponibilidad y compras y ofrecer preparaciones previas nuevas.
- Botón de borrar comidas en cada semana. Retirar comidas consumidas no devuelve inventario; mantener origen/consumo mínimo necesario.

## 8. Completar y deshacer

- Fuente única de completado de cada actividad/instancia.
- Tarea normal: círculo de principal completa hijos; todas las casillas completadas completan principal. Marcas individuales por defecto afectan solo la instancia.
- Deshacer una principal normal desmarca sus hijos. Agregar una subtarea pendiente vuelve la principal a pendiente. Las preparaciones previas no completan automáticamente una comida.
- Comida paso a paso: terminar preparaciones obligatorias completa el bloque; opcionales marcados determinan uso. Preparaciones previas no descuentan ingredientes por sí mismas.
- Comida desde círculo: preguntar solo por opcionales con cantidad que se descontará; los de Solo disponibilidad y sin ingrediente se marcan paso a paso si se desean, conservando sus marcas actuales al completar desde el círculo sin asumir que se usaron. Completado conjunto de obligatorios, sin modificar la disponibilidad al consumir.
- Completar comida registra movimientos por lo cocinado, tandas y usos de porciones en una transacción. No consumir ingredientes dos veces.
- Registrar el completado contra existencias reales, aunque una comida anterior las tuviera reservadas provisionalmente; recalcular faltantes de los planes pendientes después. Las reservas no impiden registrar lo realmente realizado.
- Para comer, usar primero las porciones recién cocinadas por ese bloque y después las tandas reales más antiguas de la misma receta, mostrando su origen y versión. Nunca consumir porciones solamente previstas.
- Sobras por receta/tanda, no saldo genérico de porciones de diferentes alimentos.
- Deshacer devuelve exactamente lo descontado y revierte consumos; bloquear si una comida posterior ya consumió sobras de esa cocinada, indicando las dependencias.
- Faltan sobras con Cocinar desactivado: mostrar falta cocinar y/o ingredientes; no activar Cocinar automáticamente.
- Mover conserva pasos realizados. Ofrecer reajustar preparaciones pendientes, sin reemplazar horarios manuales silenciosamente.
- No añadir función Desechar sobras.

## 9. Compras

- Agrupar faltantes de todos los planes pendientes con Cocinar activo, de cualquier semana, por ID de ingrediente. Sin Cocinar no se añaden ingredientes a Compras aunque falten sobras; mostrar el aviso correspondiente en Planificar.
- Ingredientes por disponibilidad: una sola necesidad por ID cuando no hay existencias; comprar marca Tengo, sin cantidad calculada. Deshacer restaura la disponibilidad anterior solo si no hubo cambios manuales ni compras posteriores sin revertir.
- Desglose obligatorio/opcional cuando un ingrediente participa de ambos modos.
- Cantidad necesaria, cantidad elegida y cantidad comprada son distintas. Recalcular no borra ajustes del usuario.
- Artículos libres al final, eliminación con X y controles de compra alineados.
- Marcar individual o todo comprado; cantidades reales aumentan alacena una sola vez.
- Comprados en panel desplegable con los últimos 30 días; deshacer individual usa lo registrado y evita saldos negativos. Este límite de visualización no borra recibos ni movimientos necesarios.
- Texto libre no alimentario no crea un ingrediente alimentario automáticamente.
- Recibos tienen ciclo de vida independiente del detalle de agenda; futura relación con presupuesto/finanzas se diseña después.

## 10. Integridad

- IDs internos estables, tipo/propietario fijos y máximo un nivel de subtareas.
- Claves de propietario en relaciones; consultas siempre autorizadas por sesión.
- Programación, estado común y extensiones especializados sin copias editables de completado en otras tablas.
- Revisión esperada para guardados simultáneos e idempotencia por comando/usuario/payload.
- Transacciones cortas para estado, consumo, compra y dependencias; ninguna llamada a Calendar.
- Todos los cambios de inventario siguen el mismo protocolo y generan movimientos verificables.
- No negativos, dobles compras, dobles consumos, dobles reversiones ni doble uso de una sobra.
- Historial mínimo no depende de cascadas que eliminen una actividad visual.

## 11. Recurrencia y sincronización entre dispositivos

- Motor propio de reglas, ocurrencias y excepciones con biblioteca/formato estándar evaluado.
- Calcular ventanas solicitadas, no crear indefinidamente instancias futuras.
- Materializar estado de ocurrencias modificadas/completadas/con hijos u otros datos propios.
- Identidad de familia y clave de ocurrencia original permanecen al mover, editar o dividir una serie.
- «Solo esta», «Esta y siguientes» y «Toda la serie» incluyen las excepciones según alcance.
- Subtareas se relacionan por clave estable de definición, nunca por texto; marcas por alcance no crean pasos faltantes.
- Programar, cambiar o quitar horario de una subtarea recurrente ofrece «Solo esta», «Esta y siguientes» y «Toda la serie». La regla guarda hora/duración y diferencia de días respecto a la principal (mismo día, anterior o posterior), sin materializar indefinidamente. Su calendario se hereda de cada principal programada; sin horario de la principal se permite elegirlo.
- Horarios por alcance reemplazan los de las subtareas pendientes del alcance, incluidas excepciones; completadas conservan horario e historial. Identificar por clave estable aunque cambie el nombre; omitir las ausentes/eliminadas sin recrearlas. Quitar horario conserva casilla y progreso, desactivando Conservar/Destacar donde se retira.
- Las horas son fijas, no dependen de completar otro paso. Se permiten empalmes sin desplazar otras actividades. Arrastrar sigue afectando solo esa instancia. Cambiar frecuencia conserva la definición de horarios de las subtareas para las nuevas repeticiones.
- Vencidas pendientes siguen pendientes; no inferir automáticamente fracaso/completado.
- Cambiar frecuencia o fecha final conserva completadas, pendientes pasadas e instancias futuras con cambios propios, manteniendo sus identidades y pertenencia a la serie. Solo sustituye futuras pendientes sin modificaciones; las nuevas empiezan pendientes. Una excepción conservada corresponde a esa fecha concreta, no se repite cada semana. Ofrecer «Esta y siguientes» y «Toda la serie», con resumen antes de confirmar.
- Día 31 o 29 de febrero inexistente: usar último día del mes, conservando el día original como ancla para repeticiones posteriores.
- Usar la copia local descargada incluso con internet. Al entrar, comprobar únicamente identidad/revisión y ofrecer actualizar si hay novedades; no descargar cambios ajenos sin aceptación. Volver después de cinco minutos en segundo plano se considera una nueva entrada. Sin sondeo periódico, lecturas al recuperar foco ni descargas automáticas al reconectar. Las escrituras conectadas mantienen la copia coherente; la actualización completa también puede pedirse manualmente.
- No existe sincronización con Google Calendar, syncToken ni reconciliación externa.

## 12. Qué se guarda y dónde

- Google: identidad usada para acceso. MiAgenda no guarda tareas ni recetas en Google.
- PostgreSQL: cuentas internas, sesiones, calendarios propios, actividades, horarios, reglas, excepciones, recetas, inventario, tandas, compras y evidencias mínimas.
- Por usuario: actividades, calendarios, preferencias, recetas, personalizados, alacena, planes, compras, movimientos y seguimiento elegido.
- Compartido: catálogo administrado de ingredientes comunes. No compartir recetas, saldos ni movimientos por defecto.
- Copia local posterior: últimas consultas e Inbox permitido sin conexión, aislada por usuario; no autoridad contable.

## 13. Celular, sin conexión y widget

- Web primero y adaptable a celular; despliegue después de estabilizar núcleo.
- Implementar por bloques: consulta local, altas de Inbox y después edición/completado de tareas normales y subtareas. Las acciones habilitadas se guardan en IndexedDB incluso con internet y se envían únicamente al pulsar Sincronizar. Actualizar copia envía primero los pendientes y después descarga; no sustituye una cola pendiente si falla el envío.
- Guardar una sola cuenta activa por dispositivo, limpiar su copia al cerrar sesión/cambiar de cuenta y nunca almacenar credenciales en ella. Con cambios pendientes, pedir sincronizar antes de cerrar sesión; descartar exige confirmación explícita. Si un envío tiene resultado incierto, confirmar primero mediante el mismo lote idempotente. Pantallas públicas en caché y datos privados en IndexedDB; no guardar HTML privado ni respuestas de autenticación en el service worker.
- Descarga inicial acotada: semana anterior y cinco semanas desde el lunes actual para Agenda/Planificar, Inbox completo, recetas, alacena, compras y destacados del año actual. Fechas adicionales requieren descarga explícita y se limitan a ocho consultas guardadas. La retención de cinco días la decide el servidor, no el reloj de la copia local.
- Cola local: crear Inbox o tareas normales programadas, editar nombre/descripción, agregar/editar/eliminar subtareas, completar/deshacer y agendar/cambiar/quitar horarios de tareas normales e hijos, solo la instancia elegida. Incluye arrastrar y ajustar duración en Agenda, usando calendarios descargados y heredando el calendario de la principal. En conflictos se elige la versión; solo se reemplazan horarios modificados localmente. Crear calendarios, borrar principales, acciones de serie, comidas y operaciones de Cocina requieren conexión; enviar los cambios locales antes de esas operaciones.
- Mostrar cantidad de cambios sin enviar y estado por actividad. Persistir el lote antes del envío y conservarlo ante una respuesta incierta; recibo y efectos atómicos en servidor, con comprobación del propietario y de las revisiones de principal/hijos.
- Si el servidor cambió la misma actividad, preguntar conservar mis cambios o usar servidor. Si ya no existe, ofrecer recuperar en Inbox como tarea nueva con sus subtareas o descartar sus cambios. No sobrescribir en silencio. El completado conserva la hora de la acción local, limitada al presente del servidor ante un reloj adelantado; la retención sigue siendo autoridad del servidor.
- API independiente de la pantalla. Widget nativo posterior, plataforma pendiente; no prometer que una PWA trae widget nativo.

## 14. Arquitectura y stack

Una aplicación full-stack con módulos internos:

```text
Web / cliente móvil futuro
          ↓
API autenticada y contratos comunes
          ↓
Servicios de actividad/programación/recurrencia
Servicios de Cocina/inventario/compras
          ↓
Prisma → PostgreSQL

Google → autenticación solamente
```

Conservar Next.js, React, TypeScript, PostgreSQL y Prisma. Revisar versiones/bibliotecas al implementar, respetando las guías locales de Next.js. No introducir microservicios, Redis ni infraestructura no justificada por el uso personal.

## 15. Seguridad

- Inicio Google con biblioteca mantenida, validación de flujo y sesión segura. Sin permiso Calendar.
- Identidad proveedor/sujeto única; no unir cuentas automáticamente por correo.
- Autorización de propietario en cada operación, incluyendo relaciones padre/hijo y referencias de cocina.
- Protección de mutaciones, límites de entrada y limitación de solicitudes apropiada.
- Credenciales fuera de Git y del cliente; logs sin secretos.
- Separación de caché por usuario y política de cierre de sesión cuando se implemente offline.

## 16. Reconstrucción por bloques

1. Aprobar este contrato y modelo; actualizar `PROJECT.md`.
2. Conservar referencia recuperable actual; preparar base aislada, esquema físico y acceso Google solo login.
3. Actividad, Inbox, subtareas, completado e idempotencia.
4. Calendarios propios, programación y adaptación de vistas.
5. Recurrencias, alcances y retención.
6. Recetas, comidas, tandas e inventario.
7. Compras y concurrencia con alacena/cocina.
8. Retirar compatibilidades de Calendar y cerrar documentación/calidad.
9. Despliegue web móvil y offline limitado. Dashboard/módulos/widget después.

Reutilizar piezas evaluadas; no completar adaptadores antiguos solo por haberlos empezado. Datos actuales de prueba no requieren migración funcional. No borrar base/proyecto actual para comenzar otra base sin conservar referencia recuperable.

## 17. Forma de trabajar

- `PROJECT.md` es la base en cada prompt; sus cambios requieren acuerdo del usuario.
- Antes de implementar una solicitud, preguntar dudas/casos que requieren decisión y proponer bloques cuando convenga.
- Entregar bloques revisables con explicación y pasos de comprobación. No implementar todo de una vez.
- Código actual no se presume correcto por haber sido creado antes; conservar contratos y reglas útiles, verificar al adaptarlos.
- No añadir ni ejecutar pruebas salvo solicitud explícita de pruebas/verificación; acordar esa verificación para los bloques críticos.

## 18. Decisiones acordadas y precedencia

Esta sección y la 19, aprobadas el 2026-10-03, prevalecen sobre documentos históricos. Auditoría y documentos de transición Google permanecen como referencia del estado anterior, no como instrucciones de continuar ese diseño.

- Reconstrucción del núcleo/esquema conservando interfaz y reglas útiles; una sola app full-stack.
- Google únicamente para acceso. Motor/calendarios/recurrencias propios.
- Actividad estable, tipo fijo, un nivel de subtareas; Inbox sin comidas.
- Base `Activity` común para Inbox, Día/Hoy, Agenda, comidas y acciones de futuros módulos; sin modelos independientes de tarea por pantalla o módulo.
- Conservar/Destacar requieren programación; activar Destacar activa Conservar. Después se pueden cambiar independientemente.
- Retención: completar no borra; cinco días desde completado y nunca antes del fin, salvo Conservar. Pendientes no se purgan automáticamente. La serie no se elimina por purgar una ocurrencia.
- Posponer purga de una principal mientras tenga hijos pendientes/futuros/conservados que impidan retirarlos, conservando la relación.
- Conservar una principal también protege sus subtareas de la purga mientras esa protección siga activa.
- Los planes mantienen revisión de receta; editar recetario no los cambia salvo actualización explícita de una comida pendiente.
- Retener evidencia mínima necesaria por consumo/sobras/seguimiento selectivo, independiente del detalle de agenda. No convertirlo en archivo permanente de todas las tareas.
- Agenda y Cocina conservan superficies separadas y calendario común filtrable. Semana Agenda domingo–sábado; planificador lunes–domingo.
- Seguimiento de ingredientes personal por cantidad o disponibilidad, con recibos diferenciados y conservación del historial al cambiar modo.
- Catálogo común, personalizados y stock privados; equivalencias humanas de receta, unidades canónicas de stock.
- Usuarios pocos, preferir bajo costo; no prometer cuotas gratuitas suficientes sin medir.
- Web primero, offline inicial de consulta/Inbox, widget posterior.
- Finanzas/ejercicio/dashboard futuros se conectan a la misma base; sus datos especializados no se fuerzan a ser actividades.

## 19. Modelo y operaciones de referencia

El modelo lógico aprobado está en `docs/MODELO_OBJETIVO.md`. Cualquier cambio posterior requiere acuerdo del usuario y se refleja en estas reglas y en ese modelo.

### 19.1 Entidades comunes

User, identidad/sesión, Calendar, Activity, ActivitySchedule, RecurrenceSeries, SeriesSegment, definición de subtarea, excepción, instrucción de progreso y recibo idempotente.

Inbox y Agenda son consultas sobre la misma identidad. El vínculo con Google Calendar, EventOverlay y recibos de traslado no forman parte de la nueva arquitectura.

### 19.2 Entidades de Cocina

Ingredient, preferencias de catálogo, saldo/movimiento de inventario, Recipe/Revision/Step, MealSlot, MealBlock, MealRecipe, datos de paso, CookedBatch y PortionUse.

El bloque es una Activity `meal`; sus pasos son hijos directos con origen por receta. Versiones/snapshots protegen planes y consumos de cambios del recetario.

### 19.3 Compras e historial

Necesidad calculada, entrada editable y recibo efectivo separados. Referencias de consumo y reversión únicas; no borrar evidencias por eliminar una tarjeta del calendario.

### 19.4 Comandos y consultas

Crear/editar, programar/quitar horario, establecer completado, conservar/destacar y eliminar delegan en servicios comunes con extensión por módulo. Idempotencia y revisión esperada en mutaciones. Lecturas por rango y propietario; proyección global pertinente para cocina sin carga de todo el historial por cada paso.

### 19.5 Retención recurrente

Una ocurrencia retirada conserva exclusión mínima y no reaparece al expandir reglas. Pendientes antiguas se siguen mostrando. No materializar el futuro completo ni borrar una regla por limpieza de instancias.

### 19.6 Decisiones resueltas

Confirmadas por el usuario: usar último día del mes si no existe la fecha recurrente; posponer purga de una principal con hijos dependientes; conservar revisión de cada receta planificada hasta actualización explícita.

También aprobadas: deshacer principal normal desmarca hijos; agregar hijo pendiente reabre principal; preparaciones previas no completan automáticamente comida; política de calendario de hijos. Al eliminar un calendario ocupado se puede trasladar o borrar contenido, respetando reglas de módulos y consumos.

El siguiente bloque diseña el esquema físico y las migraciones sobre una base aislada. La aprobación documental no significa que la nueva base ya exista ni ordena borrar la actual o implementar todos los bloques de una vez.
