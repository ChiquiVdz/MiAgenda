# MiAgenda

**Estado vigente (2026-10-06):** Inbox, Agenda y Cocina utilizan exclusivamente el núcleo propio. Google permanece solo para iniciar sesión. La implementación anterior de Calendar se retiró; su copia recuperable está en `reconstruction/legacy-reference/2026-10-06`. [Cierre de reconstrucción y alcance](docs/CIERRE_RECONSTRUCCION.md).

Los comandos `db:generate` y `db:migrate` ahora apuntan al núcleo de `reconstruction/core`. `MIAGENDA_CORE_ENABLED`, `DATABASE_URL` y `GOOGLE_TOKEN_ENCRYPTION_KEY` ya no seleccionan ni habilitan la app anterior. Las secciones antiguas de este documento se consolidarán en el bloque 2; para instalar/configurar el núcleo consultar su README y PROJECT.md.

Revisión de rendimiento del núcleo propio: [mediciones, mejoras y pasos de revisión](docs/RENDIMIENTO.md).

Copia/borrado de semanas del planificador propio conectados: copiar semana anterior solo al destino vacío, revisión automática por receta y preparaciones previas inicialmente sin seleccionar. Borrar una semana retira sus actividades sin devolver inventario ni borrar tandas/consumos. Revisión manual pendiente: pasos en [reconstruction/core/README.md](reconstruction/core/README.md#copiar-y-borrar-semanas-en-el-núcleo-propio).

## Estado de la reconstrucción

**Bloque actual: Compras del núcleo propio.** `/cocina/compras` calcula faltantes de todas las comidas pendientes con Cocinar activo, muestra aportes obligatorios/opcionales y permite guardar cantidades elegidas, agregar artículos libres, comprar individualmente o todo y deshacer cada compra. Los ingredientes comprados aumentan Alacena por la cantidad real; artículos no alimentarios no alteran stock. Comprados muestra los últimos 30 días, sin borrar evidencias. Migraciones `20261005001100_shopping` y `20261005001200_shopping_unit` aplicadas. TypeScript comprobado; revisión funcional de este bloque pendiente del usuario.

El diseño vigente está en [PROJECT.md](PROJECT.md): actividades y calendario propios, Google únicamente para iniciar sesión. No continuar la integración de Google Calendar descrita en la referencia histórica de abajo.

El primer núcleo está implementado en [reconstruction/core](reconstruction/core/README.md), con migración aplicada a la base independiente `miagenda_core`. Incluye actividades, Inbox como consulta, subtareas, programación, completado, idempotencia y acceso Google de identidad. Se validaron esquema, TypeScript de ambos árboles y catálogos de la instalación. La interfaz de Inbox está conectada; no se ejecutó una suite de pruebas funcionales.

El acceso nuevo e Inbox/subtareas ya están conectados cuando `MIAGENDA_CORE_ENABLED=true` en `.env.local`. Al entrar se abre Inbox: crear, editar, eliminar, completar/deshacer y subtareas desplegables. La sesión nueva usa una cookie independiente; el mismo callback Google solicita solo identidad. Agenda propia está disponible en /agenda con Día, Semana, Mes y Año; Alacena está disponible en /cocina; Recetario está disponible en /cocina/recetas; Planificador está disponible en /cocina/planificar; compras y las APIs anteriores siguen bloqueados hasta adaptarlos. `MIAGENDA_CORE_ENABLED=false` y reiniciar restaura la aplicación anterior sin mover datos entre bases.

Antes de iniciar desde un checkout nuevo, generar ambos clientes: `npm run db:generate` y `npm --prefix reconstruction/core run generate`. Configurar la URL aislada en `reconstruction/core/.env.local` según su README. No intercambiar las URLs de las bases.

Calendarios/programación y las vistas Día/Semana/Mes/Año están conectados. El arrastre y ajuste de horarios de actividades con hora está conectado en Semana. Gestión de calendarios conectada (editar, trasladar o borrar con revisión de alcance). Todo el día se mueve con el formulario. Primer bloque de recurrencias conectado: crear diaria/semanal/mensual/anual y cambiar solo una instancia, sin guardar todas las fechas futuras. Segundo bloque de recurrencias conectado: editar, completar/deshacer y eliminar con alcances «solo esta», «esta y siguientes» y «toda la serie», incluidas excepciones y subtareas con identidad estable. Las casillas rápidas siguen afectando una instancia; los alcances se eligen en detalles de Semana/Mes. Retención de cinco días conectada mediante visitas autenticadas y cron protegido, respetando Conservar, hijos y exclusiones recurrentes. Cambiar frecuencia y fecha final de una serie existente está conectado con revisión previa y preservación de historial/excepciones. Ingredientes y Alacena están conectados al núcleo propio, con catálogo común, personalizados privados, ajustes verificables y protección de cantidades concurrentes. Recetario conectado: borradores, versiones, pasos opcionales con o sin ingrediente, resumen de cantidades y definición de preparaciones previas. Planificación propia conectada con filas personales, recetas congeladas, porciones, fases y preparaciones previas. Disponibilidad cronológica y sugerencias conectadas: reservas provisionales de todos los planes pendientes, faltantes obligatorios/opcionales y dependencias de sobras previstas. Completado de comidas y pasos de cocina conectado: consumos verificables, tandas reales, porciones usadas, opcionales y deshacer sujeto a dependencias. Compras y copia/borrado de semana siguen pendientes según `PROJECT.md`. El modelo completo está en [docs/MODELO_OBJETIVO.md](docs/MODELO_OBJETIVO.md) y su esquema físico en [docs/ESQUEMA_FISICO.md](docs/ESQUEMA_FISICO.md).

## Referencia de la aplicación anterior

Los apartados siguientes documentan el código que todavía usa la interfaz actual. Sus integraciones y adaptadores antiguos no son el objetivo de la reconstrucción.

- **Base común de actividades, preparación del bloque 2:** estructura y correspondencias de identidad añadidas de forma aditiva; los registros quedan en `staged` y los servicios actuales siguen siendo la autoridad. El cambio de servicios y «Quitar horario» de tareas principales siguen pendientes. Estado técnico: [docs/ACTIVIDADES_IMPLEMENTACION.md](docs/ACTIVIDADES_IMPLEMENTACION.md).

- **Preparaciones previas, definición:** cada paso de receta puede activar «Realizar antes de cocinar», con horas de anticipación editables (intervalos de 15 minutos, hasta 30 días) y duración editable, inicialmente 15 minutos. Se valida en cliente y servidor, se conserva al editar y se copia al snapshot de nuevos planes. No crea eventos al guardar el recetario ni suma tiempo a la cocina. Los planes existentes mantienen su definición congelada.

- **Preparaciones previas al planificar:** el formulario muestra los pasos previos y sus fechas/horas sugeridas en Ciudad de México, calculadas desde el inicio de la comida. Identifica opcionales y avisa si la hora ya pasó. Se ocultan al desactivar Cocinar; editar una comida usa sus pasos congelados. Después de guardar la comida ofrece elegir cuáles agendar, inicialmente sin seleccionar, y ajustar fecha, hora y duración. Cada preparación elegida tiene su propio evento en el calendario de la comida y utiliza `ScheduledSubtask` con una identidad calculada a partir del plan y del paso; dos recetas o comidas con iguales pasos no comparten vínculo. Los guardados interrumpidos recuperan el mismo ID de evento. Completar/deshacer se refleja entre el evento y el paso; solo terminar todos los obligatorios completa la comida y registra su consumo transaccional. Deshacer una preparación de una comida ya completada deshace el bloque y devuelve lo descontado, sujeto a dependencias de sobras. «Horario» en los pasos permite editar el evento o quitarlo conservando la casilla. Borrar la comida manualmente, incluido borrar una semana, elimina sus preparaciones agendadas. Quitar una receta o desactivar Cocinar retira los eventos de los pasos que dejan de formar parte del bloque; no devuelve ingredientes porque editar requiere un bloque pendiente. La retención conserva los hijos según sus propias fechas y Conservar, manteniendo el origen privado mínimo hasta que desaparece el último. Mover una comida conserva marcas y los horarios explícitos de sus preparaciones; ofrecer su reajuste al mover y agendar preparaciones de copias queda para el siguiente bloque.

- **Tarjetas de Inbox y Recetas:** usan el formato compacto de Día: nombre, resumen y subtareas/pasos desplegables. Inbox permite completar/deshacer, agregar, renombrar y quitar subtareas directamente en la tarjeta; los cambios se guardan al momento. Recetas muestra pasos con sus cantidades y un resumen de ingredientes por porción; Editar abre el editor existente. El recetario sigue siendo una definición reutilizable: no completa preparaciones ni descuenta inventario. Preparar directamente desde el recetario queda pendiente. Las subtareas con evento muestran «Agendada» y su fecha/hora de Google junto a Horario, en Inbox y Agenda. Se consultan por principal con concurrencia limitada y se comparten las peticiones de sus filas; Inbox muestra también el número de subtareas agendadas en la tarjeta cerrada.

- **Subtareas programables (bloque 2):** Inbox y Agenda permiten asignar inicio y fin a una subtarea guardada desde «Horario», con 15 minutos iniciales editables. Se crea un evento propio en Google y un vínculo `ScheduledSubtask` con la principal, incluso si permanece en Inbox. Al trasladar la principal se reasigna ese vínculo sin crear otra subtarea. Completar/deshacer y renombrar desde la app actualiza la misma subtarea en ambas superficies. Los reintentos de programación recuperan el ID de Google del primer intento. El formulario lee el horario actual y comprueba etags al modificarlo. En una principal recurrente, el horario se asigna solo a esa instancia. Los eventos utilizan las vistas y acciones habituales, incluido Conservar/Destacar. «Quitar horario» elimina su evento conservando la casilla en la principal. Borrar una principal desde Inbox o Agenda elimina también los eventos de sus subtareas programadas, incluidos hijos anidados. El borrado de series respeta el alcance elegido. Quitar una subtarea del listado elimina su evento; eliminar su evento desde la app retira la casilla de la principal. Quitar horario conserva la casilla. Antes del borrado del conjunto se comprueban permisos, identidades y etags. Una respuesta perdida o un fallo parcial se reintenta con los mismos IDs, sin duplicados. Al dividir o mover una serie se reasigna el vínculo a su nueva instancia conservando el horario explícito y progreso del hijo. Convertir una principal aislada con hijos programados en serie todavía exige quitar primero sus horarios. La retención retira la principal al vencer su plazo y conserva únicamente el registro privado de origen si quedan hijos; cada evento hijo se procesa por sus propias reglas. El bloque 3 limpia ese registro mínimo al desaparecer su último hijo. Al cargar Inbox o Agenda y al abrir subtareas, se comprueban los eventos vinculados: un cambio de nombre/horario hecho en Google actualiza su representación; eliminar solo el hijo en Google conserva la casilla sin horario, mientras que eliminar su principal elimina también los eventos hijos cuando se sincroniza el conjunto. La retención de la principal conserva los hijos hasta que cumplan sus propias reglas, incluidos Conservar y fechas futuras. La sincronización evita interpretar una retención o una edición de serie pendiente como un borrado manual. Los vínculos se revisan por páginas de hasta 100, usando datos ya leídos del calendario cuando están visibles. Los pasos previos de comidas usan esta misma base de vínculos y su propio flujo transaccional de ingredientes.

- **Pasos de recetas:** el editor usa únicamente pasos, cada uno con ninguno o un ingrediente, cantidad por porción, equivalencia descriptiva y opción de ser opcional. Repetir un ingrediente en varios pasos suma sus cantidades automáticamente, agrupadas por ingrediente y carácter obligatorio/opcional para planificación y compras. El servidor calcula esos totales; no depende del resumen del navegador. Las recetas anteriores se adaptan al abrir el editor sin borrar datos. Los pasos planificados muestran su cantidad escalada a las porciones a cocinar; marcar solo algunos pasos opcionales de un ingrediente consume únicamente esas cantidades. Desde el círculo, elegir un ingrediente opcional consume su cantidad opcional completa. Agenda (detalle y Día) y Planificar permiten marcar pasos. Terminar los obligatorios de todas las recetas completa el bloque, descuenta los obligatorios y los opcionales marcados, y omite los restantes. El círculo conserva la selección rápida de opcionales. Cancelarla no consume nada. Deshacer devuelve el consumo registrado y reinicia los pasos, respetando dependencias de sobras. Mover conserva el progreso; copiar una semana lo reinicia. Editar el recetario no altera pasos ni cantidades de comidas existentes; cambiar de receta en un plan crea una nueva copia. Sin Cocinar no aparecen pasos de preparación ni se consumen ingredientes nuevos. Los pasos previos (p. ej. descongelar) ofrecen agendarse al guardar una comida y permiten editar o quitar su horario desde sus pasos.

- **Captura rápida:** el botón flotante «＋ Anotar» en Agenda, Inbox y Cocina guarda texto privado en Inbox sin salir del apartado actual ni crear eventos. Admite hasta 250 caracteres y reutiliza el identificador del intento si el guardado necesita reintentarse. Inbox refleja la captura inmediatamente cuando está abierto.

Aplicación web personal que combina una agenda conectada con Google Calendar y un espacio independiente para recetas, alacena, planificación de comidas y compras. La intención es complementar Google Calendar, que sigue siendo la fuente de fechas y horarios, con lógica propia para organizar comidas y controlar ingredientes.

> **Estado:** MVP web funcional en desarrollo. La agenda, la integración OAuth con Google y los flujos principales de Cocina están implementados. Falta completar una pasada de pruebas manuales integrales, verificar configuración de producción (en especial el cron de retención) y decidir cómo administrar a largo plazo el historial de compras.
>
> Las decisiones de producto y arquitectura vigentes están en [`PROJECT.md`](./PROJECT.md), especialmente las secciones **18 y 19**. Ese archivo es la autoridad del proyecto. No cambies las decisiones acordadas sin conversar con Emilio y obtener su aprobación.

## Qué resuelve

- «Destacar en Año» se guarda por usuario y evento en `EventOverlay.highlighted`, para cualquier calendario que el usuario pueda leer. En una recurrencia solo afecta a esa instancia. Año señala los días y lista títulos/fechas debajo de cada mes; pulsar un destacado abre su detalle. Ocultar un calendario oculta sus destacados. Activar Destacado también activa Conservar; después ambos se pueden cambiar por separado. Quitar Destacado no quita Conservar, y activar Conservar no activa Destacado. Los destacados anteriores a este cambio mantienen su estado de Conservar.
- Año consulta únicamente los IDs destacados, valida sus fechas actuales en Google y omite los que ya no existen. La lectura se pagina en lotes de 25, con un máximo de cinco solicitudes simultáneas a Google; no expande todas las recurrencias del año.

- Agenda organiza Semana de domingo a sábado; el planificador de comidas conserva lunes a domingo. Semana muestra una línea de la hora actual solo en la columna de hoy, actualizada cada minuto. Al entrar en la semana actual se desplaza hasta esa hora; consultar o marcar eventos no vuelve a mover la vista.

- Semana abre primero el detalle de la actividad con subtareas marcables y acciones Editar/Eliminar; Día permite desplegar las subtareas en cada fila y añadirlas, renombrarlas, eliminarlas o marcar/desmarcar con un clic, solo para esa instancia. Las opciones para extender marcas a la serie aparecen únicamente en Semana. Mes utiliza el mismo detalle de eventos y subtareas.
- Las casillas se guardan por instancia. «Aplicar estas marcas» extiende únicamente las subtareas cambiadas a esta y las siguientes o a toda la serie: identifica por ID, conserva las demás marcas y omite subtareas eliminadas. Las instrucciones incluyen repeticiones futuras; el cron materializa las pasadas por lotes para respetar su retención.

- Todas las tareas pueden tener subtareas opcionales, con casillas y contador en Agenda/Hoy e Inbox. Las subtareas sin horario son privadas de MiAgenda; las programadas tienen su propio evento de Google y conservan el vínculo al trasladar la principal desde Inbox.
- Completar el círculo marca todas las subtareas; deshacer las deja pendientes. Completar la última subtarea completa la tarea y activa la retención habitual de cinco días.
- Las tareas agendadas pueden repetirse por días, semanas (eligiendo días), meses o años, con intervalo configurable y final por fecha, número de repeticiones o sin fecha final. Cada instancia conserva su propio progreso. Se retiró la interfaz de plantillas.
- Agenda reúne Día, Semana, Mes y Año en un selector que siempre regresa a la fecha actual. Día permite recorrer fechas y crear actividades en la fecha mostrada; los encabezados semanales abren el día correspondiente. El botón Hoy aparece fuera del periodo actual y los filtros de calendarios se conservan. Mes muestra eventos, permite crear tareas/comidas en cada día y abrir la semana de cada fila, con tres eventos iniciales y «Ver más». Año muestra los 12 meses; pulsar un día o el nombre del mes abre Mes. Las flechas cambian de año y Hoy regresa al actual. Los filtros de calendarios se conservan en las cuatro vistas; el antiguo acceso /hoy sigue abriendo Día por compatibilidad.
- Al editar o eliminar una tarea recurrente puedes elegir solo esta, esta y las siguientes, o toda la serie. `TaskSeriesMember` mantiene unidos los tramos que Google separa al editar futuras repeticiones. Toda la serie incluye los tramos anteriores, las excepciones y las instancias con progreso o conservadas. La edición actualiza sus listas conservando el progreso por subtarea; cambiar la regla puede eliminar fechas que ya no pertenecen a ella. Los intentos interrumpidos se pueden reanudar desde Agenda sin duplicar series; solo se pueden descartar antes de aplicar cambios en Google. Los tramos separados antes de registrar este vínculo no pueden asociarse automáticamente con seguridad: no se unen por título.

- Crea calendarios reales de Google desde el botón **＋** de **Mis calendarios**, con nombre y color.
- La selección de calendarios solo controla su visibilidad en Agenda y Hoy: ocultarlos no impide crear actividades, planificar comidas ni calcular compras.
- **Cocina** tiene un calendario asociado por ID para cada usuario. Las nuevas comidas se guardan automáticamente ahí; un calendario libre no se convierte en módulo por tener el mismo nombre.
- El calendario de Cocina se configura desde Agenda o el planificador. Cambiarlo requiere retirar las comidas existentes y terminar las copias pendientes para no perder sus relaciones.

- Muestra los eventos de Google Calendar en una vista semanal propia.
- Permite crear, modificar y borrar eventos, y completar, deshacer o conservar elementos desde MiAgenda.
- Mantiene en Google Calendar las fechas, horas y duración; la base de datos guarda el estado propio de la app.
- Organiza el flujo de Cocina en alacena, recetas, sugerencias, planificador de comidas y lista de compras.
- Conecta recetas y alacena mediante IDs de un catálogo para reducir ingredientes duplicados.
- Al planificar comidas crea eventos de Calendar. Al completar una comida descuenta ingredientes con un ledger que permite revertir el movimiento.

## Funcionalidades actuales

### Agenda

- Inicio de sesión OAuth con Google y lectura/escritura de Google Calendar.
- Vista semanal con eventos dibujados según su duración y visibilidad de calendarios; vista **Hoy** con pendientes y completados.
- Crear, editar y eliminar eventos.
- Completar/deshacer y conservar con estado adicional en la base de datos.
- Retención configurada para eliminar elementos completados cinco días después, si ya terminaron y no se conservaron. Las instancias recurrentes se manejan sin borrar el evento maestro.

### Cocina

- **Alacena:** cantidades por ingrediente y unidades canónicas.
- **Recetas:** ingredientes enlazados al mismo catálogo que la alacena; cantidades por porción y equivalencias descriptivas.
- **Sugerencias:** recetas ordenadas según los ingredientes disponibles.
- **Planificar:** tabla semanal de hasta dos semanas; filas de comidas editables; se pueden poner varias recetas en una comida, ajustar porciones/horario/duración y completar o deshacer.
- **Compras:** agrega necesidades de las comidas planificadas, consolida ingredientes, descuenta existencias de alacena para calcular lo faltante, permite editar cantidades y agregar compras independientes. Al registrar la compra, los ingredientes alimentarios se incorporan a la alacena.

**Persistencia de compras:** los artículos comprados quedan guardados; no se ha definido ni implementado una retención automática de ese historial. No confundir con la retención de cinco días de elementos completados de Agenda.

## Arquitectura

Aplicación full-stack en un solo proyecto:

```text
Navegador
   │ HTTPS + sesión
   ▼
Next.js App Router (UI + Route Handlers)
   ├── Auth.js / Google OAuth ── Google Calendar API
   └── Prisma ── PostgreSQL (Neon)
```

- **Fechas, horarios, duración y recurrencia:** Google Calendar.
- **Sesión, overlay de completado/conservar, recetas, catálogo, alacena, planificaciones, ledger y compras:** PostgreSQL.
- **Autorización:** los Route Handlers derivan el usuario de la sesión y deben aislar datos por `userId`.
- **Credenciales:** Google refresh token cifrado del lado del servidor; secretos y credenciales se configuran mediante variables de entorno.
- **Retención:** endpoint `/api/cron/retention`, protegido por `CRON_SECRET`, programado a diario en `vercel.json`.

### Entidades principales

`User`, `Account`, `Session`, `CalendarSubscription`, `EventOverlay`, `Ingredient`, `PantryItem`, `Recipe`, `RecipeIngredient`, `MealSlot`, `MealPlan`, `MealPlanIngredient`, `InventoryLedger`, `ShoppingList` y `ShoppingListItem`. El esquema completo vive en [`prisma/schema.prisma`](./prisma/schema.prisma); el historial incremental de BD está en [`prisma/migrations`](./prisma/migrations).

## Stack y dependencias

Versiones fijadas en `package.json` y `package-lock.json`:

- Node.js `>=20.19.0`
- Next.js `16.3.8`, React / React DOM `19.2.8`, TypeScript `5.9.3`
- Auth.js (`next-auth` `4.24.15`) y adaptador Prisma
- Google APIs (`googleapis` `182.0.0`)
- Prisma `7.10.0`, `@prisma/adapter-pg` `7.10.0`, `pg` `8.23.1`
- PostgreSQL (Neon en el entorno actual)

## Requisitos previos

1. Node.js `20.19.0` o superior y npm.
2. Una base PostgreSQL accesible.
3. Proyecto de Google Cloud con OAuth Client ID tipo aplicación web.
4. Google Calendar API habilitada y URI de redirección OAuth configurada para cada entorno.
5. Para producción en Vercel: variables de entorno y `CRON_SECRET` configurados. Revisa además los permisos/scopes consentidos por Google.

## Configuración local

1. Clona el repositorio e instala dependencias:

   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd MiAgenda
   npm ci
   ```

2. Copia `.env.example` como `.env.local` y llena valores reales. **Nunca subas `.env.local` ni pegues secretos en issues o chats.**

   Variables requeridas:

   | Variable | Uso |
   |---|---|
   | `NEXTAUTH_URL` | URL base del entorno (local: `http://localhost:3000`) |
   | `NEXTAUTH_SECRET` | Secreto aleatorio para Auth.js |
   | `AUTH_GOOGLE_ID` | Client ID OAuth de Google |
   | `AUTH_GOOGLE_SECRET` | Client secret OAuth de Google |
   | `DATABASE_URL` | Conexión PostgreSQL; en producción debe usar TLS |
   | `GOOGLE_TOKEN_ENCRYPTION_KEY` | Clave Base64 de 32 bytes para cifrar el refresh token |
   | `CRON_SECRET` | Secreto que protege el endpoint de retención |

3. En Google Cloud, habilita Calendar API y agrega el callback OAuth local de Auth.js: `http://localhost:3000/api/auth/callback/google`. Para producción, registra el callback con el dominio real.
4. Aplica las migraciones y genera el cliente Prisma:

   ```bash
   npx prisma migrate deploy
   npm run db:generate
   ```

   Para crear una migración nueva durante desarrollo usa `npm run db:migrate`; revisa y conserva siempre el SQL generado.
5. Inicia la app:

   ```bash
   npm run dev
   ```

   Abre `http://localhost:3000` y entra con la cuenta de Google autorizada.

> Las variables listadas son necesarias para la configuración completa. No copies valores de producción; usa tus propias credenciales. El `.env.example` solo contiene marcadores.

## Comandos

| Comando | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run typecheck` | Comprueba tipos TypeScript |
| `npm run build` | Compilación de producción |
| `npm run start` | Sirve la compilación |
| `npm run db:generate` | Genera el cliente Prisma |
| `npm run db:migrate` | Ejecuta migraciones de desarrollo |
| `npx prisma migrate deploy` | Aplica migraciones pendientes en un despliegue |

## Estructura

```text
src/app/                 UI, páginas y API Route Handlers
src/app/api/auth/        OAuth/Auth.js
src/app/api/calendars/   Calendarios y preferencias de visibilidad
src/app/api/events/      Eventos, sincronización y acciones de agenda
src/app/api/cron/        Retención programada
src/app/api/{pantry,...} Endpoints del módulo Cocina
src/lib/                 Auth, Prisma, integración Google y reglas de dominio
prisma/schema.prisma     Modelo de datos
prisma/migrations/       Migraciones SQL ordenadas
PROJECT.md               Especificación y decisiones acordadas (autoridad)
AGENTS.md                Instrucciones para agentes de código
```

Los archivos de UI de Cocina están bajo `src/app/cocina/`; agenda está en `src/app/agenda-view.tsx`.

## Estado del trabajo y siguientes pasos

La situación descrita aquí refleja el estado revisado el **1 de octubre de 2026**. Actualiza esta sección cuando cambie el estado real; no la tomes como garantía de que cada flujo fue verificado en tu dispositivo.

### Implementado

- [x] Inicio de sesión Google, sesión Auth.js y acceso a Calendar.
- [x] Inbox de pendientes de texto libre: agregar, editar, completar/deshacer, borrar y pasar a Calendar.
- [x] Agenda semanal con lectura, creación, edición y eliminación de eventos.
- [x] Overlay para completar, deshacer y conservar; regla de retención y endpoint CRON.
- [x] Catálogo común de ingredientes y alacena.
- [x] Recetas, sugerencias, planificador y eventos de comidas en Calendar.
- [x] Descuento/reposición de ingredientes por completar/deshacer comida mediante ledger.
- [x] Lista de compras agregada desde planificaciones y artículos independientes.
- [x] Copiar semanas de comidas con revisión previa, omisión de celdas ocupadas y reanudación de copias interrumpidas.
- [x] Migraciones Prisma para el esquema actual.
- [x] En la última revisión de desarrollo reportada, `npm run typecheck` y `npm run build` pasaron. Volver a ejecutarlos después de cambios.

### Pendiente / por confirmar

- [ ] Prueba manual integral de planificar → agenda → completar → descuento → deshacer → reposición.
- [ ] Probar varias recetas en un bloque y comprobar que su único evento de Calendar se actualice y borre correctamente.
- [ ] Probar compras agregadas: cambiar cantidad antes de comprar, compra masiva, incremento exacto de alacena y artículo no alimentario (p. ej. jabón).
- [ ] Confirmar despliegue y variables de Vercel, en particular `CRON_SECRET`; el archivo `vercel.json` por sí solo no confirma que el cron esté activo.
- [ ] Definir gestión del historial de compras ya realizadas (conservar, borrar o retención separada).
- [ ] Revisar manejo de errores y experiencia móvil en uso real.
- [ ] Sincronización avanzada/webhooks, widget y cliente móvil son fases futuras; no forman parte del MVP web actual.

### Casos de prueba manual recomendados

1. Planifica dos recetas en un mismo bloque y valida que aparezcan en Planificar y Agenda.
2. Completa el bloque: verifica el descuento de todas sus recetas y opcionales elegidos. Deshaz: verifica reposición una sola vez.
3. Deshaz y elimina la comida; confirma que no queda un bloqueo por el historial ya revertido.
4. Edita porciones/fecha/hora/duración y verifica evento y cantidades necesarias.
5. Compara Compra planificada contra cantidades de Alacena; compra un ingrediente y luego un artículo libre; verifica qué se suma a la alacena.
6. Para Agenda: edita un evento desde Calendar y vuelve a la app para comprobar refresco; prueba conservar y la regla de retención solo en un entorno controlado.

### Copiar la semana anterior y borrar comidas

- En **Planificar**, solo las semanas vacías ofrecen **Copiar semana anterior**. Al pulsar se revisa automáticamente: si no hay comidas, no se modifica nada; si las hay, se muestra cuántas veces se copiará cada receta y sus porciones antes de confirmar. No hay selector de fechas ni botón para revisar manualmente.
- La revisión automática muestra las recetas por copiar y cuáles se omitirán antes de confirmar. Solo se copian celdas vacías; nunca se sustituyen comidas existentes. Si hay varios bloques antiguos en una misma celda de origen, se copia el primero y se informa de los demás.
- Se conservan las recetas y sus cantidades planificadas, porciones a cocinar/comer, horario, duración y fases. Se crean nuevos eventos de Google y nuevas comidas pendientes. No se copian completados, Conservar, consumo de ingredientes ni tandas ya cocinadas.
- Las reservas se calculan nuevamente por fecha, usando la alacena y las sobras disponibles. Al terminar se actualiza la lista global de Compras con los faltantes de todas las comidas pendientes, sin límite por semana. Copiar no descuenta inventario; eso ocurre al completar la comida.
- Si se interrumpe, vuelve a la semana de destino y pulsa **Reanudar copia**. Se conserva el avance y se recuperan los eventos creados por ese intento con identificadores deterministas. Una celda que se ocupe durante la copia también se omite y se informa.
- Solo pueden copiarse comidas que todavía existan y conserven sus recetas y horarios concretos. La retención de cinco días puede haber eliminado comidas completadas de una semana anterior.
- Para revisar manualmente: copia hacia una semana vacía; comprueba fechas, fases y porciones; confirma que todo está pendiente y que Alacena sigue igual; revisa faltantes y Compras. El botón desaparece cuando la semana tiene cualquier comida, incluidas las completadas o sin fila.

- Cada semana tiene **Borrar comidas**, con revisión de bloques pendientes/completados y confirmación. Se borran los eventos y sus planes sin devolver ingredientes consumidos. Se conservan las tandas con sobras y los consumos que todavía pueden deshacerse; cuando ya no quedan porciones ni enlaces que permitan deshacer, se eliminan los registros mínimos. No hay acción para desechar sobras. Las reservas de pendientes se liberan y Compras se recalcula. Si Google detecta un cambio, el proceso se detiene para revisar de nuevo; lo ya eliminado conserva su avance.
- Compras muestra una única lista para todas las comidas pendientes, incluidas semanas pasadas y futuras. Los artículos libres y compras realizadas de las listas semanales anteriores se trasladan a la lista global conservando sus identificadores y cantidades compradas; los faltantes se recalculan. Sigue siendo posible comprar individualmente, comprar todo y deshacer una compra.

## Instrucciones para quien continúe el proyecto
 
### Inbox

- `/inbox` guarda pendientes por usuario, sin crear eventos ni interpretar fechas escritas en el texto. Se pueden agregar textos de hasta 250 caracteres, editar, borrar, completar y deshacer desde el círculo.
- Los pendientes aparecen primero; los completados están en una sección plegable. Se eliminan al cumplirse cinco días desde su completado. La limpieza ocurre al consultar/modificar Inbox y también en el CRON de retención; no necesita Google para eliminar pendientes locales.
- **Pasar a agenda** abre calendario, inicio y fin en horario de Ciudad de México. El fin propone una hora después del inicio y puede ajustarse siempre que sea posterior. El título del evento será el texto del pendiente.
- Solo al confirmar la creación/recuperación del evento de Google se retira el pendiente de Inbox. Si se interrumpe, permanece y ofrece **Reanudar traslado** con el horario/calendario originales. El intento se guarda antes de escribir en Google y usa un identificador determinista para evitar duplicados; no sobrescribe ediciones posteriores de Google.
- Un traslado iniciado queda protegido de edición, completado y borrado hasta confirmar el evento. Tras confirmarlo se conserva solo un comprobante técnico durante cinco días, sin el texto ni los horarios, para resolver reintentos de una respuesta perdida.
- Para revisar: anota “Examen a las 3 el jueves” y comprueba que no crea ningún evento; completa y deshaz; edita el texto; pasa otro pendiente a agenda eligiendo fechas; verifica que desaparece de Inbox y aparece una sola vez en Calendar y Agenda.

### Continuidad del desarrollo

1. **Lee `PROJECT.md` completo antes de planificar cambios.** Sigue en especial las secciones 18 y 19, que registran decisiones confirmadas por el usuario.
2. No reemplaces ni borres partes funcionales existentes para facilitar una implementación. Haz cambios incrementales y revisa los datos/migraciones existentes.
3. Las decisiones persistentes de producto (por ejemplo, cambiar la retención de 5 días, el proveedor de Calendar o el modelo de comidas) deben proponerse primero y requieren acuerdo explícito de Emilio antes de editar `PROJECT.md` o implementarlas.
4. Para cualquier cambio de Next.js, respeta [`AGENTS.md`](./AGENTS.md): esta versión tiene cambios incompatibles; lee la guía pertinente en `node_modules/next/dist/docs/` antes de tocar código y no elimines el bloque administrado de `AGENTS.md`.
5. Antes de tocar el esquema, revisa `prisma/schema.prisma` **y todas las migraciones existentes**. No hagas reset/drop contra la base configurada. Produce migraciones incrementales y confirma cuál BD apunta el `.env.local` sin imprimir sus credenciales.
6. Mantén secretos en `.env.local`/variables del host; nunca los muestres, registres o agregues a Git. `.env.example` contiene solo nombres y marcadores.
7. Aísla todos los datos del usuario autenticado; no confíes en un `userId` recibido del cliente. No expongas Google refresh tokens al navegador.
8. Las comidas usan el catálogo canónico; el ledger es la fuente para revertir el descuento. Evita inventario negativo, completar dos veces, restaurar dos veces o perder el enlace de Calendar.
9. Haz cambios pequeños, explica qué se modificó y qué queda probado. Corre `npm run typecheck` y `npm run build` para validar cambios de código cuando corresponda; añade pruebas automatizadas a medida que se establezca esa infraestructura.
10. Mantén este README y el checklist sincronizados con el estado observado; no declares funciones probadas sin evidencia.

## Seguridad y publicación en GitHub

- `.env.local`, `.env`, `.vercel/`, `node_modules/` y artefactos locales están excluidos por `.gitignore`.
- Antes de publicar, inspecciona `git status` y confirma que no aparecen `.env.local`, secretos, tokens, exports de base o datos personales.
- No subas una copia de producción de la base ni datos reales del calendario/alacena.
- Si alguna credencial fue expuesta en algún momento, revócala y genera una nueva antes de publicar.
- Añade un `LICENSE` solo tras decidir qué licencia quieres para el código. Sin archivo de licencia, no declares el proyecto como open source bajo una licencia específica.

### Crear desde la agenda

- El botón Crear y los espacios libres de la cuadrícula abren el mismo diálogo con selector **Tarea / Comida**. Pulsar la cuadrícula conserva el día y ajusta la hora a intervalos de 15 minutos; el botón Crear propone el siguiente cuarto de hora de Ciudad de México, dentro de la semana mostrada. Las tareas empiezan con una hora de duración y permiten ajustarla.
- Comida abre el formulario compartido de bloques: varias recetas, disponibilidad cronológica, fecha, hora, calendario, fila, fases y porciones por receta. Sugiere la fila de horario más cercano; elegir otra fila no cambia la hora pulsada. También permite Sin fila. Usa `/api/meal-blocks` y las mismas reservas, compras y protección contra duplicados; los ingredientes se descuentan al completar.
- Cambiar entre tipos conserva título, horario y selección de comida durante esa apertura. Una actividad existente conserva su tipo. El diálogo admite teclado, Escape y controles de fecha/hora como alternativa a pulsar la cuadrícula.
- Revisión manual: pulsar un espacio libre y crear una tarea; repetir eligiendo Comida; comprobarla en Agenda, Planificar y Compras; cambiar entre tipos antes de guardar; probar una hora cercana a medianoche.

### Mover y ajustar horarios

- Los eventos con horario se mueven arrastrando su cuerpo a otro día/hora; las marcas superior e inferior ajustan sus bordes. La previsualización usa intervalos de 15 minutos. Mover conserva la duración; ajustar un borde mantiene fijo el otro y una duración mínima de 15 minutos. Escape cancela antes de soltar. La zona horaria sigue siendo Ciudad de México. Los eventos de día completo se pueden arrastrar a otro día conservando la cantidad de días.
- El detalle ofrece campos de fecha/hora y duración compatibles con teclado y pantallas táctiles. Se retiraron los botones de mover ±15 minutos, ±1 día y acortar/alargar. Para desplazarse por la agenda táctil se puede usar un espacio libre.
- Google valida el `etag` antes de guardar. Si falla o existe un conflicto, se retira la previsualización y se recarga la semana. Las comidas completadas no cambian de horario hasta deshacerlas; mover un bloque actualiza todas sus recetas, recalculando sus reservas al consultar Cocina. Un bloque dura entre 5 y 1440 minutos y mantiene horario concreto.
- La cocina conjunta usa la receta más larga más la mitad de las demás, redondeada hacia arriba a múltiplos de cinco. Por ejemplo, 10 y 5 minutos dan 15; 30 y 15 dan 40. Ahora es la duración efectiva de la fase Cocinar de un único evento, a la que se agregan Comer y Lavar si están activadas.
- Pruebas existentes de horarios y fórmula: `node --test tests/calendar-adjustment.test.cjs tests/calendar-creation.test.cjs`. Revisión manual: mover un evento a otra hora/día, cambiar ambos bordes, cancelar con Escape, usar los campos de horario, confirmar en Google y en Planificar, y verificar un conflicto editando primero desde Google.

## Documentos relacionados

- [`PROJECT.md`](./PROJECT.md): objetivo, decisiones vigentes, diseño y reglas de producto.
- [`AGENTS.md`](./AGENTS.md): instrucciones de trabajo, incluyendo regla específica para Next.js.
- [`package.json`](./package.json): scripts y dependencias directas.
- [`prisma/schema.prisma`](./prisma/schema.prisma): esquema de datos.

### Ajustes del bloque de catálogo y compras

- Alacena permite seleccionar un ingrediente y eliminarlo. Un diálogo muestra sus usos y permite reemplazarlo por otro existente de la misma unidad, crear un reemplazo o borrar todos sus usos. El reemplazo suma existencias y líneas duplicadas, actualiza recetas/comidas/compras y conserva los movimientos para deshacer comidas. El borrado total elimina también sus movimientos: ya no se devuelve ese ingrediente al deshacer una comida. Los ingredientes privados se borran físicamente; los compartidos se eliminan de la cuenta y de sus usos, conservando el catálogo de otras personas.
- Compras conserva las compras anteriores y vuelve a generar un pendiente cuando el mismo ingrediente vuelve a faltar en el periodo. El historial aparece en una sección plegable «Comprados». Hay compra individual y masiva; cada artículo comprado permite deshacer. Deshacer resta exactamente la compra de la alacena y revierte el estado en la misma transacción. Si no quedan existencias suficientes, se bloquea con explicación; los artículos libres vuelven a pendientes sin mover inventario.
- Los bloques del planificador muestran una advertencia con los faltantes. El cálculo reserva virtualmente el stock para todas las comidas pendientes, en orden de fecha y hora programadas; no descuenta inventario al planificar. Las sugerencias para un horario reservan primero las comidas anteriores y, al editar, excluyen la reserva de la propia comida.
- Migraciones incrementales: `20261002100000_catalog_visibility_purchase_history` y `20261002110000_ingredient_deletion`. Aplicadas en Neon de desarrollo; otros entornos deben ejecutar `prisma migrate deploy` y regenerar el cliente.
- Revisar manualmente: eliminar un ingrediente usado por reemplazo existente, nuevo y borrado total; comprar/deshacer un ingrediente y un artículo libre; planificar dos recetas con el mismo ingrediente sin stock; comprobar los nuevos pendientes, Comprados y el aviso del planificador.
- Verificación técnica de este bloque: tipos y compilación de producción correctos; 11 comprobaciones de integración en Neon con datos temporales para compra concurrente, deshacer repetido, rollback de stock insuficiente, aislamiento entre usuarios, reemplazos y borrado total. Los registros temporales se eliminaron al terminar. Queda por confirmar la interacción visual en la app.

- Pruebas de reservas del planificador: `node --test tests/planned-inventory.test.cjs` (después de `npm ci`). Cubren reservas acumuladas, edición, comidas completadas, inventario insuficiente, decimales y reactivación de alertas al borrar/reagregar o mover una comida anterior.

### Porciones cocinadas y disponibilidad por fecha

- Planificar permite indicar **porciones a comer**, activar/desactivar **Cocinar** y fijar **porciones a cocinar**. Ambas cantidades son iguales por defecto. Cocinar cuatro y comer dos genera dos porciones disponibles para otros días al completar.
- `CookedBatch` registra cada tanda por usuario, receta y fecha. `PortionUse` registra el consumo real; los planes pendientes reservan porciones mediante una proyección recalculada, sin modificar existencias reales. No se intercambian porciones entre recetas ni se reserva la misma porción dos veces. Los planes con idéntico horario se ordenan por creación y luego ID.
- Todas las comidas pendientes participan en la disponibilidad, incluidas las de otras semanas. Google sigue siendo la fuente del horario: Planificar sincroniza los eventos asociados y excluye los que fueron borrados. Al agregar, editar o borrar un plan se recalculan reservas; los planes más próximos tienen prioridad y los faltantes recaen en fechas posteriores.
- Cuando faltan porciones sin cocinar, se muestra «Falta cocinar» si hay ingredientes, o el detalle de los ingredientes faltantes. Esos ingredientes también se contemplan en la proyección y en compras, pero nunca se activa Cocinar automáticamente. Completar se bloquea hasta corregir las cantidades o preparar las porciones correspondientes.
- Completar una cocinada descuenta sus ingredientes, registra la tanda y consume las porciones comidas en la misma transacción. Completar sobras solo consume porciones. Los consumos repetidos no duplican movimientos. Deshacer libera sus porciones consumidas y, si cocinó, devuelve exactamente el ledger. Si otra comida ya consumió una tanda, primero hay que deshacer o corregir esa comida dependiente.
- La retención de eventos permanece en cinco días. Al purgar un evento, sus tandas y consumos permanecen para no perder sobras ni volver a ofrecer porciones ya comidas. Las comidas completadas anteriores a esta migración conservan su descuento e historial; no se inventan sobras para ellas.
- Migración incremental `20261003100000_cooked_portions`, aplicada en Neon. En otros entornos: `prisma migrate deploy` y `prisma generate`.
- Pruebas del cálculo: `node --test tests/planned-inventory.test.cjs tests/meal-availability.test.cjs`. Prueba PostgreSQL opcional: establecer `PORTIONS_DATABASE_TEST=1` y ejecutar `node --test tests/meal-portions.integration.cjs`; todas sus entidades temporales se crean dentro de una transacción que se revierte, sin llamadas a Google.
- Revisión manual: cocinar cuatro/comer dos; planear dos para el día siguiente sin cocinar; aumentar ese plan a tres y revisar la advertencia; reducirlo y comprobar que libera reservas; completar las sobras e intentar deshacer la cocinada original; deshacer las sobras y después la cocinada, comprobando la reposición exacta.

### Ingredientes opcionales y compras

- Cada ingrediente de receta puede marcarse como **Opcional**. Las sugerencias y las alertas de faltantes evalúan los obligatorios. Compras incluye ambas categorías: un solo artículo por ID canónico, con subtotales faltantes obligatorios y opcionales. La alacena se reserva primero para los obligatorios de todos los planes, por fecha, y después para los opcionales.
- El total editable de compra sigue representando la cantidad realmente adquirida; los subtotales muestran las necesidades del menú. Comprar no significa usar: completar una cocinada abre un diálogo para confirmar los opcionales utilizados. Cancelar deja la comida pendiente; desmarcar todos permite cocinar sin ellos. Si falta stock de un opcional elegido, la operación se bloquea sin descontar nada.
- La selección se guarda en la instancia planeada (`optionalUsed`), no cambia la receta. Deshacer restaura exactamente sus movimientos y limpia la selección. Comer sobras sin cocinar no pregunta opcionales ni descuenta ingredientes crudos.
- Las comidas conservan una copia de sus ingredientes al planificarse. Cambiar una receta no modifica silenciosamente comidas anteriores: para actualizar una comida pendiente, edítala y guárdala. Las recetas y comidas previas a la migración empiezan con todos sus ingredientes obligatorios.
- Migración `20261003110000_optional_ingredients`, aplicada en Neon de desarrollo. Otros entornos deben aplicar migraciones y generar Prisma. La identidad única por receta/comida, ingrediente y categoría permite reemplazar ingredientes conservando cantidades obligatorias y opcionales por separado.
- Alacena habilita Guardar solo cuando la cantidad válida difiere de la guardada. Guardar una fila conserva los cambios pendientes de las otras. Cocinar usa un interruptor compacto accesible.
- Revisión manual: usar el mismo ingrediente como obligatorio en una receta y opcional en otra, planificar ambas sin stock y comprobar una sola fila con los dos subtotales; comprar; completar confirmando algunos opcionales; comprobar el descuento y la reposición al deshacer; completar sobras y comprobar que no aparece el diálogo.

### Bloques de comida y vista Día

- Un bloque contiene hasta 12 recetas distintas, un horario y un único evento de Google. `EventOverlay` identifica el bloque; sus `MealPlan` conservan por separado ingredientes, tandas, porciones y movimientos.
- Cocinar, Comer y Lavar son fases seleccionables del bloque, no completados independientes. Comer y Lavar empiezan con 20 y 10 minutos; el usuario puede guardar otros tiempos para nuevos bloques. Cada receta conserva un tiempo de preparación editable en esa instancia.
- Cocinar sin Comer guarda todas las porciones preparadas como sobras. Comer sin Cocinar reserva porciones de cada receta y avisa si falta cocinar. Se mantiene la prioridad cronológica y el bloqueo al deshacer tandas cuyas sobras ya se consumieron.
- Completar/deshacer usa una sola transacción para todas las recetas. Los opcionales se muestran por receta para poder elegir usos diferentes del mismo ingrediente. Si falla cualquier receta, se revierte toda la operación.
- Las comidas existentes conservan sus eventos y duración. En el planificador, **＋ Agregar comida** aparece solo en celdas vacías. Cuando una celda ya tiene comida, usa **Editar / agregar recetas** para agregar recetas al mismo bloque. Los eventos anteriores no se fusionan automáticamente.
- `GET/POST/PATCH /api/meal-blocks` carga, crea y edita bloques. La creación usa un ID determinista en Google; editar comprueba versión local y `etag` remoto. Los cambios de horario por arrastre se aplican a todos los planes del bloque. Una duración manual se conserva como ajuste explícito hasta volver al cálculo por fases.
- **Día** está disponible en el selector de Agenda y al pulsar un encabezado semanal. Muestra actividades de los calendarios visibles en la fecha seleccionada, incluidas las que cruzan medianoche y las de día completo; permite completar/deshacer y abrir el detalle especializado de comida. `/hoy` sigue abriendo Día por compatibilidad, sin acceso independiente en el lateral.
- Migración incremental `20261003120000_meal_blocks`, aplicada en Neon. En otro entorno aplica `prisma migrate deploy` y genera Prisma antes de iniciar la app.
- Revisión manual pendiente: crear dos recetas de 30 y 15 minutos, con Comer 20 y Lavar 10 (70 minutos); cambiar porciones; completar con opcionales y deshacer; cocinar cuatro/comer dos y consumir dos al día siguiente sin cocinar; comprobar el bloqueo al intentar deshacer primero la cocinada; abrir Hoy y completar una tarea y un bloque.

