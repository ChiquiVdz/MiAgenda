# Núcleo nuevo de MiAgenda

**Estado vigente al 2026-10-08:** núcleo único cerrado para uso diario local en PC; revisión integral terminada, captura rápida global conectada y herramientas de respaldo/recuperación preparadas. Últimos cambios de Cocina: 45 comprobaciones aprobadas y revisión visual aceptada por el usuario. Móvil, despliegue público y offline posteriores. Ver [arquitectura actual](../../docs/ARQUITECTURA_ACTUAL.md) e [informe reciente](../../docs/RESULTADOS_COCINA_CANTIDADES.md). Los apartados siguientes registran cada etapa; sus pendientes y selectores antiguos no describen el estado actual.

Estado histórico previo al cierre: núcleo instalado en `miagenda_core`. Acceso, Inbox/subtareas, Agenda, recurrencias y Cocina (Alacena, Recetario, Planificar, consumos/sobras y Compras) conectados en modo `MIAGENDA_CORE_ENABLED=true`. El código anterior permanece como referencia recuperable. `PROJECT.md` y sus secciones 18/19 siguen siendo el contrato; esta carpeta no los reemplaza.

> **Cierre, bloque 1 (2026-10-06):** este núcleo es la única implementación activa. Se retiraron el selector de modo, las rutas/servicios de Google Calendar y el esquema/herramientas antiguos; Google sigue exclusivamente como acceso. Los comandos Prisma de la raíz ahora apuntan a este esquema. Los apartados siguientes son un registro cronológico y sus pendientes pueden estar resueltos en entradas posteriores. Ver [cierre](../../docs/CIERRE_RECONSTRUCCION.md) y [referencia recuperable](../legacy-reference/2026-10-06/README.md).

## Qué incluye

- Núcleo inicial de nueve modelos más cinco modelos de recurrencias instalados: usuario, cuenta Google, sesión, token de verificación compatible con el adaptador, calendario, preferencia, actividad, programación y recibo de comando.
- Inbox como consulta de principales sin programación, no una tabla ni un traslado que cambie el ID.
- Subtareas `Activity` de un solo nivel. Un hijo puede estar programado mientras su padre está en Inbox.
- Crear/editar, completar/deshacer, conservar/destacar, programar/quitar horario y eliminar tareas.
- Completar principal completa sus hijos; deshacer desmarca ambos. Todos los hijos completados completan principal; desmarcar uno o agregar uno pendiente reabre principal. Lista vacía conserva el estado anterior.
- Quitar horario conserva identidad, contenido, progreso e hijos; limpia Conservar/Destacar y mantiene los horarios de los hijos.
- Horarios con instante UTC + zona IANA, o fechas todo el día con fin exclusivo.
- Revisiones de actividad que cambian también cuando se modifica su horario o un hijo. Una revisión desactualizada devuelve conflicto.
- Idempotencia por usuario/comando/contenido, efecto y recibo en una transacción, bloqueo corto por usuario y reintentos limitados para conflictos de transacción.
- Consultas paginadas de Inbox/Agenda, detalle y calendarios. Lecturas compuestas consistentes, sin sondeo ni llamadas a Calendar.
- Adaptador de acceso Google que solicita solo `openid email profile`, no guarda tokens OAuth y crea General una sola vez al crear usuario.
- Adaptador HTTP independiente de Next, listo para conectar a una sesión **del núcleo nuevo**. Origen obligatorio en mutaciones, JSON hasta 64 KB y respuestas privadas sin caché.

El enum ya admite comidas con las extensiones de Cocina instaladas. Su completado requiere un registro transaccional de efectos de inventario y porciones; no escribir completedAt por fuera del servicio de consumos.

## Qué falta en otros bloques

1. Acceso, `/api/core` e Inbox/subtareas ya montados. La API tiene un límite local de 120 solicitudes/minuto por sesión de usuario y cuerpo limitado; al desplegar hay que revisar un límite que cubra varias instancias. Las sesiones/IDs de la base anterior no se reutilizan como autorización de la nueva.
2. Día/Semana/Mes/Año, programación y creación/visibilidad de calendarios ya conectados. Arrastre/ajuste de actividades con hora en Semana conectado; falta arrastre de Todo el día. Gestión de calendarios conectada: editar nombre/color y borrar/trasladar con revisión de alcance. Revisada manualmente por el usuario.
3. Recurrencias, alcances, cambio de frecuencia, subtareas compartidas y retención conectados. La limpieza especializada de comidas no tiene suite funcional ejecutada.
4. Cocina conectada a Activity: Alacena, Recetario, Planificador, consumos, tandas, sobras y Compras. Pendientes: copiar/borrar semana, retirada/sustitución de ingredientes usados y revisión integral de flujos.
5. Cerrar la retirada de Google Calendar en toda la app; no retirar ahora el código que todavía usa la interfaz anterior.

No se añadió ni ejecutó una suite de pruebas funcionales. Se validaron esquema, tipos de ambos árboles e instalación mediante lecturas de catálogos. En la vista previa se observó callback Google correcto, Inbox 200 y un primer POST 200; esto no demuestra todos los casos de completado, idempotencia o concurrencia. El usuario revisa los pasos abajo.

## Recurrencias: primer bloque conectado

Migración incremental 20261003000200_recurrence aplicada a miagenda_core. Añade familias, segmentos, claves/definiciones de pasos y excepciones, con relaciones por propietario, revisiones e identidad original estable. No modifica la migración inicial ni la base anterior.

- Crear tarea desde Agenda permite repetición diaria, semanal con días elegidos, mensual o anual, intervalo y último día opcional. Los días semanales deben incluir el inicio. Funciona con hora y Todo el día.
- Solo se guarda la regla al crear. Leer Día/Semana/Mes expande fechas por rango sin insertar actividades futuras; Año lee destacados materializados. Todas las vistas conservan filtros y paginación.
- Fecha 31/29 de febrero ajustada al último día, conservando ancla. El motor usa un subconjunto [RRULE de RFC 5545](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10); el ajuste es política de MiAgenda y la fecha final inclusiva local se aplica separadamente.
- Primera modificación/completado/subtarea/horario/conservar/destacar materializa solo la instancia afectada dentro de la misma transacción idempotente. La referencia de serie, ordinal original e ID estable no cambian al moverla.
- En este bloque TODAS las acciones afectan solo esa instancia. Se puede editar, completar/deshacer, arrastrar, borrar o quitar horario. Quitar horario la deja en Inbox; la excepción suprime su fecha original. Borrar una instancia no la regenera al recargar. Los demás días permanecen pendientes.
- Subtareas agregadas ahora pertenecen solo a la instancia elegida. Las tablas para definiciones comunes están preparadas, pero no se conecta todavía un editor de pasos de serie ni alcances globales.
- Trasladar/eliminar calendarios incluye sus series. La confirmación cuenta reglas y actividades guardadas, no infinitas fechas futuras. El borrado cancela generación y retira también instancias de esas familias que se movieron a otro calendario o Inbox.
- Horarios calculados en zona IANA; las horas locales inexistentes por DST se omiten como fechas no realizables, sin cambiar el ordinal de otras instancias. Se conserva duración en minutos. Reglas sin fin no se materializan indefinidamente.

Comprobaciones realizadas: TypeScript raíz/núcleo, migración aplicada, lectura del catálogo (14 tablas de dominio/autenticación, 16 triggers, 13 checks; excluye _prisma_migrations) y respuesta Agenda 200 observada tras reiniciar. No se añadieron ni ejecutaron pruebas funcionales; revisión manual pendiente. Hubo un primer intento SQL rechazado por PostgreSQL dentro de BEGIN/COMMIT; se corrigió, se marcó ese intento como revertido y el segundo se instaló correctamente.

### Cómo revisar

1. Recargar Agenda y Crear tarea. Elegir Diariamente y un último día a una semana. Guardar; navegar a la semana siguiente y confirmar que acaba en la fecha elegida.
2. Completar una repetición y recargar: solo esa queda completada. Editar su nombre/moverla; confirmar que los otros días conservan nombre y hora.
3. Agregar una subtarea en una instancia: solo esa la recibe. Completar/deshacer principal e hijo y confirmar el estado después de recargar.
4. Borrar una instancia y recargar: no reaparece. Quitar horario a otra: aparece Inbox, no en su fecha original; restantes repeticiones siguen Agenda.
5. Crear semanal con lunes/miércoles/viernes (el inicio debe ser uno de ellos), cada dos semanas y comprobar semanas alternadas. Ocultar/mostrar su calendario.
6. Crear mensual el 31 de enero: febrero usa 28/29 y marzo vuelve al 31. Anual el 29 de febrero: años normales 28 y años bisiestos 29. Se puede elegir Todo el día.
7. Destacar una instancia: activa Conservar, aparece Año y abre su mismo detalle. Otras repeticiones no se destacan.
8. En un calendario de prueba con una serie, usar Eliminar calendario: el alcance incluye la serie. Trasladar conserva fechas/completados; borrar contenido impide que vuelvan futuras repeticiones.

Pendiente para el segundo bloque: Solo esta / esta y siguientes / toda la serie, división de segmentos conservando familia, definiciones/claves de subtareas y marcas por alcance. Convertir tareas existentes en recurrentes no está expuesto en este primer formulario; no duplicar una actividad existente para simular conversión. Retención automática todavía pendiente.

## Archivos principales

| Archivo | Uso |
|---|---|
| `schema.prisma` | Subconjunto derivado de `docs/schema.objetivo.prisma` |
| `constraints.sql` | Reglas adicionales de la migración inicial |
| `migrations/20261003000100_core/migration.sql` | Migración instalada; **no editarla** |
| `src/contracts.ts` | Comandos y validación de entradas |
| `src/service.ts` | Mutaciones de actividades |
| `src/queries.ts` | Lecturas por usuario/rango |
| `src/authentication.ts` | Configuración de acceso Google y adaptador |
| `src/http.ts` | Contrato de transporte a conectar después |
| `src/environment.ts` | Conexión independiente y comprobación de nombre/aislamiento |
| `inspect.ts` | Consulta de instalación, sin crear datos |
| `prepared.json` / `installation.json` | Huellas y estado de preparación/instalación |

## Entorno y ejecución

Dependencias instaladas en la raíz: Prisma 7.10.0, adapter-pg, pg, NextAuth, TypeScript. No se añadieron dependencias ni un servidor adicional. El cliente de esta carpeta es independiente del cliente que usa la app anterior y se genera localmente.

`reconstruction/core/.env.local` contiene exclusivamente:

```env
MIAGENDA_CORE_DATABASE_URL="postgresql://.../miagenda_core?sslmode=verify-full"
```

No pegar credenciales en documentación/chat/Git. El conector nunca cae automáticamente en `DATABASE_URL`; rechaza el nombre de la base actual y obliga a `miagenda_core`. Usa validación SSL completa y pool de dos conexiones. Esto separa bases, no crea un servidor dedicado ni roles de acceso distintos en Neon.

Desde la raíz, con Node/npm disponibles:

```powershell
npm --prefix reconstruction/core run generate
npm --prefix reconstruction/core run typecheck
npm --prefix reconstruction/core run migrate
node reconstruction/core/inspect.ts
```

La inspección directa de TypeScript se ejecutó con el Node 24.19.0 incluido en Codex. No es necesario levantar la vista previa para estas operaciones. `prepare.cjs` es únicamente una herramienta histórica para preparar la migración inicial de nueve tablas. Ahora rechaza la ejecución porque ya hay migraciones incrementales instaladas; no se debe incluir en los pasos de instalación actuales. Su dirección ficticia `127.0.0.1:1` inicializa Prisma sin consultar una base. Para el esquema actual se usa `generate`; nuevos cambios requieren una migración incremental.

La migración inicial exige una base vacía; la de recurrencias agrega tablas a ese núcleo conservando sus datos. Ambas tienen transacción. No usar `migrate reset`, `db push` ni el config de la raíz para reconstruir. Cambios posteriores se hacen en migraciones nuevas; `constraints.sql` y `recurrence-constraints.sql` son referencias ya incluidas en las migraciones, no archivos para ejecutar encima de tablas existentes.

## Contrato al conectar la interfaz

El propietario lo obtiene el servidor desde sesión verificada. No aceptar `userId` del JSON ni reutilizar una sesión del proyecto anterior.

Cada acción genera `commandId` UUID nuevo y conserva ese mismo ID y payload al reintentar. Crear una tarea usa además un UUID estable generado por el cliente. Para editar/programar/completar/borrar se envía `expectedRevision` de la consulta más reciente. Una subtarea nueva usa `expectedParentRevision`; no se compara por título.

```json
{
  "commandId": "bdf166aa-cd5f-4c67-a77f-5ce53e6c4655",
  "action": "createTask",
  "id": "e1a78e4b-ecf7-4962-9ba4-0322f7160a8a",
  "title": "Revisar apuntes"
}
```

Comandos disponibles: `createTask`, `editTask`, `setCompleted`, `setFlags`, `scheduleTask`, `unscheduleTask`, `deleteTask`, `createCalendar`. `setCompleted` recibe un booleano; no hay toggle ambiguo al reintentar.

El handler recibe GET `view=inbox|detail|calendars|agenda` y POST con el comando. Agenda admite calendarios explícitos (lista vacía = ninguno); sin lista usa preferencias. Ocultarlos no cambia reservas futuras. El rango es de intersección y hasta 370 días; recorrer todas las páginas y ordenar por horario en la presentación. Inbox ordena por creación descendente y usa cursor.

Una respuesta `replayed: true` devuelve el recibo original, que puede contener una vista anterior. El cliente debe refrescar la consulta y **no sobrescribir** estado más reciente con ese snapshot. Un conflicto requiere refrescar y decidir/reintentar con comando nuevo; no esconderlo como guardado exitoso.

La programación acepta fin posterior al inicio; la interfaz ajustará arrastre a 15 minutos. No imponer ese intervalo a la duración de Cocina (redondeo de 5 minutos en su bloque).

## Eliminación y memoria mínima

Eliminar retira principal y sus hijos y quita todos sus horarios, incluso los hijos en otro calendario. La interfaz debe anunciar ese alcance antes de enviar el comando. Eliminar un hijo no elimina su padre. Se recalcula el estado del padre solo si siguen quedando hijos.

Se conserva una identidad retirada sin título/descripcion/horario/banderas para evitar resurrección por reintentos. Los recibos aún no caducan: **no es una política definitiva de archivo permanente**. El bloque de retención/offline definirá compactación/horizonte y exclusiones antes de habilitar una cola real. Los snapshots de recibos no son autoridad del estado ni fuente del dashboard.

`dataRevision` es un contador monotónico para invalidar consultas, no el número de comandos. Los triggers pueden avanzarlo varias veces dentro de un comando; nunca se incrementa al consultar.

## Copia recuperable

`reference/legacy-before-core.zip` guarda fuentes, esquema/migraciones anteriores, scripts, pruebas existentes, documentos y configuración pública. Excluye credenciales, node_modules, .next y .git. Es local e ignorada por Git; no equivale a una copia de datos de Neon. La base anterior se mantiene intacta y sus datos de prueba no se migraron.

`tsconfig.json` de la raíz excluye las entradas independientes de `reconstruction`, pero ahora comprueba los servicios que importan las rutas nuevas. Ambos árboles admiten imports TypeScript explícitos y tienen comprobación propia. El cliente de cada base sigue separado.

## Revisar el bloque de Inbox

1. Abrir `http://localhost:3000/inbox` e iniciar sesión con Google. Se usa el mismo callback registrado; no se solicitan permisos de Calendar. Datos anteriores no aparecen porque son otra base.
2. Crear una tarea, editar nombre/descripcion y recargar: debe persistir.
3. Desplegar Subtareas, agregar dos, editar/borrar una y marcar individualmente. Sin preguntas de recurrencia.
4. Marcar todas las subtareas: se completa la principal. Desmarcar una reabre principal. Agregar una pendiente a una principal completada también la reabre.
5. Completar desde el círculo principal: completa todos los hijos; deshacer los desmarca. Los completados están en el desplegable.
6. Borrar una principal tras confirmar el alcance: desaparecen ella y sus hijos. Borrar un hijo conserva padre; una lista vacía no cambia sola su estado.
7. Dos pestañas: un guardado desde un formulario antiguo debe avisar de conflicto y actualizar, sin perder el cambio de la otra pestaña.
8. Si hay una respuesta incierta, usar Reintentar cambio: mantiene ID/payload y bloquea otros guardados hasta resolverlo. No cambiar manualmente UUIDs para un reintento.

No hay intervalos de sondeo. Carga inicial del servidor sin GET duplicado, cambios aplicados con su respuesta; refresco al recuperar foco/conexión o con Actualizar. Agendar principales y subtareas ya está habilitado; al quitar horario se conservan identidad y progreso. La retención usa un POST separado; los GET siguen sin mutaciones.

Implementación de transición: `src/lib/core-runtime.ts`, `src/lib/auth.ts`, `src/lib/legacy-auth.ts`, `src/proxy.ts`, `src/app/api/core/route.ts` y `src/app/inbox/core-inbox-view.tsx`. El proxy no sustituye autorización por sesión/propietario. Registros de acceso omiten metadata del proveedor; Next no registra query strings de callback OAuth.

## Revisar Calendarios y programación

- En Agenda, crear un calendario con nombre/color. Ocultarlo y cambiar entre Día/Semana; recargar conserva su visibilidad.
- Desde Inbox, agendar una principal con subtareas. Sale de Inbox y aparece en Agenda; las subtareas conservan identidad y progreso.
- Agendar solo un hijo con 15 minutos iniciales: la principal sigue en Inbox. El hijo aparece en Agenda y su tarjeta muestra Agendada.
- Crear desde el botón o un espacio vacío de Semana. Guardado de actividad y horario es una sola transacción; no hay tarea huérfana si el horario falla.
- Abrir una actividad en Semana: detalle inicial con edición, subtareas y borrado. En Día editar/agregar/quitar subtareas directamente.
- Cambiar inicio mantiene la duración y desplaza el fin; fin inválido o fuera de intervalos de 15 minutos da aviso. Hay modalidad Todo el día con último día inclusivo en pantalla y fin exclusivo en la base.
- Destacar activa Conservar; luego se modifican independientemente. Quitar horario desactiva ambos, avisa si estaban activos y mantiene las casillas.
- Navegar fuera del período actual: aparece Hoy. Selector Día/Semana regresa al período de hoy. Semana domingo–sábado, línea solo en hoy y desplazamiento inicial a la hora actual. El reloj local se actualiza cada minuto sin consultas a la base.
- Probar eventos simultáneos y actividades que cruzan medianoche. Se dividen visualmente por día y se colocan en columnas para los solapamientos.
- Principal e hijos se completan/deshacen desde las mismas reglas en las dos pantallas. Borrar principal avisa y retira hijos y horarios; quitar horario no elimina la casilla.

No se ejecutó una suite funcional ni se verificó visualmente este bloque. La revisión manual de estos flujos está pendiente. No se modificó PROJECT.md, la migración aplicada ni la base anterior. Interfaces nuevas en src/app/core; /agenda usa servicios comunes. Lecturas con maxWait 10 s/timeout 15 s conservan el pool pequeño durante recargas de desarrollo.

## Revisar Mes y Año

1. En Agenda abrir Mes desde el selector: lleva al mes de hoy. Las flechas cambian por meses completos sin saltar febrero aunque el ancla sea día 31.
2. Pulsar espacio vacío o + de un día: abre Crear tarea con esa fecha y el selector 1–12 / 00,15,30,45 / AM-PM. Guardar y abrir su detalle desde Mes.
3. En un día con más de tres actividades, usar +N más y Ver menos. Los eventos de varios días también aparecen en las fechas que intersectan, con el fin de Todo el día exclusivo en la base.
4. Usar Ver semana en una fila; después el encabezado de un día abre Día. La navegación conserva la fecha elegida.
5. Marcar Destacar en un evento: activa Conservar si acaba de destacarse. Abrir Año: aparecen los doce meses, indicadores en sus días y títulos/fechas de destacados por mes. Subtareas destacadas también participan.
6. Pulsar título de destacado abre el detalle común: editar/completar/subtareas. Desactivar Destacar retira el indicador del año sin borrar la actividad ni desactivar Conservar.
7. Pulsar un día o el título de un mes en Año abre ese Mes. Flechas cambian años y Hoy regresa al actual. Cambiar desde el selector siempre regresa al periodo de hoy.
8. Ocultar un calendario retira sus elementos de todas las vistas; cambiar de vista conserva la selección. Reactivarlo recupera sus actividades.
9. Hay hasta cien actividades por página. Si hay más, se avisa y Cargar más incorpora la siguiente página; Año consulta solo destacados, sin cargar todas las tareas del año.

Reutilización de MonthAgenda/YearAgenda como presentación: una proyección de Activity suministra sus datos, sin tablas/copias ni sincronización con Google. Las consultas, permisos, horarios e identidad siguen en el núcleo. No se cambió PROJECT.md ni el esquema de la base. Revisión funcional/visual pendiente del usuario; no se añadió ni ejecutó una suite de pruebas.

## Revisar arrastre y duración en Semana

- Crear una tarea de una hora con una subtarea completada. Arrastrar el centro a otra hora y a otro día visible: la duración y el progreso se conservan.
- Arrastrar el borde superior para cambiar inicio, o inferior para cambiar fin. Ajuste a 15 minutos, duración mínima 15 minutos; los solapamientos siguen en columnas.
- Un clic breve abre detalle; un arrastre no lo abre ni crea otra tarea. Escape, perder foco o soltar fuera del área cancela sin guardar.
- Mientras arrastras se ve una proyección del horario. Solo al soltar un cambio válido se envía un comando idempotente con revisión esperada. Si falla, se conserva la posición confirmada y se muestra error/reintento.
- Cambiar entre Día/Mes/Año y recargar confirma la persistencia del nuevo horario. El calendario, Conservar/Destacar, completado y la identidad no cambian.
- Subtareas con horario propio se mueven independientemente. Mover una principal no desplaza horarios de hijos.
- Eventos que cruzan medianoche muestran sus segmentos por día: solo el primer segmento tiene borde de inicio y solo el último el de fin.
- En celular se puede usar el formulario Cambiar horario; los gestos por puntero también admiten touch. Deslizar el área vacía permite desplazarse.

Alcance de este bloque: actividades con hora, dentro de la semana visible. Todo el día y saltar a semanas no visibles durante el arrastre se manejan por Cambiar horario. No se añadieron pruebas ni se hizo revisión funcional/visual automática. PROJECT.md y la base no cambiaron.

## Recurrencias: alcances y subtareas compartidas

La migración incremental `20261005000100_series_scopes` está aplicada a `miagenda_core`. Añade instrucciones de progreso y rangos de retiro, con validación de propietario y pertenencia a la familia. Las acciones usan el bloqueo por usuario, revisión de actividad y de serie, y el mismo recibo transaccional que las acciones individuales. Consultar fechas futuras sigue sin insertar actividades.

En el detalle de Semana y Mes, editar, agregar/quitar subtareas, cambiar horario y eliminar permite elegir Solo esta / Esta y las siguientes / Toda la serie. Las casillas rápidas siempre afectan solo la instancia elegida. «Aplicar completado…» extiende el estado actual de la principal; «Aplicar marca…» extiende el estado actual de esa subtarea. Día e Inbox conservan las acciones rápidas individuales. Los horarios propios de subtareas se modifican individualmente.

Los alcances usan el ordinal original, no la fecha actual: incluyen las excepciones movidas, modificadas, sin horario o en otro calendario. Cambiar horario de la principal en un alcance aplica hora/duración/calendario y conserva la fecha actual de cada instancia; una excepción sin horario recupera su fecha original. Arrastrar sigue afectando solo esa instancia. Cambiar frecuencia/días de una serie existente queda pendiente.

Una subtarea compartida conserva su clave al renombrarse. Marcar/desmarcar busca esa clave, conserva las otras marcas y omite subtareas eliminadas; no las reconstruye. Agregar una nueva subtarea mediante un alcance la crea pendiente y reabre las principales correspondientes. Borrar la última subtarea conserva el estado de la principal, también en proyecciones futuras. Las subtareas privadas antiguas no se vinculan por coincidencia del texto: un alcance sobre ellas solo afecta las instancias que realmente comparten su identidad. Para disponer de un paso en la serie, agregarlo desde el detalle con el alcance deseado. Las definiciones compartidas admiten nombres de hasta 150 caracteres.

Revisión manual sugerida:

1. Crear una tarea diaria y abrirla en Semana. Agregar dos subtareas con Toda la serie; comprobar la siguiente semana sin crear instancias manualmente.
2. Marcar una casilla: solo cambia esa instancia. Usar Aplicar marca… → Esta y las siguientes: ese paso cambia en las siguientes; otras casillas conservan su estado. Desmarcar y aplicar Toda la serie para revisar el camino inverso.
3. Renombrar un paso en una sola instancia y borrar otro allí. Aplicar una marca de serie desde otro día: encuentra el paso renombrado por identidad y omite el borrado.
4. Completar la principal y usar Aplicar completado… con un alcance: se completan sus hijos. Deshacer y aplicar el alcance: se desmarcan. Agregar una subtarea compartida debe volverlas pendientes.
5. Mover una instancia a otro día. Editar el nombre de toda la serie: también cambia esa excepción. Cambiar horario con alcance conserva cada fecha, incluida la movida.
6. Eliminar Esta y las siguientes: desaparecen las instancias desde su posición original, incluidas excepciones; recargar y navegar no las recrea. Toda la serie elimina también las anteriores y sus hijos programados.
7. Repetir los controles desde Mes. En Día verificar que completar y editar subtareas continúa sin preguntas de alcance.
8. Borrar la última subtarea de una serie completada: la principal debe seguir completada al navegar a fechas nuevas.

TypeScript de aplicación y núcleo, migración y catálogo comprobados. No se ejecutó una suite funcional; estos flujos quedan para revisión del usuario. PROJECT.md y la base anterior se conservaron.

Corrección posterior: `20261005000200_step_key_trigger_fix` separa la selección de tabla en el trigger de integridad antes de acceder a `stepKeyId`. El intento manual reportó P2022/42703 al agregar subtareas: PostgreSQL resolvía ese campo también para `series_step_keys`, que no lo tiene. Se conservan las validaciones de familia y propietario; no se modificó una migración aplicada ni se borraron datos. La X permite cerrar tras una respuesta incierta sin descartar el comando pendiente de reintento. Recuperar foco no solicita un detalle físico para una ocurrencia todavía virtual. Pendiente revisar agregar una subtarea individual y otra compartida desde Semana/Mes.

## Retención de tareas del núcleo

Migración `20261005000300_retention` aplicada. El servicio usa el reloj de PostgreSQL y el bloqueo por propietario de los comandos. Plazo mínimo: 120 horas desde completar y nunca antes del fin del horario; Todo el día usa fin exclusivo en su zona. No se acepta una fecha de limpieza del cliente.

- Pendientes y Conservar no se purgan. Conservar en la principal protege todos sus hijos; regla aprobada e incorporada a PROJECT.md/modelo.
- La principal permanece mientras un hijo esté pendiente, conservado, futuro o no cumpla sus cinco días. Si vence un horario de hijo mientras el padre permanece, retirar solo su horario/banderas y conservar casilla, nombre y progreso. Cuando todos sean elegibles, retirar el conjunto atómicamente.
- Se eliminan textos, horarios, banderas y completado del detalle retirado. Identidades/excepciones mínimas impiden reaparición. Recibos e instrucciones/definiciones necesarias tienen otra política; no compactarlos sin acordar el horizonte del bloque offline.
- Las apariciones calculadas vencidas se excluyen por intervalos originales compactos, sin materializar el futuro. Las excepciones guardadas tienen sus propias fechas, Conservar e hijos y se procesan separadamente, incluso dentro de un intervalo excluido.
- Por transacción: hasta 50 principales elegibles con sus hijos, 50 horarios de hijos y 10 nuevos intervalos de un segmento. Cursor por usuario para continuar; no hay una transacción global para todos los usuarios.
- Al abrir Inbox/Agenda, POST autenticado `/api/core/retention`: hasta tres tandas y refresco de la vista solo si cambió contenido. Una ronda completa no se repite antes de 24 horas. Recuperar foco/conexión permite continuar, con un intento por hora en el cliente; sin sondeo periódico.
- El cron diario existente `/api/cron/retention` requiere CRON_SECRET. En modo núcleo no ejecuta servicios de Google ni escribe la base anterior. Hasta diez usuarios por llamada, con transacciones independientes. Localmente la limpieza funciona al visitar la app; cerrada, se retoma al volver. La ejecución sin abrir la app requiere despliegue y cron.

Revisión manual sin simular fechas internas:

1. Completar hoy una tarea de Inbox y otra programada; recargar y comprobar que ambas permanecen durante cinco días.
2. Conservar una principal con hijos y completar: debe mantener el conjunto. Conservar solo un hijo pospone la retirada de su padre.
3. Completar una principal con un hijo futuro: no retirarla antes del fin/plazo del hijo.
4. Volver después de cinco días: completadas sin protección y con horario finalizado desaparecen en la siguiente ronda; pendientes siguen presentes.
5. Una aparición recurrente retirada no reaparece al navegar/recargar. La familia continúa; excepciones movidas al futuro o conservadas permanecen.
6. Si vence un hijo y su padre aún permanece, su evento se retira pero su casilla/progreso permanece dentro del padre. Conservar en el padre protege también el evento.

TypeScript de ambos árboles, generación del cliente, migración y catálogo comprobados. No se añadió ni ejecutó una suite funcional ni se alteraron fechas para simular cinco días. Revisión temporal pendiente.

### Verificación de retención solicitada el 2026-10-05

Se ejecutó `verify-retention.ts` contra un esquema temporal aislado de PostgreSQL, instalando las mismas cinco migraciones y usando los servicios y triggers reales. El adaptador Prisma usa ese esquema y los SQL explícitos se redirigen únicamente al namespace temporal. No se cambiaron usuarios/tareas de la app ni el reloj o plazo de producción. Se envejecieron solo los completados/instrucciones de las fixtures. El esquema se eliminó al terminar.

Resultado: **30 comprobaciones correctas**, incluyendo cuatro días y menos de 120 horas, más de cinco días, pendientes, horarios futuros, Todo el día, Conservar padre/hijo, hijo reciente/futuro/pendiente, retiro de horario conservando casilla, agregado completo, aislamiento por propietario, lotes de 50 principales, recurrencias calculadas, excepciones conservadas/movidas/pendientes, familia activa, ausencia de materialización futura, no reaparición y doble ejecución (incluida una repetición real sin el atajo de frecuencia diaria). Reporte en `retention-verification.json`.

Repetir explícitamente con `node --experimental-strip-types reconstruction/core/verify-retention.ts` desde la raíz, con acceso a Neon. Requiere permiso para crear/eliminar exclusivamente un esquema temporal con nombre generado. No ejecutarlo automáticamente en desarrollo. Esta verificación del servicio y base no sustituye la revisión visual ni prueba el scheduler de Vercel, que requiere despliegue.

## Cambiar frecuencia de una serie

Migración `20261005000400_frequency_generations` aplicada a `miagenda_core`. En el detalle de Semana/Mes: **Cambiar repetición**, elegir frecuencia/intervalo/días/fin y alcance, **Revisar cambio**, **Confirmar repetición**. El resumen calcula ocho meses; la regla no tiene ese límite ni materializa el futuro. GET de revisión no escribe; POST usa bloqueo del usuario, revisión de actividad/serie/datos e idempotencia. Si algo cambia después de revisar, rechaza el guardado y requiere consultar/revisar de nuevo.

Se conservan completadas, pendientes pasadas y futuras materializadas con sus cambios/hijos/horarios. Progreso calculado previo se conserva mediante intervalos compactos; las fechas nuevas empiezan pendientes. Un martes particular no crea otros martes. Acortar el fin conserva las excepciones; extender o cambiar de nuevo no resucita fechas eliminadas/purgadas. Misma familia y claves de subtareas; todos/siguientes siguen incluyendo las excepciones según fecha original, no según su movimiento ni el número de generación. Conservar/Destacar y retención siguen aplicando.

Revisión manual:

1. Crear una rutina diaria que empiece un lunes futuro. Mover solo el martes a otra hora y agregarle una subtarea.
2. Desde el lunes: Cambiar repetición → semanal lunes/viernes → Esta y las siguientes → revisar/confirmar. Ver lunes, martes modificado y viernes; martes mantiene horario/subtarea. Semana siguiente: solo lunes/viernes salvo otra excepción propia.
3. Completar una instancia y dejar una pasada pendiente; cambiar toda la serie. Ambas deben permanecer en sus fechas y con su progreso. Fechas nuevas pendientes.
4. Acortar el último día antes de una futura modificada: desaparecen las futuras ordinarias, la modificada permanece.
5. Borrar una instancia, cambiar frecuencia y volver al patrón anterior: la eliminada no reaparece.
6. Después de cambiar frecuencia, agregar una subtarea o editar/eliminar toda la serie: debe incluir las excepciones conservadas. Probar Esta y siguientes desde una excepción movida y comprobar que usa su fecha original.
7. Repetir desde Mes y recargar/navegar entre semanas. El número de actividades físicas solo crece al modificar instancias, no al revisar/navegar/cambiar frecuencia.

TypeScript de app/núcleo y catálogo/migración revisados. Comprobación funcional aislada de frecuencia pendiente de respuesta del usuario; no se ejecuta la suite de retención como parte de este bloque. La revisión visual queda pendiente.

## Ingredientes y Alacena del núcleo

Migración `20261005000500_pantry` aplicada. `/cocina` y los accesos desde Inbox/Agenda usan la sesión y la base propias. El catálogo global reutiliza los 41 ingredientes comunes depurados; no se importaron existencias antiguas. Los ingredientes personalizados, preferencias y cantidades son privados. Identidades compartidas entre catálogo e inventario preparan la conexión posterior con recetas/compras. No son Activities: son datos especializados, conforme a PROJECT.md.

- Normalizar formato/mayúsculas/acentos evita duplicados exactos; nombres parecidos generan sugerencias y requieren confirmar para crear un ingrediente distinto. No se fusionan IDs por similitud.
- Unidades canónicas g/ml/piece; hasta tres decimales exactos enviados como texto y procesados en milésimas enteras. Cero válido. Personalizados admiten edición; unidad bloqueada tras cualquier movimiento o cantidad no nula. Un cero inicial sin movimientos permite corregirla. Globales no son editables por usuarios.
- Guardar queda desactivado sin cambio de cantidad. Base de revisión capturada al editar: un cambio concurrente no sobrescribe existencias y solicita revisar la cantidad actual. Reintentos usan el mismo commandId/recibo y no duplican ajustes.
- Cantidad real = suma de movimientos inmutables. Trigger aplica cada delta en la misma transacción y una comprobación diferida exige saldo coherente. Misma exclusión por propietario/recibos que las actividades. Actualmente solo operaciones adjustment; habilitar consumo/compra/reversión en sus bloques, sin eludir este protocolo.
- Quitar de Alacena confirma ajuste a cero y ocultar la fila, conservando evidencia. Ocultar sugerencia afecta solo al catálogo del usuario y no modifica cantidades; recuperable desde Sugerencias ocultas. Retirar/sustituir referencias en recetas/compras queda para sus bloques de reconstrucción.
- Lecturas autenticadas paginadas de 100 filas, respuestas por cambios y refresco al recuperar foco/conexión; sin sondeo. Movimientos muestra los últimos 20 ajustes propios del ingrediente.

Cómo revisar:

1. Abrir Alacena. El catálogo debe incluir Arroz/Huevo/Leche y el inventario debe empezar vacío.
2. Agregar 500 g de Arroz. Guardar debe estar desactivado; escribir 600 lo habilita, volver a 500 lo desactiva. Guardar 600 y recargar: 600 g. Movimientos: +500 y +100, sin repetir el total.
3. Crear «ARROZ» debe ofrecer usar Arroz; «huevos» sugiere Huevo y permite crear uno distinto solo con confirmación. Personalizado nuevo sin existencias permite corregir unidad; tras registrar cantidad la unidad queda bloqueada, incluso después de quitarlo.
4. Usar 0.125 en un ingrediente de gramos/mililitros. Se conserva exactamente; negativos y más de tres decimales no permiten guardar.
5. Ocultar una sugerencia y recuperarla: el stock existente no cambia. Quitar de Alacena: ajustar a cero, retirar fila y conservar historial; el catálogo sigue disponible.
6. En dos pestañas, editar la misma cantidad. Guardar una; la otra debe avisar del cambio o rechazar el guardado. Cargar cantidad actual antes de volver a editar; nunca sobrescribir silenciosamente.

Migración, esquema/catálogo y TypeScript comprobados. No se añadieron ni ejecutaron pruebas funcionales; pendiente revisión del usuario.
# Recetario propio — 2026-10-05

Corrección de guardado: Prisma propaga `userId` desde la relación compuesta de revisión hacia los pasos creados dentro de ella. No enviar ese campo en `steps.create`; se tipa explícitamente cada paso para evitar campos extra aceptados estructuralmente por TypeScript pero rechazados al ejecutar. Un comando fallido se puede reintentar después de la corrección con el mismo ID; la transacción fallida no deja receta parcial.

`/cocina/recetas` habilitado, con acceso desde Alacena. Recipe/RecipeRevision/RecipeStep en migraciones incrementales `20261005000600_recipes` y `20261005000700_recipe_unit_integrity`. Catálogo y comandos de ingredientes reutilizados; recetas privadas por sesión, revisiones esperadas, recibos idempotentes y misma exclusión por usuario que actividades/inventario. Versiones y pasos inmutables, retiro lógico. Lectura paginada de 30 recetas y hasta 60 pasos por receta; consulta al foco/reconexión y cambios, sin sondeo periódico. UI conserva un comando incierto y ofrece reintentar, sin crear revisiones duplicadas; conflictos requieren revisar la versión actual.

Decisiones confirmadas: borradores con nombre sin datos completos, paso opcional con o sin ingrediente, crear personalizado dentro del editor. El resumen suma cantidades mediante enteros de milésimas y distingue obligatorio/opcional. Preparaciones previas guardan título y anticipación; agendarlas se conecta en el siguiente bloque. Guardar/editar/retirar no modifica Alacena. La definición no se completa como una tarea. La unidad del ingrediente también queda fija cuando una versión de receta la referencia; esto protege las cantidades congeladas.

Revisión manual pendiente (sin suite funcional ejecutada):

1. Crear «Pasta» con solo nombre y Borrador; guardar, recargar y editar. Quitar Borrador sin datos: debe pedir porciones, tiempo y paso.
2. Definir 2 porciones, 20 min y dos pasos con Arroz 100 g y 50 g. El resumen muestra 150 g. Marcar el segundo opcional: 100 obligatorio + 50 opcional.
3. Agregar «Decorar» sin ingrediente y marcar opcional. Subir/bajar pasos y eliminarlos. Guardar lista y recargar.
4. Proponer «Sacar pollo del congelador» 12 h antes; editar y verificar valores. No debe crearse una actividad todavía.
5. Crear ingrediente desde un paso; probar duplicado exacto y nombre parecido. Elegir existente o confirmar distinto; la nueva selección debe quedar en ese paso, sin agregar stock.
6. Editar receta: aumenta versión. Retirar: desaparece del recetario. Las cantidades de Alacena permanecen iguales.
7. Dos pestañas editando la misma receta: el segundo guardado debe pedir revisar la versión actual. No sobrescribe el primero.

TypeScript del núcleo y raíz comprobados; migraciones aplicadas y catálogo PostgreSQL inspeccionado. Planificador, comidas, disponibilidad/sobras, compras y retirada/sustitución de ingredientes entre referencias quedan pendientes en sus bloques.
# Planificador propio — etapa de programación, 2026-10-05

`/cocina/planificar` habilitado. Migración incremental `20261005000800_planner`: MealSlot, MealBlock, MealCell, MealRecipe y MealStepData; `User.kitchenInitialized` distingue no inicializado de un usuario que retiró todas sus filas. La primera apertura envía un comando idempotente que crea calendario personal Cocina y filas Desayuno (08:00), Comida (14:00), Cena (20:00). GETs no escriben. Mismo propietario/bloqueo/recibos y revisiones del núcleo. Cocina tiene calendario de módulo protegido, con visibilidad editable en Agenda.

Bloque principal Activity meal, hijos Activity task con metadata de origen; no evento paralelo ni estados duplicados. Recetas del bloque referencian revisiones inmutables, también al retirar/editar su definición. Actualizar una receta del plan exige selección explícita. Porciones a cocinar y comer independientes, iguales inicialmente. Duración combinada de cocina = máximo + mitad del resto, redondeada hacia arriba a 5 min; overrides por receta/bloque, defaults personales de comer/lavar. Arrastre desde Agenda mantiene fila, valida celda de fecha destino y registra duración ajustada; el formulario avisa si recalculará esa duración. Ninguna programación toca stock, tandas o compras.

Preparaciones previas inicialmente sin seleccionar, con fechas/horas sugeridas editables y duración inicial 15 min. Se agendan como hijos directos, fuera de Google. Al editar una comida se conservan horarios existentes y progreso realizado; «Reajustar previas pendientes» ofrece nuevas sugerencias, sin mover realizadas. Casillas de cocina y comida desactivadas en UI y bloqueadas por servicio/BD hasta integrar inventario. Recordatorios previos sí completan/deshacen y no reconcilian ni completan la comida. Quitar horario conserva el hijo; retirar comida retira sus horarios/hijos y libera su celda.

Lectura por una/dos semanas, sin sondeo. Altas de pasos/metadatos/horarios nuevos por createMany; no una consulta por cada paso nuevo. Eliminar fila revisa planes de todas las fechas, valida revisión global y detecta celdas ocupadas antes de trasladar. Borrado agrupado de padres/hijos, sin eliminar evidencias del módulo. Límites de entrada: 20 filas, 10 recetas por bloque, 60 pasos por receta, cuerpo API 64 KB. No alimentar sugerencias con una disponibilidad incompleta: reservas cronológicas, consumos, tandas/sobras, compras, copiar/borrar semana y creación de comida desde el formulario común de Agenda se conectan en bloques posteriores.

Revisión manual pendiente:

1. Abrir Planificar: filas iniciales, semana lunes–domingo, pasar semanas, volver a esta semana y alternar una/dos semanas.
2. En +, elegir dos recetas listas. Ajustar porciones a cocinar/comer y tiempos. Recetas de 20 y 15 min => cocina 30 min; defaults comer 20/lavar 10 => total 60 min.
3. Elegir opcionalmente una preparación previa, cambiar fecha/hora/duración, guardar. Comida y preparación aparecen en Agenda. Ocultar Cocina las oculta sin borrar planes.
4. Editar receta en Recetario: plan mantiene versión anterior. Desde comida aceptar actualizar versión para cambiar explícitamente.
5. Mover comida desde Agenda; mantiene la fila y no pisa otra celda. En Planificar, reajustar pendientes si se desea. Preparación ya realizada mantiene marca/horario. Intentar completar comida/cocina está bloqueado.
6. Editar/agregar fila; nuevos planes usan su hora nueva, antiguos conservan horario. Borrar fila: revisar alcance, trasladar a fila vacía o borrar sus planes. Destino ocupado se rechaza.
7. Eliminar comida desde Planificador o Agenda: libera celda y quita hijos programados. Alacena no cambia.
8. Dos pestañas editando la misma comida: el guardado desactualizado pide revisión. Reintentos inciertos mantienen comando y no duplican bloque.

Sin suite funcional ejecutada en este bloque. TypeScript, migración e inspección del catálogo constituyen comprobaciones estáticas/de instalación, no verificación de todos los flujos.

Preferencias visuales pendientes solicitadas por el usuario: comparar Alacena con la interfaz inicial recuperable y acercar Recetario a Inbox con edición directa de pasos desplegados. Se dejan para un bloque visual posterior; no cambiar ahora su funcionamiento.


# Disponibilidad y sugerencias — 2026-10-05

Proyección pura compartida en src/availability.ts, sin mutaciones de stock, tandas ni completado. PlannerSnapshot carga en una misma transacción de lectura los planes pendientes de todas las fechas, saldos positivos y versiones actuales de recetas listas. No depende de la visibilidad del calendario. El contexto de planes usa cantidades/pasos congelados, no todo el historial de actividades. Desempate por inicio, creación e ID. Primero reservar obligatorios en orden cronológico, después opcionales; estos últimos no bloquean sugerencias. Cantidades con enteros de precisión de nueve decimales y faltantes mostrados hacia arriba a milésimas.

Se proyectan porciones por identidad de receta, compartidas entre versiones. Cada asignación disminuye la oferta prevista disponible para posteriores, impidiendo reservar las mismas porciones dos veces. Cocinar/Comer controlan producción/uso proyectado; no hay consumo al planear. Las dependencias de comidas aún pendientes se muestran como tales, incluidas carencias de ingredientes de su origen. No son tandas reales. Si Cocinar está desactivado y faltan porciones, se muestra necesidad de cocinar y sus ingredientes faltantes sin activar fases ni reservar una cocinada que el usuario no ha elegido.

El formulario vuelve a proyectar localmente al cambiar fecha, cantidades, recetas o fases, sustituyendo el plan editado para no contarlo dos veces. Las sugerencias evalúan cada candidata junto a las recetas del bloque; primero disponibles, después hasta tres ingredientes distintos faltantes. Límite ajustable en el selector y opción mostrar todas. Catálogo listo completo, sin depender de la primera página de 30 recetas. No se hacen consultas por cada pulsación de cantidades o búsqueda. Al guardar/volver al foco/reconectar se lee una nueva proyección coherente; mover desde Agenda entra en el mismo cálculo al volver a Planificar.

Revisión manual pendiente, sin pruebas funcionales ejecutadas:

1. Stock de 3 huevos; receta de una porción usa 2. Planearla en dos días: primer día alcanza, segundo avisa falta 1 huevo. Agregar un plan anterior redistribuye faltantes a posteriores; borrarlo los libera.
2. Repetir con comidas en otra semana; el rango visible no excluye sus reservas. Ocultar Cocina en Agenda no libera recursos.
3. Cocinar cuatro porciones el lunes y comer dos, con ingredientes suficientes. Martes sin cocinar, comer dos: mostrar dependencia del lunes. Miércoles otras dos: falta cocinar.
4. Cambiar martes a tres porciones: falta una. Reducir/borrar el origen: recalcular las comidas posteriores. Si el origen carece de ingredientes, conservar dependencia prevista mostrando ese impedimento.
5. Obligatorio y opcional usando el mismo ingrediente: el obligatorio de cualquier plan tiene prioridad; opcionales aparecen separados y no descartan sugerencias.
6. Selector: comprobar el orden, límite de faltantes, mostrar todas y cambio de cantidades/fecha del bloque sin guardarlo. Añadir una segunda receta descuenta su demanda de las siguientes candidatas.
7. Editar una receta no modifica cantidades congeladas; actualizar explícitamente un plan cambia su disponibilidad. Cambiar existencias en Alacena y volver a Planificar actualiza avisos.
8. Al planear no cambia Alacena; comidas y pasos de cocina continúan sin completado habilitado. Preparaciones previas mantienen su funcionamiento independiente.

No requiere migración de base de datos. Próximo bloque: movimientos reales de consumo, CookedBatch/PortionUse, completado y reversión con dependencias; después compras. Las dos etapas de planificación siguen pendientes de revisión del usuario.

# Consumos, tandas y completado — 2026-10-05

Migración aplicada 20261005000900_meal_consumption: MealCompletion (evidencia de ejecución, no otro estado editable de actividad), CookedBatch y PortionUse. Activity.completedAt sigue como única fuente de estado. Transacción bajo bloqueo por propietario y recibo idempotente: validar existencias reales, obtener cantidades de la revisión congelada, descontar mediante InventoryMovement, producir tandas, usar porciones y completar principal/pasos. Se suman cantidades de ingredientes y redondea una sola vez por ingrediente hacia arriba a tres decimales. Falta de ingredientes/porciones reales cancela el conjunto. Se puede completar una comida posterior aunque otra tuviera reservas previstas, recalculando después los pendientes.

Círculo de comida en Planner/Agenda ofrece selección de pasos opcionales, también sin ingrediente. Marcar uno a uno los obligatorios completa automáticamente; los opcionales marcados determinan uso. Un paso aislado no descuenta. Sin obligatorios aplicables, completar por círculo. Recordatorios previos completan independientemente. Cambiar recetas/porciones/fases de una completada requiere deshacer; mover horario conserva progreso y consumo.

Usar primero porciones nuevas del bloque, después tandas reales más antiguas de la misma receta (también entre versiones). Planner muestra existencias de porciones y origen/versión de lo consumido. Disponibilidad usa saldos reales, tandas restantes y reservas de planes pendientes; no cuenta dos veces planes completados.

Deshacer bloquea si otra ejecución activa consumió sus tandas, identificando las dependientes. Reversión crea movimientos exactamente opuestos, libera sus usos y revoca sus tandas; desmarca cocina/principal, conservando realizados los recordatorios previos. La selección anterior de opcionales se ofrece al completar otra vez, editable. Revisiones/recibos previenen efectos duplicados. Devolver ingredientes no puede exceder el máximo del saldo.

SQL protege propietarios, una ejecución activa por comida, evidencia inmutable salvo reversión, stock no negativo e igual al libro, usos no superiores a la tanda, rechazo de usos sobre tandas revocadas, reversión exacta y estado consistente al commit. Borrar/purgar quita presentación/celda/horarios sin devolver inventario ni eliminar tandas/usos. Retención conserva principal/hijos protegidos; opcionales de cocina no utilizados no bloquean por estar desmarcados. La suite anterior de retención no verifica esta extensión: no se ejecutaron pruebas funcionales nuevas.

Revisión manual pendiente:

1. Cuatro huevos en Alacena; receta usa uno por porción. Cocinar cuatro/comer dos y completar: cero huevos y dos porciones reales restantes.
2. Otra comida sin Cocinar/comer dos: antes de completar origen no permite consumir solo previsiones; después consume sobras sin volver a descontar huevos.
3. Deshacer origen mientras segunda completada: explica dependencia y no cambia saldos. Deshacer segunda y origen: devuelve cuatro huevos y revoca las tandas.
4. Círculo: elegir opcionales; solo elegidos se descuentan. Deshacer y repetir ofrece la elección anterior.
5. Ver pasos: primer obligatorio no consume; último completa con los opcionales marcados. Falta de stock cancela la última marca y completado. Recordatorio previo permanece realizado al deshacer.
6. Completar posterior con existencias reservadas para anterior: permite si realmente existen y recalcula faltantes de pendientes.
7. Varias tandas/versiones: usar antiguas primero salvo porciones recién cocinadas en el propio bloque. Consultar origen/versión en Planificar.
8. Dos pestañas/reintentos: rechazar revisiones obsoletas y no duplicar consumos. Borrar realizada no devuelve ingredientes; sus sobras continúan disponibles.

TypeScript raíz/núcleo y catálogo comprobados; vista previa reiniciada. Compras, copias semanales y cambios visuales diferidos continúan pendientes.


### Recetario: entrada rápida y borrador automático (2026-10-05)

Nombre para crear; porciones y minutos siempre visibles; sin descripción editable ni botón redundante Nueva receta. Los pasos se agregan con una entrada compacta, selección opcional de ingrediente y cantidad. Opcional corresponde a todo el paso. Guardar receta persiste el conjunto con revisión esperada. El servidor deriva draft al guardar: requiere porciones, tiempo, pasos y al menos un ingrediente válido. Las revisiones históricas no se reescriben; guardar una receta anterior aplica la nueva regla. Descripción histórica permanece en PostgreSQL por compatibilidad con revisiones inmutables, pero el editor no la usa. PROJECT.md y MODELO_OBJETIVO reflejan la regla aprobada. Comprobación estática TypeScript; revisión funcional pendiente del usuario.


### Corrección de opcionales y revisión de comida (2026-10-05)

La selección de opcionales del círculo muestra ingrediente/cantidad para las porciones a cocinar, instrucción y receta. La equivalencia se identifica como correspondiente a porciones base. El DTO obtiene cantidades de la revisión congelada, sin usar existencias ni datos actuales del recetario. Planificar espera la consulta actual antes de abrir una comida; bloquea acciones mientras refresca tras una mutación y ofrece recargar si la revisión cambió mientras el formulario estaba abierto. Mantiene revisiones esperadas, sin reintentar borrados sobre versiones ajenas automáticamente. Comprobación TypeScript; revisión funcional pendiente.


### Corrección SQL al deshacer comidas (2026-10-05)

El fallo 42703 al deshacer provenía de la consulta de reversión que usaba old como alias, ambiguo con OLD del trigger. La migración 20261005001000_inventory_reversal_alias reemplaza solo la función de validación con original_line/reversal_line, conserva comprobación exacta de unidades y cantidades y no altera datos ni migraciones aplicadas. Aplicada a miagenda_core. Los intentos fallidos fueron transacciones revertidas; puede reintentarse el mismo comando. Comprobación funcional pendiente del usuario.

## Compras del núcleo propio — 2026-10-05

Migraciones 20261005001100_shopping y 20261005001200_shopping_unit instaladas; 34 tablas de dominio, 53 triggers y 34 checks en public. ShoppingService comparte bloqueo por usuario e idempotencia con actividades, cocina y ajustes. GET calcula necesidades sin escribir: todas las semanas, solo comidas pendientes con Cocinar activo. Suma por ingrediente, redondea a milésimas por bloque y reserva stock primero para obligatorios, después opcionales. Las cantidades elegidas persisten separadas; registrar compra guarda la cantidad real y limpia el ajuste para necesidades futuras. Artículos manuales al final, X a la izquierda y botón Comprado alineado.

Comprar todo es atómico, con operación/recibo por artículo y commandId compartido; reintentar una respuesta incierta conserva ese mismo comando. Cada ingrediente produce un movimiento positivo y vuelve a figurar en Alacena. Texto libre no crea ingrediente ni movimiento. Deshacer registra reversión exacta y resta la cantidad real, bloqueando saldos negativos; vuelve a abrir un artículo libre o restaura la cantidad elegida de un ingrediente calculado cuando corresponde. No borra recetas, planes ni evidencias de consumo.

Comprados muestra 30 días, paginados de 50; el límite no elimina movimientos/recibos. Se refresca al volver a la pantalla/foco, reconectar y mutar, sin sondeo periódico. Cambios sin guardar permanecen; si la revisión cambió, se pide revisar/confirmar esa cantidad antes de comprar. La API rechaza una revisión obsoleta en una transacción.

Revisión manual del usuario (sin pruebas funcionales ejecutadas por el agente):

1. Dejar en Alacena 0 huevos. Planificar dos comidas con Cocinar activo que sumen 7 huevos, una en otra semana. Compras debe mostrar una sola fila con 7, aunque estés viendo solo una semana o hayas ocultado Cocina en Agenda.
2. Desactivar Cocinar en una de esas comidas. Su demanda desaparece de Compras. Si faltan sobras, el aviso sigue en Planificar; no activa Cocinar por sí solo.
3. Usar el mismo ingrediente en un paso obligatorio y otro opcional. Revisar el desglose; si hay stock, cubre primero obligatorios.
4. Cambiar los 7 huevos a 12 y marcar Comprado. Alacena aumenta 12, una sola vez; los faltantes se recalculan y aparece el recibo de 12. También puede guardarse la cantidad antes de comprar y regresar después: el ajuste permanece.
5. En Comprados, Deshacer: Alacena pierde los mismos 12 y la necesidad vuelve según los planes actuales. Si se consumieron y no quedan 12, bloquea la reversión con explicación.
6. Agregar un ingrediente adicional y jabón como Otro artículo. Ambos aparecen al final con X; comprar jabón no crea ingrediente. Comprar el ingrediente sí aumenta su saldo. Deshacer cada uno reabre su artículo.
7. Marcar todo comprado con varios artículos y cantidades distintas. Cada uno tiene recibo individual reversible; comprobar cantidades reales en Alacena. Probar X sobre un libre pendiente y revisar alineación en celular.
8. Cambiar un plan o Alacena desde otra pestaña y volver a Compras: recalcula. Si hay cantidad sin guardar, conserva el texto y pide revisarlo. Reintentar una compra incierta usa el mismo comando.

Esquema/cliente y TypeScript raíz/núcleo comprobados; migraciones aplicadas y catálogo leído. Vista previa reiniciada. No se añadieron ni ejecutaron pruebas funcionales ni se crearon compras de prueba. Pendientes posteriores: copias/borrado de semana, sustitución de ingredientes entre referencias, revisión integral y cierre de compatibilidad Calendar.

## Copiar y borrar semanas en el núcleo propio

Bloque conectado el 2026-10-06, sin migración ni dependencias nuevas. PROJECT.md no cambió.

- Copiar semana anterior aparece exclusivamente en una semana lunes–domingo sin comidas. En vista de dos semanas se ofrecen acciones independientes para cada una.
- Un clic inicia revisión automática; muestra cantidad de bloques y cuántas veces se copiará cada receta, agrupando sus versiones. Sin comidas de origen se informa y no se crea nada. No hay selector de origen/destino ni botón separado Revisar copia.
- El origen son las comidas que siguen visibles en esa semana. Una actividad eliminada o purgada tras sus cinco días no se reconstruye a partir de consumos; Conservar mantiene una comida programada según las reglas existentes.
- Se conservan revisión congelada, recetas/porciones, fila, hora local, duración y fases, incluso el ajuste manual de duración. Cada bloque/paso recibe una identidad nueva y comienza pendiente, sin Conservar/Destacar ni consumos/tandas anteriores.
- Preparaciones previas se ofrecen desde los pasos de la versión copiada, inicialmente sin seleccionar. Cada una permite cambiar fecha, hora y duración. Se propone 15 minutos y un inicio ajustado hacia atrás a la cuadrícula de 15 minutos. No se copia el completado ni la hora manual de las preparaciones anteriores.
- Cocinar desactivado permanece desactivado: no se inventan tandas ni se generan pasos de cocina/preparaciones. La disponibilidad de sobras se recalcula sobre recursos y reservas actuales.
- Borrar comidas de esta semana pide confirmación con cantidades pendientes/completadas. Retira principales/hijos/horarios y libera celdas, sin deshacer consumos, revocar tandas, devolver stock ni borrar evidencia. Filas, recetario y planes de otras semanas permanecen.
- Ambos comandos validan revisión global dentro del mismo bloqueo por propietario y recibo idempotente. Una semana que se ocupó después de revisar cancela la copia completa. Reintentar el mismo comando no duplica ni elimina planes creados después del primer resultado.
- Inserciones agrupadas por tabla, con hasta 500 filas por sentencia; borrado agrupado por semana. No son comandos independientes por cada comida. Una transacción fallida no deja una semana parcialmente copiada.
- El planificador refresca después del comando; compras deriva los faltantes de todas las comidas pendientes con Cocinar activo al entrar/actualizar, conservando ajustes de cantidades. Ocultar un calendario no libera reservas.

API: GET /api/core?view=mealWeekPreview&mode=copy|delete&start=YYYY-MM-DD; POST acciones copyPreviousMealWeek/deleteMealWeek, con start lunes y expectedDataRevision. La copia admite selección de recordatorios referidos a las recetas del origen; el servidor valida pertenencia y horarios. No se añadieron ni ejecutaron pruebas funcionales. Comprobación TypeScript de ambos árboles; revisión funcional pendiente del usuario.

### Revisión manual de este bloque

1. Elegir una semana con dos o más comidas, una receta repetida y alguna preparación previa. Puede contener comidas ya completadas.
2. Ir a la semana siguiente, vacía, y pulsar Copiar semana anterior. Se revisa sola: comprobar número de comidas y repeticiones de recetas. Si la anterior está vacía, aparece un aviso sin crear comidas.
3. Seleccionar opcionalmente una preparación previa y cambiar su fecha/hora/duración. Confirmar copia. Todos los círculos/pasos nuevos quedan pendientes; recetas, porciones, fases y hora coinciden. La versión anterior se conserva aunque se haya editado el recetario.
4. Abrir Agenda, Compras y disponibilidad de Planificar: fechas nuevas, faltantes de cualquier semana y sobras/reservas recalculadas. Copiar por sí solo no cambia Alacena.
5. La semana con comidas ya no muestra Copiar semana anterior. Pasar a Dos semanas: cada semana tiene su propia acción y la copia solo aparece en la que esté vacía.
6. En una semana con una comida cocinada, anotar stock/sobras y borrar esa semana tras revisar el resumen. Las tarjetas y sus recordatorios desaparecen de Agenda; stock y tandas/consumos reales permanecen. Las otras semanas recalculan dependencias sin devolver alimentos.
7. Cancelar un borrado: no cambia nada. Abrir la revisión en una pestaña, modificar planes en otra y regresar: se exige actualizar antes de confirmar sobre información distinta. Los reintentos inciertos siguen usando el mismo comando.

## Retirar y reemplazar ingredientes

Bloque conectado el 2026-10-06: revisión previa desde la X en Alacena, sustituto existente o nuevo, traslado de stock con la misma unidad, revisiones nuevas en recetario y actualización explícita de versiones congeladas pendientes. El historial y las reversiones exactas permanecen intactos. Ingredientes retirados sin sustituto pueden recuperarse; los unificados usan su sustituto.

GET ingredientImpact/removedIngredients y POST retireIngredient, dentro del protocolo común de revisión global, bloqueo por propietario e idempotencia. Migración 20261006000100_recipe_snapshot_copy aplicada a miagenda_core. Sin dependencias nuevas. Revisión manual, límites y detalles en [INGREDIENTES_REEMPLAZO.md](../../docs/INGREDIENTES_REEMPLAZO.md). PROJECT.md no cambió.

## Crear comidas desde Agenda

Bloque conectado el 2026-10-06. Crear ofrece Tarea/Comida; Comida carga bajo demanda el editor compartido con Planificar, conservando fecha/hora pulsadas y sugiriendo una fila por cercanía. Si la celda está ocupada, avisa y ofrece abrir el bloque existente para añadir recetas; las comidas completadas requieren deshacer antes de editarlas. Se mantienen filtros de calendarios y los protocolos de consumo/compras.

Nuevo GET mealCell para consultar una celda fuera de la semana cargada, autorizado por usuario. Se reutiliza POST saveMeal, sus validaciones, bloqueo e idempotencia. Sin migraciones ni dependencias nuevas. Detalles y revisión manual en [COMIDAS_DESDE_AGENDA.md](../../docs/COMIDAS_DESDE_AGENDA.md). PROJECT.md no cambió.

## Revisión integral de cierre · 2026-10-07

76 comprobaciones integrales, 30 de retención y 4 de acceso/aislamiento aprobadas, con esquemas de prueba eliminados. Se repararon el guardado de revisiones de recetas (migración incremental aplicada), el traslado de inventario al sustituir un ingrediente y las consultas que dependían del search_path de conexiones compartidas. Se comprobó el flujo visual Inbox → Agenda, destacados en Año y apertura de comida existente desde Agenda. TypeScript de núcleo y aplicación aprobado. Evidencia y límites en [RESULTADOS_REVISION_INTEGRAL.md](../../docs/RESULTADOS_REVISION_INTEGRAL.md). PROJECT.md sin cambios; sin dependencias nuevas.

## Captura rápida global · 2026-10-07

Botón flotante «＋ Anotar» en Inbox, Agenda y apartados de Cocina. Formulario de texto máximo 250 caracteres; crea Activity task sin horario mediante POST /api/core. Guardar cierra el cuadro y confirma sin navegar. Si falla o la respuesta es incierta conserva el texto y el mismo commandId/id para reintentar; no permite editar ese intento hasta resolverlo. Cerrar conserva el borrador en memoria durante la sesión; ir al acceso lo limpia. Sin consultas en segundo plano: al guardar desde Inbox solo se actualiza su lista mediante el evento local miagenda:inbox-captured. No analiza fechas, no crea comidas y no añade almacenamiento offline.

TypeScript de aplicación aprobado; no se añadieron ni ejecutaron pruebas de este bloque. Comprobación manual pendiente: desde Compras pulsar Anotar, escribir un pendiente, guardar y verificar que permanece en Compras; abrir Inbox y comprobarlo. Repetir desde Inbox para ver actualización inmediata. Cerrar sin guardar y reabrir para comprobar borrador; en login no aparece el botón. PROJECT.md sin cambios; sin migraciones ni dependencias nuevas.

## Acomodo compacto de Alacena · 2026-10-07

Se recuperó la organización vertical de la interfaz anterior usando los servicios actuales: catálogo buscable con botones compactos arriba, formulario de cantidad bajo el seleccionado y Lo que tienes debajo. Editar personalizados y eliminar/reemplazar se ofrecen al seleccionar el ingrediente. Nueva opción No encuentras un ingrediente abre el editor actual con sus validaciones. Stock mantiene cantidad, Guardar solo al cambiar y Quitar; movimientos y edición están en Más. Sin existencias, retirados, paginación y controles de concurrencia permanecen disponibles. CSS limitado al acomodo de Alacena, con renglones adaptados a pantallas estrechas.

TypeScript aprobado; sin pruebas añadidas ni ejecutadas. Revisión manual pendiente: recargar Alacena, seleccionar ingrediente, revisar cantidad y acciones; comprobar listas de stock/Sin existencias y Más. No cambia API, base de datos ni PROJECT.md.

## Crear visualmente desde Semana · 2026-10-07

Pulsar una casilla crea un bloque provisional de una hora, sin enviar comandos. Un cuadro no modal al lado permite nombre, calendario, fecha y horarios de 12 horas; el bloque se mueve y ajusta con los gestos actuales en intervalos de 15 minutos. Otra casilla reubica el mismo borrador conservando nombre y duración. X/Escape descartan directamente; pulsar fuera no cierra. Guardar reutiliza createTask y los reintentos idempotentes existentes. Más opciones mantiene los datos y abre el formulario completo, incluida recurrencia; Comida abre el flujo especializado actual con la fecha/hora elegidas. Cambiar de vista o navegar a otra semana cancela el borrador. Mes/Día mantienen su creación actual. Sin cambios de base de datos, PROJECT.md o dependencias.

Compilación y comprobación de tipos; no se añadieron ni ejecutaron pruebas funcionales. Revisión manual del usuario: pulsar una casilla, escribir nombre, mover con otra casilla y arrastrar, cambiar duración, guardar; comprobar que X/Escape no crean actividad; probar Más opciones y Comida.


## Navegación lateral desde la derecha · 2026-10-07

Navegación compartida en Inbox, Agenda, Alacena, Recetas, Planificar, Compras y carga. Se inicia oculta y se abre con tres líneas arriba a la derecha; se cierra con el mismo botón, Escape, pulsando fuera o eligiendo una página. Cocina es un grupo desplegable, sin enlace propio, con Alacena, Recetas, Planificar y Compras. Agenda conserva dentro del panel los controles para mostrar, crear y editar calendarios. Panel modal con foco contenido; Escape del menú no descarta el borrador de creación en Semana. Sin cambios de datos, dependencias ni PROJECT.md.

Comprobación de tipos y compilación aprobadas. Sin pruebas funcionales ejecutadas. Revisión manual: abrir/cerrar el menú, desplegar Cocina y visitar sus cuatro apartados; revisar los controles de calendario en Agenda.


## Menú izquierdo y aprovechamiento de espacio · 2026-10-07

El menú compartido abre desde la izquierda, con el botón en esa esquina y cierre equivalente dentro del panel. Se reducen márgenes horizontales de las páginas y se elimina el límite de ancho del contenido. Agenda reúne nombre, rango y controles en una única cabecera adaptable, retirando TU TIEMPO, el encabezado duplicado y las instrucciones de arrastre. Semana utiliza más altura disponible sin cambiar gestos, horarios ni consultas. Sin cambios de datos ni PROJECT.md. Comprobación de tipos y compilación; revisión visual manual pendiente.


## Mantener el borrador al pulsar eventos existentes · 2026-10-07

Mientras existe un borrador de creación en Semana, abrir una actividad existente no hace nada. Mantiene el nombre y horario del nuevo bloque y evita abrir un segundo formulario; mover eventos persistidos ya estaba deshabilitado durante el borrador. Las casillas vacías siguen reubicándolo. Al guardar o cancelar se recupera la apertura normal de detalles. Sin cambios de datos ni PROJECT.md. Compilación; revisión manual pendiente.


## Detalle junto al evento en Semana · 2026-10-07

Los eventos creados en Semana abren un panel no modal junto al bloque pulsado, sin fondo gris ni bloqueo del calendario. Reutiliza TaskCard y sus comandos, subtareas y acciones; se adapta a bordes, cambios de tamaño y desplazamiento. X/Escape/clic fuera cierran salvo operación en curso o un formulario modal secundario abierto. Otros eventos pueden seleccionarse directamente. Las tarjetas se reinician por identidad para evitar conservar edición de otra actividad. Mes/Año conservan su detalle actual. Sin cambios de datos ni PROJECT.md. Comprobación de tipos y compilación; revisión manual pendiente.


## Foco de creación y superposición de bloques · 2026-10-07

Al soltar el puntero dentro del calendario durante la creación, el nombre recupera foco sin desplazar la página, permitiendo seguir escribiendo después de arrastrar, redimensionar o pulsar otra casilla. No se roba foco durante el arrastre ni a formularios modales. Cambio visual solicitado para solapados: los más largos ocupan el fondo; los más cortos se superponen con un margen que mantiene accesible el bloque de atrás. Igual duración e inicio se distribuyen en columnas dentro de esa capa. Duración igual pero inicio posterior se muestra encima. Orden determinista por ID, intervalos mínimos visibles considerados, y capas aisladas por día para no tapar encabezados, línea actual o borrador. Sin cambios de horarios ni datos; PROJECT.md permanece sin modificar. Comprobación de tipos y compilación; revisión visual manual pendiente.


## Información visible en bloques superpuestos · 2026-10-07

Cuando los bloques superpuestos alcanzan el área inicial de un evento (64 minutos visuales), se reserva una franja del 42% del ancho del evento de atrás para su resumen. Los bloques superiores se desplazan a la derecha; el contenido del bloque inferior se limita a esa franja. Si su cabecera ya queda visible por comenzar los otros mucho después, se mantiene el margen pequeño. Semana muestra nombre y horas de inicio/fin de 12 horas sin repetir la fecha; el título emergente conserva nombre y horario completos. Sin cambios de datos ni PROJECT.md. Comprobación de tipos y compilación; revisión visual manual pendiente.


## Crear Comida al lado del bloque en Semana · 2026-10-07

Elegir Comida durante la creación en Semana mantiene el formulario junto al borrador, sin fondo gris ni bloqueo modal. Reutiliza AgendaMealCreator/MealEditor y sus validaciones, colisiones, disponibilidad, comandos e idempotencia. El panel se ajusta al borde y tamaño de contenido, con desplazamiento propio; pulsar fuera lo mantiene abierto y X/Escape cierran salvo guardado/reintento pendiente. Se evita reubicar solo el bloque al pulsar una casilla mientras el editor especializado está activo, pues los horarios se editan dentro del formulario. Navegación de Agenda bloqueada durante operaciones de Comida. Otras vistas conservan sus formularios actuales. Sin cambios de datos, reglas ni PROJECT.md. Compilación y tipos; revisión manual pendiente.


## Creación directa con calendario, repetición y Todo el día · 2026-10-07

Se amplía el selector horario compartido con ancho mínimo suficiente para dos cifras y la flecha nativa. El panel de creación en Semana es ligeramente más ancho; en pantallas estrechas los horarios se apilan. Se retira Más opciones y se muestran Todo el día y Repetición directamente, reutilizando RecurrenceFields/parseRecurrence y los comandos existentes. Todo el día muestra borrador en la fila superior, admite último día inclusive y guarda fin exclusivo; volver a horario conserva las horas previas. Calendario incorpora Nuevo calendario con nombre/color inline y creación idempotente independiente, seleccionado al confirmar. Guardar actividad queda deshabilitado mientras se está definiendo un nuevo calendario. La creación desde otras vistas también ofrece calendario inline. El panel se recoloca al cambiar de tamaño por estas opciones. Sin cambios de base de datos, dependencias ni PROJECT.md. Comprobación de tipos y compilación; revisión funcional manual pendiente.


## Fecha única y legible al crear · 2026-10-07

En la creación rápida de Semana se sustituye la fecha duplicada por un único control que muestra día de la semana, día, mes y año escritos. Pulsarlo abre el selector nativo de fecha en el mismo panel; también accesible con teclado y etiqueta, con indicador de foco. Reutiliza changeStart para conservar la duración y actualizar borrador/repetición. El último día de actividades Todo el día sigue siendo un control separado por representar otra fecha. Sin cambios de datos ni PROJECT.md. Compilación; revisión manual pendiente.

## Subtareas visibles y edición dentro de la tarjeta · 2026-10-07

Inbox, Día y el detalle de Agenda abren por defecto las subtareas existentes. Las comidas muestran sus pasos y preparaciones al abrir su detalle; el editor de planificación despliega los pasos de cada receta. El recetario muestra los pasos guardados desde la lista, conservando la edición de una única receta para proteger borradores sin guardar. Sin hijos no hay sección vacía. Agregar subtarea/paso comienza con ＋, enfoca el campo y admite Enter; los pasos de receta mantienen ingrediente, cantidad, equivalencia y opcional, con Guardar receta para persistir.

Editar tarea retira el campo de descripción (sin borrar datos existentes) y agrupa horario, repetición, borrar y aplicar completado dentro de la tarjeta. Horario, frecuencia, confirmación de borrado y alcances recurrentes usan paneles inline en lugar de diálogos modales. Los alcances disponibles y los comandos existentes se conservan. El horario de subtarea también se abre dentro de la fila. Sin cambios de modelo, base de datos, dependencias ni PROJECT.md. TypeScript y compilación de producción correctos; revisión funcional manual pendiente.

## Controles compactos de subtareas · 2026-10-07

Se retira Aplicar marca… de las filas de subtareas. Agendar/Cambiar horario usa un reloj y Editar un lápiz, con etiquetas accesibles y títulos explicativos; eliminar conserva X con el mismo ancho compacto. El nombre recibe el espacio restante y puede ocupar varias líneas. ScheduleButton conserva texto en tareas principales. No cambia el completado rápido, horarios, datos ni PROJECT.md. Compilación de producción; revisión visual manual pendiente.

## Editor único de tareas y acciones en esquina · 2026-10-07

Las tareas normales muestran lápiz y papelera arriba a la derecha; Borrar sale del editor y conserva confirmación/alcances inline. Las subtareas y comidas usan papelera en lugar de X para eliminar. TaskEditor muestra nombre y horario directamente, con un único Guardar y envío mediante Enter; Con fecha permite programar o quitar horario (solo esta instancia), y Todo el día conserva el fin exclusivo. En series existentes muestra la frecuencia cargada, los alcances y resumen previo al cambio; Aplicar completado permanece dentro de Editar. Los alcances de serie continúan disponibles desde Semana/Mes. La edición de subtareas dentro de su principal continúa siendo rápida.

saveTask normaliza y valida nombre/horario/frecuencia, guarda en una sola transacción bajo el bloqueo del propietario y registra un recibo idempotente. Reutiliza los servicios de horario, alcance y cambio de frecuencia; valida revisiones iniciales y el resumen antes de sus propios cambios. Actualiza las revisiones internas entre operaciones sin aceptar revisiones iniciales obsoletas. Agenda vuelve a consultar el rango después del guardado conjunto para recoger series virtuales. Sin migraciones, cambios de PROJECT.md ni borrado de datos. La creación de series nuevas sigue en Crear; el formulario integrado modifica la frecuencia de series existentes. TypeScript y compilación correctos; revisión funcional manual pendiente.

## Captura seguida de subtareas y guardado por lote · 2026-10-07

Agregar subtareas mantiene el campo enfocado después de Enter y prepara una lista local de borradores, sin escribir a la base por cada línea. Listo incluye la última línea escrita y pide confirmar el guardado conjunto; en principales recurrentes ofrece Solo esta/Esta y siguientes/Toda la serie una vez para todo el lote, también al capturar desde Día. Permite quitar borradores, seguir agregando o descartarlos. Los reintentos conservan los mismos IDs y recibo. Máximo 50 por lote y títulos de 150 caracteres para recurrentes compartidas. Los pasos especializados de cocina conservan su editor.

addSubtasks valida revisión de principal/serie y propietario; guarda lote y recibo en una transacción. Solo esta crea hijos y claves estables mediante createMany y reconcilia la principal una vez. Los alcances reutilizan el servicio de serie y actualizan internamente las revisiones entre líneas. Agregar pendientes reabre principales completadas según la regla vigente. La referencia virtual capturada no se reemplaza silenciosamente por otra revisión al enviar. Sin migraciones ni cambios de PROJECT.md. Tipos y compilación; revisión manual pendiente.

## Corrección de timeout al agregar subtareas recurrentes · 2026-10-07

El servidor registró P2028 durante el lote compartido. Se retira el bucle que ejecutaba todo el servicio de creación y releía actividades/series por cada subtarea. addSubtasks pasa el lote completo al servicio de alcance: crea claves estables, definiciones por segmento e hijos de instancias materializadas con createMany; reabre principales completadas en un updateMany e invalida la serie una vez. El orden se agrega después del máximo existente entre las definiciones e instancias del alcance. Se conservan IDs, recibo idempotente, revisión esperada, validaciones de propietario y transacción única. El comando anterior puede reintentarse sin volver a capturar. Sin cambio de PROJECT.md ni aumento del límite de tiempo de transacciones. Compilación; reintento del usuario pendiente.

## Recetario compacto y captura con Enter · 2026-10-07

Crear por nombre abre la receta arriba y enfoca Porciones. Enter pasa a tiempo, instrucción, búsqueda de ingrediente, cantidad y equivalencia opcional; agregar vuelve a enfocar la instrucción del siguiente paso. Con búsqueda vacía, Sin ingrediente es la primera opción: dos Enter desde la instrucción agregan un paso sin ingrediente. Con texto, se ordenan coincidencias exactas, prefijos, parciales y aproximadas entre ingredientes cargados; flechas permiten elegir otro resultado. Se conserva crear ingredientes desde el buscador y cargar más catálogo. La cantidad debe ser positiva y Guardar receta continúa guardando los pasos en conjunto. Los opcionales y preparaciones previas mantienen sus reglas.

Se compactan tarjetas, metadatos y compositor. El disparador de navegación se desplaza con la página para no flotar sobre las recetas al bajar. Sin cambios de base de datos, dependencias ni PROJECT.md. Compilación de producción y tipos correctos; revisión visual y funcional del usuario pendiente.

## Pasos cerrados y tarjetas compactas del recetario · 2026-10-07

La lista inicia con los pasos plegados. Abrir el resumen de otra receta cierra el anterior; cambiar desde un editor con cambios mantiene la confirmación de descarte. El editor conserva un solo paso desplegado mediante su clave activa. Se reducen márgenes, espaciado y tamaño de campos y resúmenes, priorizando ingrediente/cantidad sobre la instrucción. El recorrido con Enter y Guardar receta siguen vigentes. Sin cambios de datos ni PROJECT.md. Compilación y tipos correctos; revisión visual del usuario pendiente.

## Crear ingrediente como resultado de búsqueda · 2026-10-07

Al escribir en el buscador de ingrediente de un nuevo paso, si no hay coincidencias cargadas, el único resultado es Crear ingrediente con el nombre escrito. Enter o clic abre el editor con el nombre precargado; se retira el botón inferior permanente. Búsqueda vacía mantiene Sin ingrediente primero. IngredientEditor conserva sugerencias y confirmación de nombres similares (huevo/huevos), bloqueo de duplicados exactos y validación del servidor; no fusiona IDs. Sin cambios de PROJECT.md ni datos. Compilación y tipos correctos; revisión manual pendiente.

## Un único desplegable de receta · 2026-10-07

Se retiran el resumen desplegable Pasos y el botón + exteriores de las tarjetas. El nombre de la receta es la única entrada para desplegar su contenido, manteniendo una tarjeta abierta a la vez y confirmación de descarte. Al abrir una receta sin pasos, el compositor aparece directamente; si tiene pasos, muestra + dentro del editor para empezar otro. La captura seguida con Enter, ingredientes, cantidad, equivalencia y Guardar receta se conservan. Sin cambios de datos ni PROJECT.md. Compilación y tipos correctos; revisión visual del usuario pendiente.

## Planificador lateral y Cocinar por receta · 2026-10-07

Aprobado por el usuario: deshabilitar recetas ya agregadas, mostrar aviso solo cuando existe una versión nueva, elegir Cocinar por receta y mantener Comer/Lavar por bloque. PROJECT.md y MODELO_OBJETIVO reflejan estas reglas. Cocina propia se representa con las porciones a cocinar: cero cuando está desactivada; el indicador de cocina del bloque resume si alguna receta se cocinará. No requiere migración. Disponibilidad, compras, preparación previa, tiempos combinados y consumo reutilizan los cálculos que ya distinguen porciones cero. La casilla se reconstruye al reabrir; activar nuevamente propone porciones a comer o porciones base. El guardado exige cantidad positiva cuando se elige cocinar.

Planificar y abrir comidas usa un cuadro lateral no modal junto a la celda, sin arrastrar y sin fondo gris, con X/Escape y sin cerrar por clic exterior. Recetas agregadas inmediatamente debajo de fecha/inicio/tipo y encima del buscador. Se retiran Ver pasos del editor y de las celdas; las comidas completadas conservan su revisión de progreso y origen en un cuadro lateral. Cada receta aparece deshabilitada en las opciones después de agregarla; el guardado verifica identidad de receta incluso entre versiones distintas. No se borran duplicados antiguos automáticamente: el usuario puede quitar la repetida y guardar. Versiones/snapshots se conservan, con actualización expresa ante aviso. Compilación y tipos correctos; revisión funcional del usuario pendiente.
## Ingredientes por cantidad o disponibilidad · 2026-10-07

Reglas aprobadas por el usuario y reflejadas en PROJECT.md y MODELO_OBJETIVO. Seguimiento privado por ingrediente: Por cantidad conserva el inventario numérico; Solo disponibilidad usa Tengo/Se terminó y no reserva ni descuenta cantidades al cocinar. El catálogo compartido conserva nombre/unidad, sin cambiar el modo de otros usuarios. Alacena permite cambiar seguimiento desde el catálogo y las existencias. Crear un personalizado también permite elegirlo.

Los pasos de receta por disponibilidad admiten cantidad nula e indicación humana opcional, con recorrido Enter directo a esa indicación. Cumplen el requisito de ingrediente para planificar. Disponibilidad cronológica y sugerencias comprueban Tengo sin agotarlo; los opcionales no bloquean las sugerencias y conservan la selección al completar. Completado y deshacer de comidas conservan tandas y reversiones exactas; no modifican el estado Tengo.

Compras agrupa una necesidad por ingrediente no disponible, sin cantidad ficticia. Comprar guarda un recibo diferenciado y activa Tengo, sin movimiento numérico. Deshacer restaura el estado y origen anteriores solo si la compra sigue siendo la última operación de disponibilidad; cambios manuales, cambio de modo y sustitución invalidan esa reversión para no sobrescribirlos. Recibos numéricos siguen creándose por lote. Cantidades históricas y movimientos se conservan al pasar a disponibilidad; volver a cantidad pide existencias reales y registra su ajuste. Una versión congelada sin cantidad no inventa descuentos al volver a cantidad: solicita una cantidad real al comprar si falta stock y puede cuantificarse editando receta y actualizando el plan expresamente. Sustituciones requieren modos compatibles y conservan evidencia.

Migración 20261007000100_ingredient_availability aplicada en miagenda_core: modo personal, estado disponible, origen de recibo y metadata de reversión, además de validaciones SQL compatibles con compras sin cantidad. Cliente Prisma regenerado, tipos del núcleo y compilación de producción correctos. Sin nuevas dependencias ni borrado de datos. Revisión funcional manual pendiente; no se ejecutaron pruebas funcionales en este bloque.

## Compras: alta arriba y artículos compactos · 2026-10-07

Agregar artículo se mueve antes de Pendientes; Comprados permanece al final. Se reducen márgenes, separación y altura de filas, campos y botones, conservando las acciones de compra alineadas y la cantidad opcional debajo del total. Se compactan también los recibos y se mantienen los ajustes para pantallas pequeñas. Cambio de presentación sin modificar operaciones, datos ni PROJECT.md. Compilación de producción; revisión visual del usuario pendiente.

## Cantidades por comida y piezas redondeadas · 2026-10-07

Aprobado por el usuario: proponer piezas redondeadas hacia arriba al planificar, permitiendo cambiar cualquier cantidad, incluidas fracciones. Gramos y mililitros conservan el cálculo proporcional. PROJECT.md y MODELO_OBJETIVO reflejan la regla. MealRecipe guarda ajustes de cantidades por ingrediente y obligatoriedad/opcionalidad, sin editar la receta congelada ni el recetario. Usos repetidos se suman antes del redondeo y la cantidad se distribuye proporcionalmente entre pasos para conservar la selección individual de opcionales.

MealEditor compartido por Agenda y Planificar muestra Cantidades para cocinar debajo de porciones; Usar cálculo retira un ajuste. Las cantidades manuales permanecen al cambiar porciones, con explicación visible; actualizar expresamente la versión de receta avisa que se recalcularán. Desactivar Cocinar conserva ajustes para volver a activarlo y no reserva ni compra ingredientes. Solo disponibilidad mantiene Tengo/Se terminó y no necesita cantidad.

Proyección cronológica, sugerencias, lista de compras, detalles de pasos y consumo usan las mismas cantidades elegidas. Completar sigue registrando un movimiento real; deshacer usa ese movimiento exacto, no recalcula la receta. Copiar una semana conserva ajustes, crea planes pendientes y vuelve a proyectar sus fechas. Sustituir ingredientes en planes pendientes traslada o suma los ajustes compatibles; retirar referencias limpia sus claves. Los planes previos sin ajustes mantienen su cálculo proporcional original hasta modificar porciones o cantidades; sus consumos y recibos anteriores no cambian. Las lecturas comunes calculan cantidades una vez por receta dentro de cada árbol, sin consultas nuevas por ingrediente.

Migración 20261007000200_meal_ingredient_quantities aplicada en miagenda_core: JSON privado en MealRecipe y validación SQL de claves de ingredientes de la versión/propietario, cantidades positivas y límites. Cliente Prisma regenerado, tipos del núcleo y compilación de producción correctos. Sin nuevas dependencias ni borrado de datos. Revisión funcional manual pendiente; no se ejecutaron pruebas funcionales en este bloque.

## Revisión de últimos cambios de Cocina · 2026-10-08

Completada la revisión autorizada de porciones/cantidades manuales, Solo disponibilidad, compras/consumo y sobras/copias. Verificador independiente verify-recent-kitchen.ts incluido en la comprobación de tipos del núcleo: 45 comprobaciones aprobadas con servicios reales y migraciones en esquema PostgreSQL temporal; recent-kitchen-verification.json contiene failure null y temporarySchemaRemoved true. No se alteraron datos reales, PROJECT.md ni reglas de negocio; no se necesitaron migraciones ni cambios funcionales de la app. TypeScript raíz y núcleo sin errores.

Se corrigieron datos y expectativas del propio verificador (description null y distinción entre faltante calculado y cantidad elegida en Compras). Un corte de conexión interrumpió una ejecución: su esquema fue identificado y eliminado; se reforzó limpieza con conexión independiente y registro del nombre del esquema y se repitieron todas las comprobaciones. Revisión visual pendiente porque la herramienta de navegador no pudo iniciarse. Alcance, evidencia y reproducción en docs/RESULTADOS_COCINA_CANTIDADES.md.

## Planificar: cuadro de comida más compacto · 2026-10-08

Ajuste visual solicitado: cantidades con unidad al lado del campo (ml, g o pzas), nombres y opcionales en una misma fila, campos y separaciones más pequeños y botón Quitar receta ajustado al contenido. Los filtros del buscador dejan de heredar el relleno amplio de recipe-fields; límite y Mostrar todas comparten una franja compacta. Ayuda de cantidades abreviada, manteniendo la explicación de ajustes manuales y el botón Usar cálculo. Estilos limitados al editor de comidas compartido; sin cambios en cálculos, base de datos ni PROJECT.md. No se ejecutan pruebas funcionales en este bloque visual; compilación y revisión visual del usuario.

## Consolidación del estado documental · 2026-10-08

Actualizados README raíz, índice documental, arquitectura actual y guía del núcleo para reflejar revisión integral terminada, captura rápida global habilitada, uso diario local preparado, cantidades manuales y seguimiento de ingredientes por disponibilidad. El cierre tiene un resumen vigente y conserva sus apartados fechados como historial. Registrada la aceptación visual del usuario en el informe reciente de Cocina, diferenciándola de pruebas automatizadas y de revisión móvil.

Las guías de comidas desde Agenda y sustitución apuntan a la evidencia posterior; el acceso a Eliminar o reemplazar se corrige para coincidir con el catálogo actual. La guía integral deja de pedir el panel de movimientos retirado y enlaza las comprobaciones de respaldo local ya hechas. Se aclaran referencias históricas de rendimiento y del antiguo panel Sin existencias. Las propuestas de aclaración de PROJECT.md siguen sin aplicar y requieren aprobación específica; PROJECT.md no se modifica.

Pendientes vigentes: uso móvil, despliegue/seguridad del entorno público, offline limitado, compactación de recibos, rutinas relativas y módulos/dashboard futuros. Bloque solo documental: sin cambios de código, datos, migraciones, dependencias ni ejecución de pruebas funcionales.

## Clasificar recetas por filas de Planificar · 2026-10-08

Implementada la decisión aprobada: varios tipos por receta, definidos por las filas personales activas. Añadida relación RecipeMealSlot con claves compuestas de propietario, índices y validación de referencias activas. Migración 20261008000100_recipe_meal_slots aplicada a miagenda_core sin borrar datos. El recetario recibe filas en su snapshot y permite seleccionarlas con casillas; guardar conserva las garantías de revisión e idempotencia. Contratos anteriores sin slotIds conservan sus clasificaciones.

Sugerencias iniciales limitadas al tipo seleccionado y filtro de faltantes; búsqueda por nombre y Mostrar todas permiten cualquier receta lista, incluidas las no clasificadas, sin ocultar sus avisos. Filtrado previo al cálculo de candidatos para evitar trabajo innecesario. Renombrar conserva las relaciones por ID; retirar fila elimina sus asociaciones e incrementa la revisión de las recetas afectadas, sin borrar recetas ni cambiar snapshots planificados. No se infieren clasificaciones para recetas existentes.

PROJECT.md y modelo lógico reflejan las reglas aprobadas. Generación Prisma y comprobaciones TypeScript raíz/núcleo correctas; no se ejecutaron pruebas funcionales. Guía manual en docs/RECETAS_TIPOS_COMIDA.md.

## Completado rápido: opcionales con descuento · 2026-10-08

El círculo de comida pregunta solo por pasos opcionales con cantidad efectiva que se descuenta. Los opcionales por disponibilidad, sin cantidad o sin ingrediente mantienen su marcado manual y no se seleccionan por suposición ni por el último completado deshecho. Si no hay opcionales cuantificados, completa directamente. Los ingredientes por disponibilidad no cambian de Tengo a Se terminó al cocinar. El flujo paso a paso y sus validaciones permanecen activos.

La proyección común expone si el ingrediente se cuantifica, considerando tanto el snapshot como el modo personal actual; Agenda carga las preferencias pertinentes en un lote y Planificar reutiliza su contexto. Las respuestas de mutaciones usan la misma lectura común para evitar que el diálogo reaparezca por metadatos antiguos. Sin migraciones ni dependencias nuevas. PROJECT.md refleja el cambio aprobado. Comprobación de tipos del núcleo correcta; sin pruebas funcionales ejecutadas.

## Resumen de receta: ingredientes por disponibilidad · 2026-10-08

Ingredientes para las porciones base incluye también los ingredientes sin cantidad, antes omitidos. Se agrupan por ID y muestran la indicación humana del paso (por ejemplo, un chorrito), o al gusto si no hay indicación; se identifica opcional cuando todos sus usos sin cantidad son opcionales. Las cantidades numéricas mantienen su suma habitual. El resumen utiliza el modo personal actual y conserva referencias visibles de ingredientes aún no cargados en el catálogo cuando hay snapshot. Ajuste de presentación, sin cambios de inventario, compras, esquema ni PROJECT.md. Sin pruebas funcionales ejecutadas.

## 2026-10-08 — Pasos como tramos previos

- Marca de previo desde el compositor; agrupación hasta cada límite, programación sobre el mismo paso y compatibilidad explícita con snapshots anteriores.
- Completar/deshacer por tramo con dependencias; pregunta de opcionales al finalizar y consumo único del bloque. Deshacer conserva preparaciones previas.
- Migración aditiva `20261008000200_recipe_prior_groups`; guía en `docs/RECETAS_TRAMOS_PREVIOS.md`.

### Ajuste visual de preparaciones previas

- Encabezado de receta, paso previo junto a su selección y resumen de ingredientes con texto de paso como alternativa.
- Duración inicial de 5 minutos al planificar, copiar semana o programar una previa sin horario; horarios guardados conservan su duración.

## 2026-10-08 — Horarios de subtareas recurrentes por alcance

- Programar/cambiar/quitar con tres alcances desde el reloj y editor; hora y diferencia de días respecto a cada principal.
- Regla en definición versionada por segmento, calendarios propios y proyección por rango sin instancias infinitas. Completadas conservan su horario, incluidas las virtuales; eliminadas no se recrean.
- Integración con cambios de frecuencia, excepciones, traslado/borrado de calendarios y vistas con principal en otro día/calendario.
- Migración aditiva `20261008000300_recurring_subtask_schedules`; guía manual en `docs/SUBTAREAS_HORARIO_SERIE.md`.


## Calendario heredado de subtareas — 2026-10-08

Regla aprobada: principal programada impone su calendario a hijos programados, incluidas completadas; conserva fechas, horas y marcas. Principal en Inbox permite elegirlo hasta agendarla. Selector oculto cuando se hereda, tanto en edición como en reloj. Migración aditiva normaliza datos existentes, definiciones recurrentes y protege nuevas escrituras con triggers; las proyecciones heredan también cuando conservan horarios históricos. Sin nuevas columnas ni consultas por cada subtarea.

## Revisión funcional de subtareas y preparaciones — 2026-10-08

57 comprobaciones aprobadas con servicios y migraciones reales en un esquema aislado, eliminado al terminar. Alcances de horario, identidad de subtareas, calendario heredado, Inbox, orden de tramos, opcionales al finalizar, consumo único, reversión y consultas cruzadas. Informe reproducible en subtasks-preparations-verification.json y guía en docs/RESULTADOS_SUBTAREAS_PREPARACIONES.md.

Recorrido en navegador sobre la cuenta autorizada. Se detectó y corrigió el reloj de preparaciones: ahora permite duración editable de cinco minutos manteniendo inicio en intervalos de 15. Guardado comprobado desde Agenda, compilación y tipos correctos. Comida temporal retirada mediante el servicio de Planificar, sin consumos ni horarios activos. Sin nuevas dependencias, migraciones ni cambios de PROJECT.md. Móvil y despliegue permanecen fuera de esta revisión.

## Primera adaptación de interfaz a iPhone — 2026-10-08

Navegación inferior, inicio de Cocina con cuatro accesos, Agenda inicialmente en Día y Planificar por día hasta 680 px. PC conserva tabla semanal. Comidas comparten controles/servicios; navegación diaria reutiliza la semana ya cargada. Viewport y áreas seguras, campos legibles y cuadros con altura visible cuando aparece teclado. Sin cambios de esquema, datos, dependencias ni PROJECT.md. Guía en docs/INTERFAZ_IPHONE.md; Safari real, instalación, publicación y offline pendientes.

## Ajustes móviles de densidad — 2026-10-08

Barra inferior Inbox/Agenda/Menú; Cocina queda en menú. Semana móvil de tres días con flechas que avanzan uno y arrastre adaptado al número de columnas; PC sigue domingo-sábado. Mes sin ancho mínimo, celdas de altura acotada y dos títulos iniciales, resto expandible. Catálogo de Alacena reducido, acciones de seguimiento/quitar como iconos y receta con papelera. Controles semanales compactos en una línea; formulario de Compras en dos columnas. Compilación de producción correcta y recorrido visual de los cambios sin modificar datos. Guía INTERFAZ_IPHONE.md actualizada.
