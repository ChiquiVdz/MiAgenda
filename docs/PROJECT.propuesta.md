# Proyecto: MiAgenda — actividades y calendario propios con módulo de cocina

**DISEÑO APROBADO el 2026-10-03.** Este contrato sustituye el diseño basado en Google Calendar. Describe el objetivo de la reconstrucción; no afirma que ya esté implementado. `PROJECT.md` es la fuente principal; esta copia registra la propuesta aprobada.

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
- Guardar cantidades crea un ajuste verificable y evita sobrescribir cambios concurrentes. Guardar permanece desactivado si el formulario no cambió.
- Retirar ingrediente usado ofrece sustitución, creación de sustituto o eliminación de referencias con explicación de efectos. No alterar el catálogo global de otros usuarios ni destruir consumos reales.

## 5. Recetas y pasos

- Una receta es una definición reutilizable, no una tarea que se completa en el recetario.
- Nombre, porciones base, duración y pasos estructurados; cada paso admite cero o un ingrediente, cantidad, equivalencia y marca opcional.
- Los ingredientes se obtienen de los pasos; sumar cuando se repiten, evitando introducirlos dos veces.
- Cantidades expresadas para las porciones base y escaladas una vez al planear.
- Cada comida planificada conserva versión/snapshot de la receta; lo completado nunca se reescribe por una edición del recetario.
- Editar el recetario no actualiza planes existentes automáticamente. Una comida pendiente puede actualizarse expresamente, recalculando sus efectos.
- Un paso puede proponer preparación previa con anticipación. Se ofrece al planificar inicialmente sin seleccionar; el usuario decide y cambia horario/duración.
- Preparaciones aceptadas se programan como hijos propios de MiAgenda; duración inicial de 15 minutos editable.
- Las tarjetas del recetario, Inbox y Día comparten presentación desplegable cuando corresponda.

## 6. Sugerencias y disponibilidad

- Calcular disponibilidad considerando alacena, porciones cocinadas y reservas de todos los planes pendientes pertinentes.
- Prioridad a fecha/hora más cercana; faltantes aparecen en los planes posteriores cuando recursos no alcanzan.
- Opcionales no impiden sugerir. Los obligatorios tienen prioridad sobre los opcionales al reservar inventario.
- Permitir mostrar recetas con pocos ingredientes faltantes; límite inicial de sugerencias de tres ingredientes faltantes configurable.
- Recalcular al agregar, cambiar o borrar un plan; ocultar calendario no libera sus reservas.

## 7. Planificador de comidas

- Tabla de una o dos semanas, lunes–domingo, con filas de comida editables/eliminables y hora predeterminada personal.
- Una celda tiene como máximo un bloque activo, con una o varias recetas.
- Sugerencias dentro del selector al agregar al bloque; mostrar aviso de faltantes en planes.
- Editar recetas, porciones, hora, fases y tiempos; completar/deshacer directamente desde cada bloque.
- Fases Cocinar/Comer/Lavar pertenecen al bloque. Defaults personales de comer/lavar modificables por instancia.
- Tiempo de cocina combinado = receta más larga + mitad de la suma de las otras; redondear hacia arriba al siguiente múltiplo de cinco minutos, con override por bloque.
- Porciones a cocinar y a comer iguales por defecto, independientes después.
- Copiar semana anterior solo cuando destino está vacío; revisión automática de recetas copiadas. Copiar configuraciones, no completados/consumos; recalcular disponibilidad y compras y ofrecer preparaciones previas nuevas.
- Botón de borrar comidas en cada semana. Retirar comidas consumidas no devuelve inventario; mantener origen/consumo mínimo necesario.

## 8. Completar y deshacer

- Fuente única de completado de cada actividad/instancia.
- Tarea normal: círculo de principal completa hijos; todas las casillas completadas completan principal. Marcas individuales por defecto afectan solo la instancia.
- Deshacer una principal normal desmarca sus hijos. Agregar una subtarea pendiente vuelve la principal a pendiente. Las preparaciones previas no completan automáticamente una comida.
- Comida paso a paso: terminar preparaciones obligatorias completa el bloque; opcionales marcados determinan uso. Preparaciones previas no descuentan ingredientes por sí mismas.
- Comida desde círculo: selección rápida de opcionales usados y completado conjunto.
- Completar comida registra movimientos por lo cocinado, tandas y usos de porciones en una transacción. No consumir ingredientes dos veces.
- Sobras por receta/tanda, no saldo genérico de porciones de diferentes alimentos.
- Deshacer devuelve exactamente lo descontado y revierte consumos; bloquear si una comida posterior ya consumió sobras de esa cocinada, indicando las dependencias.
- Faltan sobras con Cocinar desactivado: mostrar falta cocinar y/o ingredientes; no activar Cocinar automáticamente.
- Mover conserva pasos realizados. Ofrecer reajustar preparaciones pendientes, sin reemplazar horarios manuales silenciosamente.
- No añadir función Desechar sobras.

## 9. Compras

- Agrupar faltantes de todos los planes pendientes, de cualquier semana, por ID de ingrediente.
- Desglose obligatorio/opcional cuando un ingrediente participa de ambos modos.
- Cantidad necesaria, cantidad elegida y cantidad comprada son distintas. Recalcular no borra ajustes del usuario.
- Artículos libres al final, eliminación con X y controles de compra alineados.
- Marcar individual o todo comprado; cantidades reales aumentan alacena una sola vez.
- Comprados en panel desplegable; deshacer individual usa lo registrado y evita saldos negativos.
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
- Vencidas pendientes siguen pendientes; no inferir automáticamente fracaso/completado.
- Día 31 o 29 de febrero inexistente: usar último día del mes, conservando el día original como ancla para repeticiones posteriores.
- Refrescar al abrir, recuperar foco, reconectar, mutar o pedir actualización. Evitar sondeo constante y consultas por cada casilla.
- No existe sincronización con Google Calendar, syncToken ni reconciliación externa.

## 12. Qué se guarda y dónde

- Google: identidad usada para acceso. MiAgenda no guarda tareas ni recetas en Google.
- PostgreSQL: cuentas internas, sesiones, calendarios propios, actividades, horarios, reglas, excepciones, recetas, inventario, tandas, compras y evidencias mínimas.
- Por usuario: actividades, calendarios, preferencias, recetas, personalizados, alacena, planes, compras, movimientos y seguimiento elegido.
- Compartido: catálogo administrado de ingredientes comunes. No compartir recetas, saldos ni movimientos por defecto.
- Copia local posterior: últimas consultas e Inbox permitido sin conexión, aislada por usuario; no autoridad contable.

## 13. Celular, sin conexión y widget

- Web primero y adaptable a celular; despliegue después de estabilizar núcleo.
- Primera etapa sin conexión: consulta de última copia y altas de Inbox con cola de reintentos.
- Completar comidas, registrar compras y cambiar recurrencias requieren conexión inicialmente.
- Preparar IDs/idempotencia ahora; implementar caché/cola local después.
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
- Los planes mantienen revisión de receta; editar recetario no los cambia salvo actualización explícita de una comida pendiente.
- Retener evidencia mínima necesaria por consumo/sobras/seguimiento selectivo, independiente del detalle de agenda. No convertirlo en archivo permanente de todas las tareas.
- Agenda y Cocina conservan superficies separadas y calendario común filtrable. Semana Agenda domingo–sábado; planificador lunes–domingo.
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
