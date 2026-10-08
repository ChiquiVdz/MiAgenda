# Cierre de reconstrucción

## Estado vigente · 2026-10-08

**Reconstrucción cerrada para uso diario local en PC.** Retirada de Calendar, consolidación, mejora general de rendimiento y revisión integral terminadas. La captura rápida global está habilitada y las herramientas locales de apertura, respaldo cifrado, recuperación y mantenimiento están preparadas.

- [Resultados integrales](RESULTADOS_REVISION_INTEGRAL.md): 76 comprobaciones integrales, 30 de retención y 4 de acceso/aislamiento; incluye correcciones y límites.
- [Últimos cambios de Cocina](RESULTADOS_COCINA_CANTIDADES.md): 45 comprobaciones aprobadas de cantidades, disponibilidad, compras y sobras. Revisión visual de Cocina aceptada por el usuario el 8 de octubre de 2026, tras compactar el editor de comidas.
- [Uso diario local](USO_DIARIO_LOCAL.md) y [comprobación de sus herramientas](RESULTADOS_USO_DIARIO_LOCAL.md).

Pendientes posteriores: móvil, producción pública con su configuración y seguridad, offline limitado, dashboard y módulos nuevos. Las rutinas con tiempos relativos se han discutido, sin implementar. Las aclaraciones de etapa propuestas para PROJECT.md siguen requiriendo aprobación específica; ese contrato no se modifica en esta actualización documental.

Los apartados siguientes son el registro de cada bloque en su fecha. Las referencias a comprobaciones futuras describen aquella etapa, no pendientes actuales.

## Bloque 1 — retirar implementación anterior (2026-10-06)

Google se utiliza únicamente para iniciar sesión, con `openid email profile`. Se conserva el proveedor de NextAuth, su adaptador Prisma y la cookie de sesión del núcleo. No se modifica el modelo de datos ni se aplica una migración.

Retirados los servicios de Calendar, cifrado de tokens antiguos, rutas API antiguas, pantallas alternativas y selector `MIAGENDA_CORE_ENABLED`. Las páginas y la retención usan exclusivamente el núcleo propio. Se conservan Mes, Año, selector horario y utilidades de fechas utilizados por la interfaz actual. `/hoy` queda como alias hacia `/agenda`.

Retirados el esquema/migraciones de la base anterior y sus scripts/pruebas, conservándolos en una copia recuperable. La base anterior permanece intacta en Neon. Las migraciones vigentes siguen en `reconstruction/core/migrations`, el esquema en `reconstruction/core/schema.prisma` y la conexión en `MIAGENDA_CORE_DATABASE_URL`. No hay fallback a `DATABASE_URL`.

`googleapis` y sus dependencias exclusivas se retiran del manifiesto y lockfile. `db:generate` genera el cliente del núcleo; `db:migrate` aplica sus migraciones existentes mediante deploy. No se ejecutaron estos comandos de base de datos durante la retirada.

Referencia: [copia e inventarios](../reconstruction/legacy-reference/2026-10-06/README.md).

### Comprobaciones de este bloque

- Copia ZIP: 287 archivos y SHA-256 verificado tras la retirada.
- Retirados 93 archivos de fuente anteriores y 37 de esquema/herramientas/pruebas. Conservados 51 archivos activos de fuente de interfaz y adaptación.
- Lockfile actualizado sin acceso a red; instalación depurada: 45 paquetes eliminados, incluido googleapis.
- Next regeneró correctamente las definiciones de rutas. API activa: acceso, núcleo, retención por usuario y cron.
- TypeScript raíz y núcleo: ambos finalizados sin errores. La primera comprobación detectó referencias antiguas en archivos generados de Next; regenerar sus tipos resolvió esas referencias.
- No se ejecutaron pruebas funcionales ni operaciones de datos. La comprobación integral queda en el bloque 3.

## Bloque 2 — consolidación de conexiones y documentación (2026-10-06)

Terminado como revisión de código y documentación; no sustituye la comprobación funcional final.

### Conexiones revisadas

Actividad/horario entre Inbox y Agenda; delegación de comidas desde ActivityService a consumo/movimiento/retirada especializados; uso del mismo MealEditor/saveMeal desde Agenda y Planificar; reservas/compras derivadas globalmente; protocolo compartido de propietario, revisión y recibos. No se sustituyeron servicios de dominio ni se cambió el esquema.

### Correcciones

- Activity feed ahora pospone consultas mientras conserva un comando incierto, igual que los otros feeds. La lectura pendiente se realiza al resolver el intento; no se pierde su commandId ni se admite otro guardado mientras está pendiente.
- Cargar otra página de actividades con distinta dataRevision vuelve a consultar desde el principio, en vez de mezclar filas de snapshots distintos.
- Editor de horario admite opciones mínimas de calendario. Si Planificar no carga el catálogo de calendarios, usa el ID existente de la preparación o el de su principal; permite modificar/quitar/volver a agendar su horario sin descargar todos los calendarios. La API conserva la validación de propietario.
- Los valores predeterminados del horario respetan la zona del horario editado.
- Recetario libera la referencia a una consulta abortada al empezar una escritura, conservando el control de generaciones.

### Documentación

README raíz y guía del núcleo reescritos para la implementación activa. Copias previas conservadas en `legacy-reference/2026-10-06/README_PRE_BLOQUE_2.md` y `core/HISTORIAL_BLOQUES.md`. Índice documental, arquitectura actual y plan de revisión final añadidos. Modelo/esquema inicial distinguen diseño aprobado e implementación actual; los documentos de transición anteriores están señalados como históricos.

Añadido `.env.example` del núcleo. Quitado el script npm `prepare` de esta carpeta: la preparación inicial ya no es un comando de instalación; la herramienta histórica se conserva para referencia.

No se modificó PROJECT.md. [Propuestas documentales](PROJECT_CAMBIOS_PROPUESTOS_CIERRE.md) aclaran dos textos de etapa ya superada, pendientes de aprobación y sin cambios de reglas.

### Comprobaciones

- Tipos de rutas Next regenerados correctamente.
- TypeScript raíz y núcleo finalizados sin errores.
- 38 enlaces locales de las guías vigentes comprobados antes de esta entrada; destinos existentes.
- Código activo y manifiestos sin referencias a googleapis, selector coreModeEnabled, cifrado Calendar, googleCalendarId ni syncToken.
- No se ejecutaron pruebas funcionales, mediciones de rendimiento, migraciones ni operaciones de datos en este bloque.

## Secuencia acordada durante el cierre — registro histórico

1. Mejora de rendimiento **general** realizada después del bloque 2, con mediciones antes/después. Ver evidencia abajo.
2. Comprobación integral de toda la app y de semanas, sustitución de ingredientes y comidas desde Agenda. El usuario autorizó utilizar su cuenta y datos de prueba. Corregir fallos antes del cierre definitivo.
3. Captura rápida, rediseños, despliegue y offline después del cierre.

En esa etapa la retirada/consolidación todavía no equivalía a una comprobación funcional integral. Esta ya se ejecutó posteriormente: consultar [resultados](RESULTADOS_REVISION_INTEGRAL.md); el [plan integral](REVISION_INTEGRAL.md) queda como guía reutilizable.

## Rendimiento general — 2026-10-06

Lecturas comunes de actividades optimizadas con una proyección de ascendencia de recurrencia; Inbox reutiliza esa lectura. Planificar obtiene el origen del consumo con una proyección pequeña. Memoización de listas/agrupaciones en Inbox, todas las vistas de Agenda, Alacena, Recetario, Planificar y Compras; formatos de fechas reutilizados.

Tres rondas de 14 lecturas antes/después sobre la cuenta con sesión activa, con conexión PostgreSQL que rechaza escrituras. Las 13 respuestas de datos mantienen su huella exacta en las tres rondas; sesión excluida por privacidad. Consultas de Inbox 11 → 8, Semana/Día 25 → 20, Mes 25 → 21, Año 14 → 9, detalle 17 → 13 y Planificar 30 → 26. TypeScript de raíz/núcleo sin errores. No se modificó PROJECT.md ni se aplicaron migraciones. No se realizaron pruebas mutantes del plan integral.

Los tiempos también bajaron, pero varió la latencia de Neon; no atribuir toda esa diferencia al código. [Informe, mediciones y límites](RENDIMIENTO_GENERAL.md). [Recorrido manual añadido](REVISION_INTEGRAL.md).
