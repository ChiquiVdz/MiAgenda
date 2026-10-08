# Documentación de MiAgenda

Actualizado: 2026-10-08. El diseño vigente utiliza motor propio; Google solo autentica. PROJECT.md es la base y sus secciones 18/19 prevalecen. Núcleo cerrado para uso diario local en PC; adaptación móvil y copia local de consulta implementadas; despliegue, iPhone real y edición sin conexión pendientes.

## Documentos vigentes

Última revisión funcional: [subtareas recurrentes, calendario heredado y preparaciones previas](RESULTADOS_SUBTAREAS_PREPARACIONES.md), con 57 comprobaciones aprobadas y una corrección del reloj para preparaciones de cinco minutos.

Última revisión de Cocina: [cantidades por comida, disponibilidad, compras y sobras](RESULTADOS_COCINA_CANTIDADES.md), 8 de octubre de 2026. Incluye 45 comprobaciones aprobadas, aceptación visual del usuario y sus límites.

| Documento | Papel |
|---|---|
| [Prueba real en iPhone](PRUEBA_IPHONE.md) | Publicación HTTPS, acceso personal, instalación y revisión en Safari; publicación pendiente |
| [Copia local](COPIA_LOCAL.md) | Consulta descargada, comprobación al entrar, actualización manual, límites y revisión |
| [Primera adaptación a iPhone](INTERFAZ_IPHONE.md) | Navegación inferior, Planificar por día y guía de revisión; instalación y revisión en iPhone pendientes |
| [PROJECT.md](../PROJECT.md) | Contrato aprobado, modificable únicamente con acuerdo del usuario |
| [Modelo objetivo](MODELO_OBJETIVO.md) | Modelo lógico aprobado |
| [Arquitectura actual](ARQUITECTURA_ACTUAL.md) | Implementación conectada y límites reales |
| [Núcleo](../reconstruction/core/README.md) | Instalación, esquema vigente y mantenimiento |
| [Cierre](CIERRE_RECONSTRUCCION.md) | Bloques realizados y evidencia |
| [Revisión integral](REVISION_INTEGRAL.md) | Guía reutilizable; revisión del cierre ya ejecutada |
| [Resultados integrales](RESULTADOS_REVISION_INTEGRAL.md) | Evidencia técnica, recorridos y correcciones del cierre |
| [Revisión reciente de Cocina](RESULTADOS_COCINA_CANTIDADES.md) | Cantidades, disponibilidad, compras y sobras comprobadas |
| [Subtareas y preparaciones comprobadas](RESULTADOS_SUBTAREAS_PREPARACIONES.md) | 57 comprobaciones, recorrido en navegador y corrección del horario de cinco minutos |
| [Uso diario local](USO_DIARIO_LOCAL.md) | Abrir, cerrar, respaldar y recuperar en esta PC |
| [Preparación del uso diario](RESULTADOS_USO_DIARIO_LOCAL.md) | Evidencia de respaldo/restauración y herramientas locales |
| [Rendimiento general](RENDIMIENTO_GENERAL.md) | Mejoras y mediciones del cierre, antes/después |
| [Rendimiento anterior](RENDIMIENTO.md) | Mediciones históricas de la revisión anterior |
| [Reemplazo de ingredientes](INGREDIENTES_REEMPLAZO.md) | Funcionamiento y guía; servicios comprobados en la revisión integral |
| [Comidas desde Agenda](COMIDAS_DESDE_AGENDA.md) | Flujo compartido actual y pasos de revisión |
| [Horario de subtareas recurrentes](SUBTAREAS_HORARIO_SERIE.md) | Programar, cambiar y quitar por alcance, reglas y revisión manual |
| [Tramos previos de recetas](RECETAS_TRAMOS_PREVIOS.md) | Preparación desde los propios pasos, horarios y comprobación manual |
| [Tipos de comida en recetas](RECETAS_TIPOS_COMIDA.md) | Clasificación por filas de Planificar, filtros y revisión manual |
| [Aclaraciones propuestas para PROJECT.md](PROJECT_CAMBIOS_PROPUESTOS_CIERRE.md) | Pendientes de aprobación; sin cambios de reglas |

## Diseño e historial

- [Esquema físico inicial](ESQUEMA_FISICO.md) y `schema.objetivo.prisma`: propuesta y decisiones de diseño. El esquema instalado está en `reconstruction/core/schema.prisma` y sus migraciones.
- [Historial de bloques](../reconstruction/core/HISTORIAL_BLOQUES.md): implementación por etapas, errores y correcciones; los pendientes iniciales pueden estar resueltos después.
- [Auditoría de arquitectura](AUDITORIA_ARQUITECTURA.md): evaluación previa que llevó a reconstruir, no descripción de la app actual.
- [Transición inicial a actividades](ACTIVIDADES_BASE_COMUN.md), [implementación anterior](ACTIVIDADES_IMPLEMENTACION.md): propuestas/transición sobre la app con Google, superadas por el núcleo propio.
- [Proyecto anterior](PROJECT_ANTERIOR_GOOGLE.md): contrato histórico de Calendar.
- [Propuesta aprobada](PROJECT.propuesta.md): copia documental inicial; las actualizaciones vigentes viven en PROJECT.md.
- [Copia recuperable anterior](../reconstruction/legacy-reference/2026-10-06/README.md): ZIP/inventarios sin secretos. El README previo al bloque 2 también se conserva allí; sus rutas correspondían a su ubicación original.

No usar instrucciones de migración/autorización Google Calendar de documentos históricos para el núcleo activo.
