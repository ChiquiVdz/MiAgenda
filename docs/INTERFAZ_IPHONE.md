# Primera adaptación a iPhone

Implementación: 8 de octubre de 2026. Bloque de interfaz aprobado por el usuario, sin almacenamiento offline, instalación ni publicación todavía. PROJECT.md mantiene sus reglas.

## Cambios

- Hasta 680 px de ancho, navegación inferior con Inbox, Agenda y Menú, en ese orden. Cocina está en Menú, con Alacena, Recetas, Planificar y Compras; `/cocina/inicio` conserva los accesos agrupados. Menú conserva la navegación completa y, en Agenda, los controles de calendarios.
- Agenda abre inicialmente en Día en pantallas pequeñas. Se pueden elegir las demás vistas. En PC abre en Semana como antes; cambiar el ancho después no sustituye la vista que ya eligió el usuario.
- Planificar muestra una fecha y sus filas de comida como tarjetas. Flechas, selector y Hoy cambian el día; al salir del rango cargado se consulta su semana. Dentro del rango se reutiliza el snapshot, sin una consulta por cada cambio de día. PC mantiene la tabla de una o dos semanas. Las acciones de copiar/borrar siguen identificadas por semana.
- Las tarjetas de comida comparten los mismos controles y comandos en ambos tamaños. No hay un modelo de datos móvil separado.
- Formularios, cuadros, texto de campos y controles adaptados a pantalla pequeña. Safe areas y viewport visible para evitar que barras y teclado oculten controles. Navegación inferior y captura rápida se ocultan al detectar teclado abierto. No se desactiva el zoom del usuario.

## Cómo revisarlo

Por ahora puede verse en el navegador de PC reduciendo el ancho a menos de 680 px. Abrir Agenda de nuevo para comprobar su vista inicial Día.

1. Usar los tres accesos inferiores. En Menú, acceder a todos los apartados y a los calendarios de Agenda.
2. En Cocina, entrar a cada uno de los cuatro apartados.
3. En Planificar, cambiar de día con las flechas y el selector, cruzar domingo/lunes y volver con Hoy. Abrir una comida o una celda vacía; revisar porciones, horarios, selección de recetas, guardar/cancelar y cierre.
4. En Inbox y Recetas, desplegar contenido y comprobar que los campos y acciones caben. Probar captura rápida.
5. Ampliar el ancho: vuelve la navegación habitual y la tabla semanal de Planificar.

Compilación de producción y TypeScript correctos. Recorrido visual local a 390 × 844: Planificar por día y editor dentro de pantalla, sin guardar datos. Imagen de referencia en `docs/evidencia/planificar-iphone.jpg`.

## Pendiente

Safari y teclado en iPhone real, orientación horizontal y áreas seguras reales se revisan al habilitar acceso desde el dispositivo. La emulación de ancho no garantiza su comportamiento. Tampoco habilita PWA, uso sin conexión, sincronización diferida ni acceso fuera de localhost.

Siguiente bloque acordado: copia local para consulta e Inbox; publicación e instalación requieren sus propios pasos.

## Ajustes de densidad aprobados después

Semana móvil muestra tres días desde la fecha elegida; cada flecha desplaza un día. PC conserva sus siete días y avance semanal. La creación, arrastre y línea horaria utilizan los mismos días visibles. Mes cabe en siete columnas sin desplazamiento lateral; muestra dos eventos por fecha y permite ampliar el resto con scroll dentro de la celda para evitar filas indefinidamente altas. Año conserva su presentación.

Alacena reduce la altura visible del catálogo y compacta cantidades/acciones; seguimiento con lápiz y quitar con papelera, conservando nombres accesibles y las validaciones anteriores. Retirar receta usa papelera junto al nombre. Acciones semanales de Planificar en una línea con rótulos móviles «Copiar anterior» y «Borrar semana», manteniendo alcance y confirmación. Agregar artículo en Compras usa dos columnas compactas.
