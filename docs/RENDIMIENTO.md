# Revisión de rendimiento — 6 de octubre de 2026

## Alcance

Núcleo propio activo: acceso, Inbox, calendarios, Agenda, Alacena, Recetario,
Planificador, Compras y mecanismos de actualización/retención. Se revisaron
consultas, navegación, cálculos de fechas y carga de relaciones. El código de
referencia anterior permanece recuperable; no se optimizó su integración Google
Calendar, porque no forma parte del motor actual.

No cambia el contrato de PROJECT.md, el esquema de la base ni las reglas de
consumo, sobras, recurrencia o retención. No se añadieron dependencias.

## Mediciones

Tres rondas secuenciales sobre los datos actuales de una cuenta, con conexión
PostgreSQL configurada con `default_transaction_read_only=on`. No se registran
contenido, identificadores de usuario, consultas, parámetros ni credenciales.
La conexión se establece antes de medir. Se excluyen autenticación HTTP,
compilación de Next.js y renderizado del navegador.

Medianas de las tres rondas (milisegundos). Las consultas cuentan también los
eventos de transacción que Prisma registra; no equivalen a clics ni solicitudes.

| Lectura | Antes | Después | Consultas antes → después |
| --- | ---: | ---: | ---: |
| Inbox | 1 628 ms | 926 ms | 21 → 11 |
| Calendarios | 425 ms | 425 ms | 4 → 4 |
| Agenda semanal | 2 150 ms | 1 921 ms | 28 → 25 |
| Alacena | 1 204 ms | 430 ms | 15 → 4 |
| Recetario | 496 ms | 497 ms | 5 → 5 |
| Planificador | 3 830 ms | 2 267 ms | 52 → 30 |
| Compras | 785 ms | 778 ms | 9 → 9 |

La mayor mejora se concentra en Alacena (~64%), Inbox (~43%) y Planificar
(~41%). Recetario/Compras ya requerían pocas consultas; la diferencia pequeña
es compatible con variación de red, no evidencia una mejora propia.

Los siete resultados conservaron el tamaño de respuesta serializada medido.
Esto es una comprobación de tamaño, no demuestra por sí mismo equivalencia de
contenido ni verifica mutaciones.

Resultados sin datos personales: `reconstruction/core/performance-before.json`
y `reconstruction/core/performance-after.json`. El campo `databaseMs` suma
duraciones de eventos que pueden incluir cola y superponerse; no debe
interpretarse como tiempo exclusivo de CPU o sumarse a la duración de lectura.

## Cambios aplicados

- Alacena: dos lecturas acotadas con uniones por propietario, en lugar de
  repetir cinco relaciones por catálogo y saldo. El bloqueo de unidades usa
  existencia de referencias, sin descargar movimientos/historial.
- Inbox: omitir relaciones de recetas/consumos que una tarea de Inbox no tiene.
- Agenda/detalle: cargar el árbol común una vez; cargar información de cocina
  solo cuando existen pasos o bloques de comida. Consultas y relaciones
  conservan filtro de propietario y una transacción de lectura consistente.
- Planificador: reutilizar los pasos y versiones congeladas que ya carga el
  editor para construir la tarjeta común. Mantener la última selección de
  opcionales, incluso después de deshacer, y mostrar solo consumos activos.
- Sobras: calcular saldo de tandas en PostgreSQL y retornar únicamente tandas
  con saldo positivo. No descargar cada uso histórico al servidor. Las
  evidencias siguen en la base y la proyección considera todos los planes
  pendientes pertinentes, independientemente de semana/calendario visible.
- Acceso: una consulta para unir sesión y usuario, sin caché de sesiones y
  conservando la validación de vencimiento de la biblioteca de autenticación.
- Navegación del núcleo: usar Link de Next.js para evitar recargar todo el
  documento. `prefetch={false}` evita lecturas anticipadas de los seis módulos.
  Añadir indicación de carga y reiniciar el planificador al abrir otra comida
  por URL para no reutilizar el editor/rango de una comida anterior.
- Fechas: reutilizar hasta 16 formateadores por zona horaria tanto en la
  Agenda como en el motor; esta caché no contiene actividades ni usuarios.

## Revisión realizada y límites

- TypeScript del núcleo y aplicación sin errores durante la revisión.
- Lecturas reales de los siete servicios: tres rondas antes y después.
- Navegación entre Alacena, Agenda, Planificador, Compras, Recetario e Inbox en
  el navegador; apertura y despliegue de pasos, sin completar ni modificar
  comidas de prueba. La última carga de Alacena registró 548 ms para la
  respuesta HTTP completa en el servidor de desarrollo; es una muestra,
  no una mediana ni garantía de latencia.
- El servidor de desarrollo continúa abierto en localhost:3000.
- No se ejecutó suite funcional, carga masiva ni benchmark de producción.
  Completar/deshacer, edición y concurrencia requieren revisión manual; este
  diagnóstico no afirma haber verificado sus efectos por escrito.

## Lo que todavía puede producir espera

1. Next.js en desarrollo compila rutas nuevas al entrar. Esa primera visita
   puede tardar más que las siguientes y no representa la versión publicada.
2. Cada lectura autenticada todavía viaja a Neon. La latencia de red y el
   arranque de una base suspendida no desaparecen con estas optimizaciones.
3. Las lecturas anidadas restantes de Prisma producen una advertencia de pg
   sobre consultas concurrentes en una conexión. La versión instalada sigue
   funcionando, pero conviene revisar compatibilidad antes de actualizar pg a 9.
4. El editor de planificación calcula sugerencias sobre todos los planes
   pertinentes. Ya usa memoización; conviene medirlo con un catálogo grande
   antes de introducir cálculos incrementales o procesos adicionales.
5. Cada visita a Inbox/Agenda inicia el mantenimiento existente, cuya base
   limita la limpieza diaria y por lotes. No se desactivó la retención aprobada.
6. Las páginas aún importan componentes de referencia antiguos. Retirar esa
   compatibilidad en el bloque de cierre puede reducir compilación inicial;
   no se retiró código recuperable durante esta revisión.
7. No se introdujo caché persistente de actividades. Una caché de datos por
   usuario y la política de navegación atrás/adelante deben diseñarse junto
   con invalidación y el bloque offline para no presentar saldos obsoletos.

## Cómo revisar

1. Recargar una vez la vista previa. Pasar entre Inbox, Agenda, Alacena,
   Recetario, Planificar y Compras; repetir una segunda vuelta para separar
   compilación inicial de carga habitual.
2. Cambiar una cantidad de Alacena; guardar; abrir Compras y Planificar y
   comprobar las cantidades/avisos. Volver con los enlaces de la app.
3. Abrir una comida: revisar pasos, opcionales, porciones y preparaciones
   previas. Comprobar también el enlace «Editar en Planificar» desde Agenda.
4. Completar/deshacer una comida de prueba y revisar inventario/sobras; las
   dependencias deben mantener el comportamiento aprobado.
5. Cambiar de semana/vista y desplegar subtareas; comprobar que responde y que
   Actualizar sigue trayendo cambios de otra pestaña.

El diagnóstico se puede repetir desde la raíz con Node 24 y
`--experimental-transform-types reconstruction/core/performance-audit.ts`.
Solo admite guardar métricas en las rutas fijas before/after; la conexión
prohíbe escrituras. Utilizar los tiempos como referencia de este entorno,
no como garantía para otros equipos o cuentas.
