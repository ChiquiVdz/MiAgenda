# Núcleo activo de MiAgenda

Actualizado: 2026-10-08. Es la única implementación activa, instalada en `miagenda_core`: acceso Google solo identidad, actividades, Inbox, captura rápida global, Agenda, calendarios, recurrencias, retención y Cocina. Núcleo cerrado para uso diario local en PC. `MIAGENDA_CORE_ENABLED` ya no existe como selector. Las secciones 18/19 de PROJECT.md mantienen precedencia.

## Leer y continuar

- [Arquitectura y conexiones actuales](../../docs/ARQUITECTURA_ACTUAL.md).
- [Contrato de producto](../../PROJECT.md) y [modelo lógico](../../docs/MODELO_OBJETIVO.md).
- [Cierre de reconstrucción](../../docs/CIERRE_RECONSTRUCCION.md).
- [Resultados de la revisión integral](../../docs/RESULTADOS_REVISION_INTEGRAL.md) y [guía reutilizable](../../docs/REVISION_INTEGRAL.md).
- [Última revisión de Cocina](../../docs/RESULTADOS_COCINA_CANTIDADES.md), con aceptación visual del usuario.
- [Uso diario local y respaldo](../../docs/USO_DIARIO_LOCAL.md).
- [Historial de bloques y pasos manuales](HISTORIAL_BLOQUES.md). Es un registro cronológico: los primeros apartados describen etapas parciales ya superadas.

## Fuente de la implementación

| Ruta | Uso |
|---|---|
| `schema.prisma` | Esquema actual; 35 modelos de dominio/autenticación |
| `migrations/` | Migraciones incrementales y reglas SQL aplicadas; no reescribirlas |
| `generated/` | Cliente Prisma regenerable; ignorado en Git |
| `src/contracts.ts`, `http.ts` | Transporte, comandos comunes, validación y autorización |
| `src/service.ts`, `queries.ts`, `views.ts` | Identidad común, operaciones y consultas de actividades |
| `src/series-*.ts`, `recurrence.ts` | Motor recurrente, familia/ordinal y excepciones |
| `src/pantry.ts`, `recipes.ts`, `planner.ts`, `shopping.ts` | Servicios de Cocina |
| `src/meal-consumption.ts`, `availability.ts`, `meal-weeks.ts`, `ingredient-retirement.ts` | Efectos y relaciones especializadas |
| `src/meal-amounts.ts`, `meal-amounts-server.ts`, `ingredient-tracking.ts` | Cantidades elegidas por comida y seguimiento personal por cantidad/disponibilidad |
| `src/owner-command.ts` | Protocolo de bloqueo, revisión y recibos de módulos |
| `src/authentication.ts`, `environment.ts`, `database.ts` | Acceso y conexión segura al núcleo |
| `src/retention.ts` | Retirada por lotes, exclusiones y relaciones protegidas |
| `inspect.ts` | Inspección de catálogo de instalación, solo lectura |

`docs/schema.objetivo.prisma`, `drafts/`, huellas de instalación y SQL de preparación son referencias históricas. No regenerar el esquema actual desde ellas ni ejecutar `prepare.cjs` para instalar la app. `create-database.cjs` fue una herramienta de transición, no un paso actual de instalación.

## Configuración

Las dependencias y lockfile se mantienen en la raíz; esta carpeta no necesita una instalación npm independiente.

La raíz `.env.local` configura URL/origen, secreto de sesión y credenciales Google; ver [.env.example de la raíz](../../.env.example). Esta carpeta guarda su conexión en `.env.local`:

```env
MIAGENDA_CORE_DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/miagenda_core?sslmode=verify-full"
```

El entorno solo usa esta variable; nunca cae en DATABASE_URL. Valida PostgreSQL y nombre `miagenda_core`, fuerza verify-full y elimina compatibilidad SSL libpq. PostgreSQL anterior permanece intacto y no se consulta por la app. El pool tiene máximo dos conexiones por proceso.

Desde la raíz:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Crear primero los archivos de entorno. `db:migrate` aplica únicamente migraciones existentes, no crea una migración nueva. No usar reset/db push ni ejecutar manualmente archivos SQL que ya están incluidos en migraciones.

Comprobación estática, también desde la raíz:

```powershell
npx next typegen
npm run typecheck
npm --prefix reconstruction/core run typecheck
```

## Invariantes que debe respetar una modificación

- Activity guarda el único estado de completado y un solo nivel de hijos. Agenda e Inbox consultan su programación, no otras tablas de tarea.
- Google únicamente autentica sujeto/proveedor, sin unir cuentas por correo ni persistir tokens Calendar.
- Todos los accesos y relaciones privadas verifican propietario; tipo y propietario no cambian.
- Mutaciones usan revisión esperada, bloqueo por usuario, recibo idempotente y una transacción. Compartir protocolo no autoriza escribir stock/completado directamente desde una pantalla.
- Comidas delegan en consumo; compra, ajustes y consumo usan movimientos verificables y no negativos. Deshacer aplica inversos exactos y respeta dependencias de tandas.
- Recetas/planes conservan versiones; solo actualizar pendientes por elección explícita. Borrador se calcula con porciones/tiempo/paso/ingrediente mínimos.
- Reservas previstas no son stock ni porciones cocinadas. Disponibilidad y compras consultan todos los planes pertinentes, aunque estén en otras semanas o calendarios ocultos.
- Piezas se proponen redondeadas hacia arriba por grupo obligatorio/opcional, con cantidades manuales por comida. Desactivar Cocinar no genera demanda aunque existan ajustes guardados. Solo disponibilidad nunca crea un consumo numérico ficticio.
- Retirar tarjetas o semanas no devuelve ingredientes. Conservar/retención/hijos no deben destruir evidencia necesaria.
- Familia y ordinal recurrentes sobreviven a modificaciones; borrar una serie incluye sus excepciones.
- Reintentos inciertos mantienen payload/commandId. No borrar recibos hasta definir un horizonte compatible con los clientes.

## Estado de revisión

Retirada de Calendar, consolidación, mejora general de rendimiento y revisión integral terminadas. El informe integral documenta 76 comprobaciones, con informes adicionales de retención (30) y acceso/aislamiento (4). El verificador reciente de Cocina registra 45 comprobaciones aprobadas; se ejecuta en un esquema temporal y elimina sus datos al terminar. TypeScript raíz/núcleo y compilación local correctos en el último bloque visual. El usuario aceptó la revisión visual de Cocina el 2026-10-08.

Los informes conservan alcance y límites; las comprobaciones de servicios no prueban cada gesto o dispositivo. Uso diario local preparado con herramientas de inicio, respaldo cifrado y recuperación. Siguen pendientes: despliegue público, móvil, offline, compactación de recibos, conversión de unidades, rutinas relativas y módulos nuevos. Los ajustes visuales posteriores se harán según el uso diario; captura global ya está conectada.
