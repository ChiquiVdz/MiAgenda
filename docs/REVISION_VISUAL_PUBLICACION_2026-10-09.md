# Revisión visual y preparación de publicación — 9 de octubre de 2026

## Alcance

Complementa las 139 comprobaciones automatizadas documentadas en REVISION_BLOQUES_LOCALES_2026-10-09.md. Esta entrega revisa componentes React renderizados y handlers reales de Next con la sesión existente, a ancho de PC y 390 × 844. No sustituye una prueba física de Safari/iPhone.

## Comprobado y corregido

- Crear una principal de prueba en Inbox, agregar dos hijos como lote, programar la principal y un hijo; herencia de General y presencia del hijo en Agenda.
- Envío manual real: cuatro operaciones pendientes llegaron a cero, conservando identidad, horarios y subtareas en otra copia del mismo usuario.
- Borrado local de esa principal, restauración con Deshacer borrado y eliminación final enviada. Solo se creó/retiró la actividad `REV UI 09oct — rutina de prueba`; no se modificaron rutinas, comidas ni existencias habituales.
- Inspección de Agenda, recetario, Compras y Planificar a ancho móvil, y detalle/editor de comida. El horario del hijo se separó en una línea propia y «Sin enviar» dejó de competir con los botones por el ancho del nombre.
- Los paneles laterales se colocaron por encima de la barra de copia, navegación y captura rápida, para mantener accesible el cierre y los campos.
- Se reprodujo una pantalla antigua incapaz de abrir una copia con versión más reciente. Se conservó la copia al cargar la aplicación nueva; no se borró IndexedDB. El registro/actualización del service worker ahora se inicia sin depender de que abra la copia privada. Los errores distinguen pantalla antigua, almacenamiento no disponible y bloqueo por otra pestaña; el bloqueo deja de esperar indefinidamente y una apertura tardía cierra su conexión.
- Cinco comprobaciones unitarias adicionales de recuperación de almacenamiento correctas (`scripts/review-storage-recovery.cjs`). No usan datos ni red. No son pruebas de Safari.
- Compilación de producción y TypeScript correctos; Prisma informa que las 23 migraciones están aplicadas. No se ejecutaron resets ni migraciones destructivas.
- Documentación actualizada para separar alcance offline vigente de las restricciones históricas de consulta y publicación pendiente.

## Publicación y revisión posterior

El usuario autorizó publicar los bloques locales y estas correcciones después de verificar. La confirmación del despliegue se realiza sobre Vercel y el dominio estable; una compilación local no equivale a publicación.

La guía vigente para revisar en dispositivos es [PRUEBA_IPHONE.md](PRUEBA_IPHONE.md). Si una pestaña mantiene código antiguo, cerrar/reabrir con conexión; como recuperación sin borrar datos se puede abrir el dominio estable con `/inbox/` (barra final) para solicitar la pantalla actual. No cerrar sesión ni borrar almacenamiento si hay pendientes.

Quedan por comprobar en el iPhone del usuario: suspensión real de iOS, teclado y áreas seguras, reapertura en modo avión, almacenamiento bajo presión y el recorrido completo de envío entre dispositivos. La prueba de este bloque no repite toda la batería histórica de retención/carga ni demuestra ausencia de cualquier fallo.
