# Auditoría de arquitectura de MiAgenda

Fecha de revisión: 2026-10-03. Evaluación del código presente en el directorio de trabajo, incluyendo cambios sin confirmar en Git.

## 1. Dictamen

**Recomiendo reconstruir el núcleo y el esquema de datos, conservando el stack, las reglas de negocio aprovechables y gran parte de la interfaz.** Hacerlo en una base aislada y por bloques verificables, con el estado actual conservado como referencia recuperable.

No recomiendo seguir añadiendo adaptadores entre los modelos actuales. Tampoco recomiendo borrar todo y volver a diseñar cada pantalla: ya existe trabajo útil y decisiones de producto que deben conservarse.

El cambio decisivo es que MiAgenda será la autoridad de actividades, fechas y recurrencias. Google deja de ser necesario. Su retirada afecta identidad, autenticación, programación, recurrencia, retención y varias operaciones de cocina; no se resuelve desinstalando `googleapis`.

Esta es una recomendación de diseño, no una autorización para reconstruir ni borrar datos. Durante la auditoría no se modificó código de la aplicación, `PROJECT.md`, migraciones ni datos.

## 2. Alcance y límites

- Lectura de `PROJECT.md`, decisiones posteriores del usuario, documentos de transición, esquema Prisma, migraciones, configuración, dependencias, scripts y pruebas existentes.
- Inventario de 108 archivos de código bajo `src`, excluyendo código generado, y 36 rutas API. Revisión de los flujos principales de agenda, Inbox, subtareas, recurrencia, cocina, inventario, compras y retención.
- Inspección estática de importaciones, dependencias entre servicios, consultas y controles de acceso. 36 archivos importan directamente el cliente Calendar o tipos/cliente de `googleapis`; el impacto indirecto es mayor.
- Consulta a la base configurada en Neon dentro de una transacción de solo lectura para comprobar tablas y migraciones. No se modificaron registros.
- No se ejecutaron pruebas, compilación, auditoría npm ni pruebas funcionales del navegador. Por ello, este informe no certifica que todas las funciones actuales pasen pruebas ni que todas las dependencias estén libres de vulnerabilidades.
- Los problemas descritos como riesgos se deducen del código; no todos se reprodujeron mediante ejecución. La ausencia de `activity_operations` sí se confirmó en la base consultada.

## 3. Requisitos que cambiaron el diseño original

`PROJECT.md` todavía describe Google como autoridad. Las decisiones recientes del usuario cambian esa premisa, pero el documento no se ha actualizado porque requiere su aprobación.

| Cambio de producto | Consecuencia arquitectónica |
|---|---|
| Actividad independiente, exista o no en agenda | Identidad propia estable; agregar horario no crea otra tarea ni mueve su progreso entre almacenes |
| Inbox y subtareas programables | Inbox es una vista de actividades sin horario; un hijo puede tener horario aunque su principal no lo tenga |
| Una sola profundidad de subtareas | Restricción común en servicios y base, no distinta por pantalla |
| Recurrencias y alcances de cambio | Identidad de serie y de instancia; las excepciones conservan pertenencia a la serie |
| Bloques de comida con varias recetas y fases | Una actividad de comida con extensión especializada; recetas dentro del bloque no implican varios niveles de subtareas |
| Cocinar porciones distintas de las que se comen | Tandas, reservas de sobras y consumos con dependencias reales |
| Prioridad cronológica de ingredientes | Una proyección compartida por planificación, sugerencias y compras, que incluya los planes pertinentes de todas las semanas |
| Ingredientes opcionales ligados a pasos | Definición de pasos, cantidades agregadas y evidencia del uso al completar |
| Preparaciones previas aceptadas por el usuario | Hijos programables con propuesta de horario y estado independiente |
| Vistas Día, Semana, Mes y Año propias | MiAgenda ya construyó su interfaz de calendario; no se sustituye una vista incrustada de Google |
| Conservar, Destacar y retención | Reglas comunes de actividad; destacar activa conservar, sin equivalencia inversa |
| Finanzas, ejercicio y dashboard futuros | Extensiones por módulo y movimientos/mediciones separados de la actividad |
| Consulta e Inbox sin conexión | IDs estables, comandos idempotentes y sincronización limitada de cambios locales |
| Estadísticas selectivas tras borrar detalles | Registro mínimo independiente de la retención visual, únicamente para seguimiento elegido |

El diseño inicial era razonable para una capa sobre Google. Las nuevas necesidades requieren otro centro de autoridad. Eso explica buena parte de la complejidad acumulada; no significa que todo lo anterior carezca de valor.

## 4. Hallazgos prioritarios

### A1. Transición de persistencia incompleta — prioridad alta

La migración `20261004150000_activity_foundation` está aplicada y existe `activities`. La siguiente, `20261004160000_activity_task_adapters`, está presente en el repositorio pero no figura aplicada; **no existe `activity_operations`** en la base consultada.

El código ya consulta ese modelo en `task-unschedule.ts`, `task-activity.ts`, `inbox.ts` y otros servicios. Inbox intenta recuperar operaciones al cargar. La ruta puede fallar aun sin que el usuario esté realizando un traslado.

Evidencia: `src/app/api/inbox/route.ts:42`, `src/lib/task-unschedule.ts:107`, `src/lib/prisma.ts:24`, esquema `ActivityOperation`.

No recomiendo aplicar automáticamente esa migración para cerrar el trabajo: introduce adaptadores y triggers entre representaciones antiguas ligadas a Google. Debe evaluarse como trabajo de transición que probablemente deja de ser necesario en la nueva base.

### A2. Varias representaciones editables de una actividad — prioridad alta

Existen `InboxItem`, `EventOverlay`, `ScheduledSubtask`, `Activity` y listas de pasos en JSON. La identidad y el progreso se distribuyen entre esos registros. `MealPlan` y su overlay también contienen estado de completado.

La base común está iniciada, pero todavía no es la autoridad única. Los documentos de implementación lo reconocen. La migración pendiente agrega sincronización bidireccional mediante triggers; mantiene compatibilidad, pero perpetúa varias representaciones que habría que entender para cada cambio.

Consecuencia: mover una tarea, quitar horario, cambiar una serie o modificar una subtarea necesita reconciliar identidades y estados. Cada módulo futuro heredaría esa dificultad.

### A3. Google está dentro de operaciones de negocio — prioridad alta

Fechas de comidas, calendarios, programación de subtareas y recurrencia usan IDs y peticiones de Google. `MealPlan` requiere claves externas y `CalendarSubscription` representa calendarios remotos.

Hay llamadas remotas dentro de transacciones con bloqueo por usuario, por ejemplo en `src/app/api/meal-blocks/route.ts` y `src/lib/recurrence-change.ts`. Algunos límites llegan a 30–60 segundos.

Una transacción PostgreSQL puede revertir sus escrituras, pero no una modificación que ya se realizó en Google. Los recibos, compensaciones y reanudaciones intentan resolver esa separación y añaden latencia y estados intermedios.

Con un motor propio, esas operaciones pueden ser transacciones locales más cortas. La recuperación genérica de comandos sigue siendo útil; la recuperación específica de Google deja de ser necesaria.

### A4. Protección del inventario inconsistente — prioridad alta

Completar comidas y registrar compras usan transacciones y bloqueo cooperativo por usuario. En cambio, `src/app/api/pantry/[id]/route.ts:36` asigna una cantidad absoluta sin comprobar la revisión que vio el formulario; eliminar alacena tampoco sigue ese protocolo.

Ejemplo deducido del código: el formulario muestra 5 huevos; una compra incrementa a 12; un guardado posterior del formulario envía 6 y sobrescribe el resultado de la compra. El aislamiento por usuario no evita este cambio perdido.

Se necesita un protocolo para **todos** los escritores del inventario: transacciones, revisión esperada y control de concurrencia coherente. Un bloqueo consultivo solo coordina a los participantes que lo adquieren, como explica la [documentación de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

### A5. Leer pantallas puede sincronizar, escribir y recorrer mucho estado — prioridad media/alta

- Agenda refresca la red cada minuto mientras está visible; además existen temporizadores de estado en componentes de subtareas y pasos.
- Cargar Inbox recupera operaciones y realiza mantenimiento/reconciliación.
- Leer comidas sincroniza planes con Google antes de calcular disponibilidad.
- Actualizar compras planificadas sincroniza horarios y reescribe necesidades mediante POST.
- `readMealState` carga planes, overlays, ingredientes, inventario, tandas y usos del usuario. Hay búsquedas y filtrados repetidos sobre esos conjuntos.
- Completar un bloque puede volver a cargar estado para cada receta.

Evidencia: `src/app/agenda-view.tsx:518`, `src/app/components/subtask-schedule.tsx:62`, `src/app/components/meal-preparation-steps.tsx:31`, `src/lib/meal-state.ts:8`, `src/app/api/shopping-lists/planned/route.ts:18`.

No medí tiempos ni consumo de producción. Para pocos usuarios, esto no demuestra un problema de capacidad inmediata; sí contradice el objetivo de pocas consultas y escala con planes/subtareas más que con la información visible.

El reloj de la línea de hora actual puede seguir actualizándose localmente sin consultar la base. La disponibilidad debe considerar todos los planes pendientes relevantes: limitarla a la semana visible produciría cálculos incorrectos.

### A6. Historial y retención no están preparados para todos los módulos — prioridad alta para la nueva arquitectura

El ledger de inventario depende de `MealPlan` con borrado en cascada (`prisma/schema.prisma:588`). Eso puede servir al deshacer temporal original, pero no a movimientos financieros o estadísticas que deban sobrevivir al detalle de agenda.

Las tandas y usos ya preservan ciertos consumos mediante referencias anulables. Esa decisión es aprovechable. Sin embargo, al borrar una receta su referencia en planes pasa a null; la proyección entonces compara con `deleted:<planId>`, mientras una tanda anterior conserva el ID de receta como `recipeKey`. Las sobras pueden dejar de coincidir con planes que antes pertenecían a esa misma receta.

Evidencia: relación `MealPlan.recipe` con `SetNull`, `src/lib/meal-availability.ts:35` y `:39`, `src/lib/meal-portions.ts:95`, ruta de borrado de recetas.

Necesitamos identidad histórica y versión/snapshot de receta. Borrar una definición del recetario no debe borrar ni cambiar lo realmente preparado y consumido.

### A7. La restricción de un nivel no cubre todo el modelo antiguo — prioridad media

La nueva tabla de actividades impide más de un nivel. La lógica anterior de programación y eliminación recorre descendientes de subtareas programadas y utiliza referencias de padre en strings, sin una relación común obligatoria al padre.

Por ello, la regla nueva no es una garantía global mientras convivan ambos modelos. Debe ser una restricción del único modelo de actividades, aplicada también a planes y recurrencias.

### A8. Acoplamiento de servicios y componentes grandes — prioridad media

Hay un ciclo de importaciones entre `meal-step-links`, `meal-portions`, `meal-preparation`, `scheduled-subtask-lifecycle` y `scheduled-subtask-state`. Cambiar progreso, consumo o programación puede repercutir en los otros servicios.

`agenda-view.tsx` tiene 1.168 líneas y reúne carga de datos, fechas, varios modos de vista, arrastre, formularios y acciones de dominio. Existen tipos, utilidades de fecha y presentaciones de subtareas repetidos entre pantallas.

Conviene separar contratos comunes, servicios de aplicación, consultas y componentes. La cocina debe depender del núcleo de actividad y extender sus comandos, sin que el núcleo importe servicios de cada módulo formando ciclos.

### A9. Zonas horarias y solapamientos requieren trabajo — prioridad media

Hay formatos con `America/Mexico_City`, cálculos con fecha local del navegador y conversiones que fijan `-06:00`. Es un riesgo de navegación y límites de fecha al cambiar la zona del dispositivo; no se reprodujo en esta auditoría.

La vista semanal posiciona eventos por altura y hora, pero los contenedores ocupan el mismo ancho (`globals.css:401` y `agenda-view.tsx:1009`). Eventos simultáneos pueden superponerse; hace falta distribuirlos en columnas de solapamiento.

Un motor propio debe definir horarios con zona IANA, distinguir todo el día de eventos con hora y resolver recurrencias en la zona de la serie. No basta con agregar días a timestamps UTC.

### A10. La calidad de producción todavía no está demostrada — prioridad media

Hay cinco archivos de pruebas con casos de calendario, disponibilidad, inventario y porciones; son una buena base. No hay comando de pruebas en `package.json` ni flujo de CI localizado en el repositorio revisado. Faltan garantías automatizadas completas de recurrencia, conservación de identidad, aislamiento entre usuarios y retención combinada con dependencias.

Hay controles de sesión, origen y propiedad en los flujos revisados, cifrado de refresh tokens y variables locales excluidas de Git. Son puntos positivos. No constituyen una certificación de seguridad; no se identificó una implementación común de limitación de solicitudes.

La retirada de Google requiere sustituir autenticación, sesiones y recuperación de acceso, además del calendario. No conviene construir desde cero un sistema de contraseñas.

## 5. Qué conservar, adaptar y retirar

| Área | Evaluación |
|---|---|
| Next.js, React, TypeScript, PostgreSQL y Prisma | Conservar; no se encontró una razón arquitectónica para cambiar todo el stack |
| Vistas Día/Semana/Mes/Año y diseño de navegación | Conservar comportamiento y componentes aprovechables; adaptar contratos y separar responsabilidades |
| Captura rápida e Inbox | Conservar experiencia; cambiar persistencia a Activity y preparar IDs/idempotencia |
| Catálogo común y personalizados privados | Conservar regla, referencias por ID y normalización; reforzar permisos e identidad histórica |
| Proyección cronológica de comidas | Conservar algoritmo y casos; desacoplar entradas de Google y optimizar acceso al estado |
| Cálculo agrupado de compras y opcionales | Conservar reglas; separar necesidad calculada, cantidad elegida y compra efectiva |
| Tandas, usos y bloqueo al deshacer dependencias | Conservar concepto; reconstruir relaciones con la nueva identidad de actividad |
| Ledger y reversión exacta | Conservar concepto y condiciones; revisar ciclos de vida, escritores concurrentes y vínculos |
| Ajuste de 15 minutos y cocina redondeada a 5 | Conservar funciones puras y pruebas existentes |
| Formularios de recetas y pasos | Conservar experiencia y agregación; versionar definiciones y snapshots de planes |
| Base Activity y claves de propietario | Conservar el diseño útil; no asumir que la implementación parcial es el esquema definitivo |
| Cliente Google, tokens de Calendar y reconciliación remota | Retirar al sustituir los flujos; ya no forman parte del objetivo |
| Triggers y adaptadores entre Inbox/overlays/Activity | Descartar como arquitectura final; no continuar esa transición solo para terminar lo comenzado |
| Recibos de traslados y cambios de serie en Google | Sustituir por comandos locales; conservar idempotencia sin estados remotos innecesarios |
| Plantillas y rutas antiguas sin uso de producto | Revisar referencias y retirar cuando se confirme que ningún flujo aprobado depende de ellas |

La reutilización no significa copiar cada archivo intacto. Se conserva una función pura o un componente cuando su contrato y sus reglas se ajusten al nuevo modelo.

## 6. Arquitectura propuesta

Una sola aplicación con módulos internos definidos, sin microservicios.

```text
Web ahora / cliente móvil después
                 ↓
       API autenticada común
                 ↓
   Comandos y consultas de aplicación
      ├─ Actividades y subtareas
      ├─ Calendarios y recurrencia
      ├─ Cocina e inventario
      └─ Compras
                 ↓
        Prisma + PostgreSQL

Después: Finanzas / Ejercicio / Dashboard
extienden esa base y consumen sus contratos.
```

### Base común

- **Activity:** ID propio permanente, propietario, tipo fijo, título, descripción, principal opcional, orden, completado, revisión y fechas de creación/cambio. Máximo un nivel de hijos.
- **Schedule:** horario opcional de una actividad, calendario propio y zona. Una subtarea se programa conservando su ID y progreso.
- **Inbox:** consulta de tareas principales sin horario; no es una segunda entidad a la que se trasladan copias. Los hijos sin horario se muestran con su principal.
- **Calendar:** capa que el usuario puede crear y activar/desactivar, con una asociación opcional a un módulo. El nombre no decide si un elemento consume inventario.
- **Conservar/Destacar:** solo disponibles con fecha programada. Al activar Destacar se activa Conservar; posteriormente se pueden ajustar por separado. Quitar horario debe limpiar o resolver esos atributos según la regla aprobada.
- **Módulos:** agregan propiedades y acciones sobre una actividad. Completar una comida invoca su servicio especializado en la misma transacción; completar una tarea común no toca ingredientes.

**No todo registro de la base debe convertirse en Activity.** Una receta del recetario es una definición reutilizable; al planearla se crea una instancia de comida. Ingredientes, movimientos, precios, cuentas y mediciones son datos especializados, aunque se vinculen a actividades. Compartir una tarjeta visual no obliga a compartir la misma entidad de persistencia.

Para comidas con dos recetas y un solo nivel de subtareas: el bloque es la actividad principal; sus pasos son hijos y llevan metadata de la receta correspondiente. Los elementos de receta del bloque son datos de agrupación, no padres intermedios que introduzcan nietos.

### Recurrencia

- Guardar reglas y expandir solo el rango solicitado; no generar de antemano una fila por día de toda la vida de la serie.
- Materializar estado de una instancia cuando se modifica, completa, programa un hijo, conserva o destaca.
- Mantener identidad lógica de serie incluso tras una excepción o división de «esta y las siguientes».
- Identificar instancias por su ocurrencia original: moverla de día no crea una segunda instancia.
- Mantener excepciones de eliminación y una estrategia de compactación para que la retención no haga reaparecer una instancia borrada.
- Las tareas vencidas pendientes siguen pendientes. No inferir incumplimiento ni completado automáticamente.

Las reglas deben basarse en un formato estándar y una biblioteca evaluada, no en un parser casero. [RFC 5545](https://www.rfc-editor.org/info/rfc5545/) proporciona las reglas y conceptos de excepciones/identidad recurrente. La elección de biblioteca requiere revisión específica antes de implementar.

### Cocina, compras e historial

- Definiciones/versiones de recetas y snapshots en cada plan; cambiar el recetario no altera lo ya consumido.
- Una proyección cronológica compartida reserva ingredientes y sobras para planes pendientes. Completar registra consumos reales; planear no descuenta stock.
- Recalcular después de cambios pertinentes, incluyendo planes posteriores afectados aunque estén en otra semana.
- Historial de movimientos y recibos de compra separado del detalle temporal de agenda. Las reversiones se vinculan al movimiento original y son únicas.
- Comprar y consumir continúan siendo acciones diferentes. Compras futuras podrán llevar costo real, y los paquetes/precios podrán estimar presupuesto sin alterar la unidad canónica del inventario.
- No borrar automáticamente evidencias que sostienen sobras disponibles, dependencias o movimientos financieros. Se compactan cuando dejan de ser necesarias.

### Pocas consultas y trabajo sin conexión limitado

- Consultas por rango con índices y respuestas comunes, evitando cargar todo el historial en cada pantalla.
- Mutaciones invalidan solo datos afectados; refrescar al abrir, volver al foco, reconectar o solicitar actualización. Consultar solo al modificar no permite descubrir cambios de otro dispositivo; esos puntos de actualización resuelven ese caso sin sondeo constante.
- Usar revisión esperada para evitar guardados obsoletos; un ID de comando hace que reintentar no duplique compras, tareas ni consumos.
- Después: copia local de consulta e Inbox con cola de altas. No incluir inicialmente consumo de inventario ni edición de series sin conexión.
- Una opción adecuada para datos estructurados locales es [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). Debe aislarse por usuario y limpiarse al cerrar sesión según la política acordada.
- La preparación de contratos e idempotencia es temprana; la implementación sin conexión, despliegue y widget pueden ser fases posteriores.

### Estadísticas mínimas

Solo actividades/calendarios o módulos elegidos aportan seguimiento. La retención de cinco días elimina el detalle de actividad cuando corresponde, pero permite conservar una contribución mínima y un agregado diario de lo que se decidió medir.

No es necesario guardar títulos, subtareas y descripciones de todas las actividades para una gráfica. Sí hay que definir cómo corregir una contribución al deshacer y distinguir cancelación, pendiente y resultado. El detalle y la evidencia contable tienen ciclos de vida diferentes.

## 7. Stack actual

Versiones declaradas, sin comprobación reciente de vulnerabilidades:

| Pieza | Versión |
|---|---|
| Next.js | 16.3.8 |
| React / React DOM | 19.2.8 |
| TypeScript | 5.9.3 |
| Prisma / cliente / adaptador pg | 7.10.0 |
| PostgreSQL driver `pg` | 8.23.1 |
| NextAuth | 4.24.15 |
| Adaptador Prisma de NextAuth | 1.0.7 |
| `googleapis` | 182.0.0 |

Hay overrides de dependencias en `package.json`. Se deben volver a evaluar junto con el lockfile cuando se sustituya autenticación y se quite Google; no asumir que son necesarios para siempre ni retirarlos sin comprobar el árbol resultante.

Mantendría Next.js/React/TypeScript/PostgreSQL/Prisma. Elegiría una solución de autenticación mantenida que permita entrar sin Google. No hay necesidad demostrada de añadir Redis, un servidor independiente, un bus de eventos o infraestructura para miles de usuarios.

## 8. Comparación de caminos

| Opción | Ventajas | Riesgos | Dictamen |
|---|---|---|---|
| Modificar gradualmente el modelo actual con más adaptadores | Mantiene ejecución del prototipo durante la transición | Muchas compatibilidades, doble estado y limpieza posterior; conservar datos de prueba aporta poco valor | Poco conveniente con datos desechables |
| Reconstruir núcleo/esquema y adaptar piezas útiles por bloques | Una autoridad clara; aprovecha interfaz y reglas ya acordadas; permite revisar cada entrega | Requiere cerrar diseño y volver a verificar flujos al conectarlos | **Recomendada** |
| Reescribir toda la app y cambiar de stack | Libertad completa | Rehacer vistas y reglas que ya sirven; más riesgo de olvidar comportamiento, sin evidencia de que el stack sea el problema | No justificada |

No doy porcentajes de reutilización ni tiempos exactos: sin implementar y verificar el nuevo contrato serían estimaciones poco fiables.

## 9. Orden recomendado de reconstrucción

1. **Contrato de producto y modelo.** Aprobar la nueva autoridad y actualizar `PROJECT.md`; cerrar entidad común, recurrencia, retención y acceso. Entrega: modelo y reglas concretas, todavía sin funcionalidades nuevas.
2. **Base aislada y acceso.** Conservar el estado actual recuperable; preparar esquema limpio en otra base/rama de Neon. No borrar el historial de migraciones de la base actual. Incorporar sesiones y aislamiento de usuarios.
3. **Actividad, Inbox y subtareas.** CRUD, completado, identidad estable, un nivel y controles de revisión/idempotencia. Comprobar que repetir un comando no duplica y que usuarios distintos no acceden a datos ajenos.
4. **Calendarios propios y programación.** Programar/quitar horario en principales e hijos; adaptar Día/Semana/Mes/Año y arrastre. Comprobar horarios, solapamientos y conservación del progreso al mover.
5. **Recurrencia y retención.** Alcances, excepciones, subtareas por instancia, Conservar/Destacar y purga sin regeneración. Comprobar series modificadas y pendientes vencidas antes de conectar más módulos.
6. **Cocina e inventario.** Adaptar definiciones, pasos, bloques, tandas y consumos; retirar ciclos y conexiones Google. Comprobar varias recetas, opcionales, sobras reservadas y deshacer con dependencias.
7. **Compras.** Necesidades de todos los planes, artículos libres, cantidad comprada, compra individual/global y reversión. Comprobar simultaneidad con cocina y cambios directos de alacena.
8. **Cierre del reemplazo.** Retirar rutas/modelos/dependencias Google y compatibilidades; revisar documentación, migraciones, seguridad y automatización de pruebas.
9. **Uso fuera de local.** Despliegue web móvil, consulta local e Inbox sin conexión. Dashboard/seguimiento y widget se añaden después sobre contratos estables.

Cada bloque debe entregar algo revisable y sus casos de aceptación. Las pruebas propuestas aquí son trabajo futuro; no se ejecutaron durante esta auditoría.

## 10. Decisiones pendientes antes de implementar

1. **Acceso sin Google:** elegir si prefieres un enlace/código por correo, passkey o usuario/contraseña mediante una solución mantenida. Hay que comparar recuperación, costo y comodidad antes de escoger proveedor o biblioteca.
2. **Reglas de fechas excepcionales:** decidir qué ocurre con el 29 de febrero en años no bisiestos y con recurrencias mensuales del día 31. No asumir un cambio al último día del mes sin indicarlo.
3. **Seguimiento mínimo:** definir qué se mide primero y cuánto se conserva. Ya está acordado que el seguimiento es selectivo; no hace falta implementar un dashboard ahora.

La primera aprobación importante es el camino de reconstrucción y el modelo resultante. Ninguna de estas propuestas exige volver a implementar toda la aplicación de una vez.
