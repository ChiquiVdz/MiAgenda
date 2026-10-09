# Copia local — consulta y evolución

**Actualización:** los bloques de altas de Inbox y edición/completado de tareas normales con envío manual están implementados en el código. Consultar [Cambios locales](CAMBIOS_LOCALES.md) para reglas vigentes, límites y revisión. Las secciones siguientes describen el bloque original de consulta; sus restricciones de solo lectura y cola futura quedan sustituidas por esa actualización.

8 de octubre de 2026. Decisiones aprobadas en la conversación y reflejadas en PROJECT.md.

## Qué permite

- Abrir la última copia de Inbox, Agenda, Alacena, Recetas, Planificar y Compras sin descargar de nuevo los datos al navegar, incluso con internet disponible.
- IndexedDB guarda una sola cuenta activa. El service worker guarda únicamente la pantalla pública y sus recursos, sin HTML privado, credenciales ni respuestas API.
- En la primera entrada con conexión se descarga una copia. Después, al abrir, se comprueban identidad y revisión. Si son distintas aparece «Hay cambios de otro dispositivo. ¿Actualizar ahora?». No se sustituye la copia hasta aceptar. Volver después de más de cinco minutos en segundo plano cuenta como nueva entrada; no hay temporizador periódico.
- Recuperar foco, reconectar o cambiar de apartado no descarga información automáticamente. Reconectar solo cambia el indicador de conexión. El único botón «Actualizar» envía los pendientes y descarga explícitamente una copia nueva.
- Las operaciones conectadas mantienen su autorización, revisión e idempotencia originales. Recetas y tareas sencillas actualizan la copia con la respuesta del guardado, comprobando la revisión de origen bajo el bloqueo del propietario. Para Cocina, recurrencias, respuestas repetidas o cambios que no admiten un ajuste local seguro se renueva el snapshot. La sincronización incremental general y la cola de modificaciones se harán en bloques posteriores. No es todavía edición local con envío diferido.
- Navegación interna sin solicitudes RSC de Next. Las rutas de organización son pantallas públicas estáticas; toda lectura privada sigue autorizada en la API. Abrir una pantalla estática sin sesión no concede acceso a datos.

## Alcance descargado y límites

Agenda y Planificar cubren seis semanas: la anterior y cinco desde el lunes actual. Inbox incluye las entradas pendientes antiguas y las completadas que el servidor conserve; no se recorta por antigüedad. También se descargan catálogo/alacena, recetas y Compras, con los recibos visibles de treinta días, además de destacados del año actual.

Fuera de esas fechas se muestra un aviso y «Descargar estas fechas». Nunca se sustituye un rango ausente por una lista vacía que aparente estar completa. Hasta ocho consultas adicionales se guardan en IndexedDB y caducan al actualizar toda la copia. Si una consulta adicional supera la página disponible, se pide un intervalo menor, en lugar de ocultar actividades. No se descarga todo el historial ni se materializan recurrencias indefinidas.

Las descargas paginan Inbox/Agenda, recetas, catálogo/alacena y comprados. Tienen límites explícitos de tamaño y páginas; un límite o un cambio concurrente cancela la nueva descarga y conserva la anterior. La revisión de propietario se comprueba antes/después de las proyecciones para no presentar una mezcla como snapshot completo. Las consultas de disponibilidad de Cocina siguen considerando todos los planes pertinentes, incluidos los de otras semanas.

La retención nunca se ejecuta sobre IndexedDB. Actualizar manualmente pide un lote pequeño al servidor antes de descargar. La limpieza sin abrir la app sigue requiriendo el cron de producción. Una copia desconectada puede mostrar completadas ya purgadas en el servidor hasta que se actualice.

Cerrar sesión limpia la copia local y avisa a otras pestañas. Iniciar acceso con Google limpia la copia anterior antes de cambiar de cuenta. Sin internet se pide conexión para invalidar también la sesión del servidor. Las mutaciones envían el propietario esperado para impedir que una sesión cambiada en otra pestaña guarde bajo la cuenta equivocada.

El navegador puede desalojar datos por falta de espacio o borrado de almacenamiento. La copia no sustituye al respaldo de PostgreSQL. Si falta almacenamiento o falla la descarga se informa del problema y no se promete disponibilidad offline.

La actualización general se concentra en «Actualizar» en la barra superior. Los apartados no tienen un segundo botón de actualización. Las acciones específicas de revisar un alcance o actualizar una versión de receta mantienen su función propia.

## Cómo revisar

1. Abrir MiAgenda con conexión y esperar a que termine «Preparando tu copia». En Info debe decir «Pantallas listas para abrir sin conexión». Se necesita una compilación de producción local (`npm run build`, `npm start`); en `npm run dev` se guardan datos, pero no se promete recarga offline de la pantalla.
2. Entrar en Inbox, Agenda y los cuatro apartados de Cocina. La barra superior debe decir «Copia local» con su fecha de guardado. En móvil se conserva la navegación inferior.
3. Desconectar internet en el dispositivo y recargar una ruta ya preparada. Debe seguir abriendo. Revisar tareas, pasos de recetas, comidas e ingredientes descargados. La barra indica «Sin conexión · solo consulta».
4. Intentar guardar o completar sin conexión: debe explicar que esta etapa es de consulta. No debe aparentar un guardado ni crear una cola de cambios.
5. Ir a fechas fuera del rango: aparece el aviso. Con conexión, pulsar «Descargar estas fechas»; se mantienen la vista y fechas elegidas.
6. Para la comprobación entre dispositivos: guardar un cambio desde otro navegador/dispositivo, volver a abrir el primero y comprobar que ofrece actualizar. Antes de aceptar se mantiene la copia anterior; después muestra el cambio. No se consultan datos periódicamente mientras permanece abierto.
7. Cerrar sesión y comprobar que no reaparece la copia privada al volver sin iniciar acceso.

Para una revisión técnica de consultas: en la pestaña Red del navegador, tras preparar la copia, navegar entre apartados no debe provocar `/api/core`, consultas de sesión ni solicitudes `?_rsc`. Reabrir produce la comprobación `/api/core/local?check=1`. Las escrituras, la actualización manual, información adicional solicitada al editar y la instalación/actualización de recursos sí pueden usar red.

## Comprobaciones de este bloque

Compilación y revisión de tipos correctas. Se confirmó en la vista previa la descarga inicial y el indicador «Pantallas listas para abrir sin conexión». Se corrigió un timeout de adquisición de conexiones: la descarga trabaja con un máximo de dos proyecciones simultáneas, según el pool actual. No se añadieron ni ejecutaron suites funcionales ni se alteraron actividades para probar. Safari/iPhone real, sesión entre dos dispositivos y pérdida real de conectividad quedan para revisión del usuario con los pasos anteriores. No implica publicación ni instalación en iPhone todavía.

## Continuar

Siguiente bloque: alta de Inbox sin conexión con cola persistente e idempotencia; después edición/completado de actividades y, por separado, operaciones contables de Cocina. Antes de habilitar escrituras desconectadas habrá que definir conflictos, borrados, reintentos y revisión de resultados. El service worker se versiona con las fuentes mediante `scripts/prepare-local-worker.mjs`; usar siempre `npm run build` para preparar una publicación.
