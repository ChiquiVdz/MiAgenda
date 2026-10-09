# MiAgenda

Aplicación personal de actividades, calendario y Cocina. Inbox, Agenda y comidas usan una base común de actividades con subtareas. Google sirve únicamente para iniciar sesión; la información y el calendario pertenecen a MiAgenda y se guardan en PostgreSQL.

**Estado al 2026-10-08:** núcleo reconstruido y Google Calendar retirado; Google se usa solo para entrar. Inbox, Agenda y Cocina habilitados, con revisión integral previa y ajustes de rendimiento/acomodo. Captura rápida, respaldo y mantenimiento preparados. Primera versión publicada en Vercel y acceso confirmado por el usuario en iPhone. El código incorpora ahora cola local para Inbox y tareas normales, publicada y pendiente de terminar la revisión de ese nuevo flujo en el dispositivo. Consultar [Uso diario local](docs/USO_DIARIO_LOCAL.md) y [Cambios locales](docs/CAMBIOS_LOCALES.md).

## Empezar a leer

| Documento | Para qué sirve |
|---|---|
| [PROJECT.md](PROJECT.md) | Contrato aprobado; secciones 18/19 tienen precedencia. Cambios requieren acuerdo del usuario |
| [Arquitectura actual](docs/ARQUITECTURA_ACTUAL.md) | Qué está conectado, responsabilidades, conexiones y límites reales |
| [Núcleo: instalación y mantenimiento](reconstruction/core/README.md) | Esquema vigente, migraciones, configuración y reglas para trabajar |
| [Modelo objetivo](docs/MODELO_OBJETIVO.md) | Modelo lógico aprobado; no sustituye el esquema instalado |
| [Cierre de reconstrucción](docs/CIERRE_RECONSTRUCCION.md) | Trabajo realizado y bloques de cierre |
| [Resultados de revisión integral](docs/RESULTADOS_REVISION_INTEGRAL.md) | Pruebas, correcciones y límites conocidos |
| [Última revisión de Cocina](docs/RESULTADOS_COCINA_CANTIDADES.md) | Cantidades manuales, disponibilidad, compras, sobras y aprobación visual |
| [Uso diario local](docs/USO_DIARIO_LOCAL.md) | Apertura, cierre, respaldo y recuperación en PC |
| [Guía de revisión manual](docs/REVISION_INTEGRAL.md) | Recorridos para comprobar la interfaz |
| [Índice documental](docs/README.md) | Documentos actuales, propuestas e historial |

## Qué hace

- **Inbox:** pendientes, descripción y un nivel de subtareas; completar/deshacer; programar principal o hijo sin duplicar identidades.
- **Agenda:** calendarios propios con colores/filtros, Día/Semana/Mes/Año, destacados, detalle, creación de tareas o comidas, arrastre y duración de actividades con hora.
- **Recurrencias:** reglas propias, ventanas de fechas, excepciones, edición/completado/borrado por alcance y cambios de frecuencia respetando instancias modificadas.
- **Retención:** cinco días desde completado, nunca antes del fin; Conservar y relaciones de hijos protegidas. Activar Destacar activa Conservar.
- **Alacena:** catálogo compacto común e ingredientes privados, seguimiento personal «Por cantidad» o «Solo disponibilidad», ajustes verificables y retirada/sustitución personal. Los ingredientes con existencias aparecen primero en el catálogo; el historial de movimientos permanece interno.
- **Recetas:** creación rápida desplegable, pasos con cero o un ingrediente, cantidades, equivalencias y opcionalidad; borrador calculado automáticamente; versiones congeladas en los planes.
- **Planificar:** una o dos semanas lunes–domingo, filas editables, varias recetas distintas por comida, fases, porciones, tiempos, preparaciones previas, disponibilidad cronológica, copia de semana anterior y borrado semanal. Editor lateral compacto con cantidades por comida: piezas redondeadas hacia arriba, gramos/ml proporcionales y ajustes manuales, incluidas fracciones, sin modificar el recetario.
- **Consumos y sobras:** descuento al completar, tandas reales por receta, reservas previstas sin consumo y reversión exacta con protección de dependencias.
- **Compras:** faltantes de todas las semanas con Cocinar activo, cantidades elegidas, artículos libres, compra individual/conjunta, comprados y deshacer.

Semanas, sustitución de ingredientes y comidas desde Agenda están cubiertos en la revisión integral; cantidades y disponibilidad, en la revisión reciente de Cocina. Los informes distinguen pruebas de servicios, recorridos de navegador y aceptación visual del usuario. No equivalen a cobertura exhaustiva de todos los gestos, dispositivos o casos concurrentes.

## Arquitectura y carpetas

```text
src/app/                     Pantallas y rutas Next.js
src/app/core/                Tarjetas, editores y hooks de actividades/Cocina
src/lib/                    Acceso, conexión al núcleo y fechas de presentación
reconstruction/core/src/    Servicios y contratos independientes de la interfaz
reconstruction/core/schema.prisma
reconstruction/core/migrations/
docs/                       Diseño, arquitectura e informes
reconstruction/legacy-reference/
                            Referencia recuperable anterior, sin credenciales
```

Una app full-stack: Next.js 16.3.8, React 19.2.8, TypeScript 5.9.3, Prisma 7.10.0, PostgreSQL/Neon y NextAuth 4.24.15. Versiones fijadas en package.json/lockfile. Sin integración Calendar, microservicios ni Redis.

## Ejecutar localmente

Requisitos: Node compatible con `engines` de package.json, npm y PostgreSQL en una base independiente llamada `miagenda_core`. Se recomienda Node 24 para las herramientas auxiliares que ejecutan TypeScript directamente.

1. Instalar dependencias desde la raíz: `npm ci`.
2. Crear `.env.local` desde [.env.example](.env.example): `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `CRON_SECRET` se usa para la limpieza programada, no para acceder.
3. Crear `reconstruction/core/.env.local` desde su [.env.example](reconstruction/core/.env.example), indicando `MIAGENDA_CORE_DATABASE_URL` hacia `miagenda_core`. No reutilizar la conexión de la base anterior ni pegar secretos en documentos/Git.
4. En el cliente OAuth web de Google configurar origen `http://localhost:3000` y retorno `http://localhost:3000/api/auth/callback/google`. Solo se pide identidad básica.
5. Generar el cliente: `npm run db:generate`.
6. Aplicar migraciones existentes a la base configurada: `npm run db:migrate`. No resetear una base con datos ni usar db push para sustituir las migraciones.
7. Arrancar: `npm run dev`. Abrir `http://localhost:3000`; entra por Inbox.

Las migraciones incluyen el catálogo común inicial. General se crea con el usuario; Cocina y sus filas se inicializan mediante su servicio al abrir Planificar. Los datos anteriores no se trasladan automáticamente.

## Comandos de mantenimiento

| Comando | Acción |
|---|---|
| `npm run dev` | Vista previa local |
| `npm run build` / `npm run start` | Construcción y ejecución de producción |
| `npm run db:generate` | Genera únicamente el cliente Prisma del núcleo propio |
| `npm run db:migrate` | Aplica migraciones existentes con migrate deploy |
| `npx next typegen` | Actualiza tipos de rutas, útil después de retirar/agregar páginas |
| `npm run typecheck` | Comprobación estática de la app |
| `npm --prefix reconstruction/core run typecheck` | Comprobación estática del núcleo |

Comprobar tipos no demuestra que funcionen los recorridos completos. No ejecutar pruebas o comandos que cambien datos sin autorización para ese bloque. No editar migraciones ya aplicadas; cambios nuevos requieren migraciones incrementales.

## Datos y garantías

Datos privados por usuario salvo catálogo común de ingredientes. Un mismo servicio gobierna actividad/hijos; Cocina añade versiones, saldos, movimientos y porciones. Las mutaciones verifican propietario, revisiones y recibo idempotente, con efectos atómicos. Un reintento conserva el comando; comprar o cocinar no debe duplicarse.

Eliminar una comida consumida quita su representación sin devolver inventario. Deshacer revierte el consumo y puede requerir corregir primero comidas dependientes. La retención conserva las evidencias necesarias. Recibos idempotentes todavía no se compactan automáticamente; Comprados muestra treinta días sin borrar sus recibos.

## Qué sigue

1. Usar diariamente en PC y corregir incidencias o preferencias de acomodo que aparezcan. La revisión visual de Cocina quedó aceptada; la [guía manual](docs/REVISION_INTEGRAL.md) sirve para revisiones posteriores.
2. Primera adaptación móvil implementada; revisar Safari e iPhone real al habilitar acceso público.
3. Preparar despliegue: medición en el entorno de destino, HTTPS/origen, OAuth, limpieza con la app cerrada, seguridad/dependencias y estrategia de respaldo. La compilación local de producción no equivale a un despliegue público.
4. [Copia local y cola de tareas](docs/COPIA_LOCAL.md): Inbox y tareas/subtareas normales, incluidos sus horarios individuales, guardan localmente y se envían manualmente. Publicado; su revisión en iPhone sigue en curso. Series y operaciones de Cocina offline siguen pendientes; dashboard, seguimiento selectivo, widget y módulos Finanzas/Ejercicio son futuros. Rutinas con tiempos relativos y recurrencia desde el completado siguen por diseñar.

La captura rápida «＋ Anotar» está disponible en Inbox, Agenda y Cocina: guarda localmente una tarea sin horario en Inbox y mantiene la pantalla actual. El único botón «Actualizar» envía cambios con recibos idempotentes y después descarga la copia más reciente; no interpreta fechas escritas en el texto. No hay notificaciones push. Los recordatorios de preparación son actividades programadas y Cocina aún requiere conexión para modificarse.

## Continuar como persona o agente

Leer PROJECT.md completo y las instrucciones de AGENTS.md antes de modificar. Consultar la guía local de Next.js correspondiente en `node_modules/next/dist/docs/`. Revisar archivos/cambios existentes y tratar historial como referencia, sin activar diseños antiguos. Preguntar decisiones de producto pendientes; entregar bloques revisables y no modificar PROJECT.md sin aprobación.

La [copia recuperable](reconstruction/legacy-reference/2026-10-06/README.md) conserva la implementación anterior y sus inventarios. El [historial de bloques](reconstruction/core/HISTORIAL_BLOQUES.md) contiene pasos y errores de la reconstrucción; sus pendientes antiguos no son el estado vigente.
