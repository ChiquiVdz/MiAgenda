# MiAgenda

Aplicación web personal que combina una agenda conectada con Google Calendar y un espacio independiente para recetas, alacena, planificación de comidas y compras. La intención es complementar Google Calendar, que sigue siendo la fuente de fechas y horarios, con lógica propia para organizar comidas y controlar ingredientes.

> **Estado:** MVP web funcional en desarrollo. La agenda, la integración OAuth con Google y los flujos principales de Cocina están implementados. Falta completar una pasada de pruebas manuales integrales, verificar configuración de producción (en especial el cron de retención) y decidir cómo administrar a largo plazo el historial de compras.
>
> Las decisiones de producto y arquitectura vigentes están en [`PROJECT.md`](./PROJECT.md), especialmente las secciones **18 y 19**. Ese archivo es la autoridad del proyecto. No cambies las decisiones acordadas sin conversar con Emilio y obtener su aprobación.

## Qué resuelve

- Muestra los eventos de Google Calendar en una vista semanal propia.
- Permite crear, modificar y borrar eventos, y completar, deshacer o conservar elementos desde MiAgenda.
- Mantiene en Google Calendar las fechas, horas y duración; la base de datos guarda el estado propio de la app.
- Organiza el flujo de Cocina en alacena, recetas, sugerencias, planificador de comidas y lista de compras.
- Conecta recetas y alacena mediante IDs de un catálogo para reducir ingredientes duplicados.
- Al planificar comidas crea eventos de Calendar. Al completar una comida descuenta ingredientes con un ledger que permite revertir el movimiento.

## Funcionalidades actuales

### Agenda

- Inicio de sesión OAuth con Google y lectura/escritura de Google Calendar.
- Vista semanal con eventos dibujados según su duración y visibilidad de calendarios.
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
- [x] Agenda semanal con lectura, creación, edición y eliminación de eventos.
- [x] Overlay para completar, deshacer y conservar; regla de retención y endpoint CRON.
- [x] Catálogo común de ingredientes y alacena.
- [x] Recetas, sugerencias, planificador y eventos de comidas en Calendar.
- [x] Descuento/reposición de ingredientes por completar/deshacer comida mediante ledger.
- [x] Lista de compras agregada desde planificaciones y artículos independientes.
- [x] Migraciones Prisma para el esquema actual.
- [x] En la última revisión de desarrollo reportada, `npm run typecheck` y `npm run build` pasaron. Volver a ejecutarlos después de cambios.

### Pendiente / por confirmar

- [ ] Prueba manual integral de planificar → agenda → completar → descuento → deshacer → reposición.
- [ ] Probar varias recetas en una misma comida y comprobar que cada evento de Calendar se actualice/borré correctamente.
- [ ] Probar compras agregadas: cambiar cantidad antes de comprar, compra masiva, incremento exacto de alacena y artículo no alimentario (p. ej. jabón).
- [ ] Confirmar despliegue y variables de Vercel, en particular `CRON_SECRET`; el archivo `vercel.json` por sí solo no confirma que el cron esté activo.
- [ ] Definir gestión del historial de compras ya realizadas (conservar, borrar o retención separada).
- [ ] Revisar manejo de errores y experiencia móvil en uso real.
- [ ] Sincronización avanzada/webhooks, widget y cliente móvil son fases futuras; no forman parte del MVP web actual.

### Casos de prueba manual recomendados

1. Planifica dos recetas en un mismo bloque y valida que aparezcan en Planificar y Agenda.
2. Completa una receta: verifica solo el descuento esperado. Deshaz: verifica reposición una sola vez.
3. Deshaz y elimina la comida; confirma que no queda un bloqueo por el historial ya revertido.
4. Edita porciones/fecha/hora/duración y verifica evento y cantidades necesarias.
5. Compara Compra planificada contra cantidades de Alacena; compra un ingrediente y luego un artículo libre; verifica qué se suma a la alacena.
6. Para Agenda: edita un evento desde Calendar y vuelve a la app para comprobar refresco; prueba conservar y la regla de retención solo en un entorno controlado.

## Instrucciones para quien continúe el proyecto

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

## Documentos relacionados

- [`PROJECT.md`](./PROJECT.md): objetivo, decisiones vigentes, diseño y reglas de producto.
- [`AGENTS.md`](./AGENTS.md): instrucciones de trabajo, incluyendo regla específica para Next.js.
- [`package.json`](./package.json): scripts y dependencias directas.
- [`prisma/schema.prisma`](./prisma/schema.prisma): esquema de datos.
