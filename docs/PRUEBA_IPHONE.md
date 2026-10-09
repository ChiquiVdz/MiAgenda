# Revisar MiAgenda en iPhone y PC

Actualizado: 9 de octubre de 2026. La aplicación ya tiene publicación HTTPS en https://mi-agenda-fawn.vercel.app. Google sirve solo para entrar. No necesitas App Store ni mantener encendida la PC para usar esa publicación.

## Preparar el iPhone

1. Abrir el enlace en Safari, fuera de navegación privada, con la cuenta autorizada.
2. Si no está instalada: Compartir → Agregar a Inicio. Abrir desde ese icono; puede pedir acceso y descargar su propia copia.
3. Para recibir código nuevo, cerrar y volver a abrir MiAgenda con internet. Cerrar también pestañas antiguas de la app. Si todavía aparece la versión anterior, volver a abrirla después de que termine la descarga de sus pantallas. No borrar los datos del sitio ni cerrar sesión si hay cambios sin enviar.
4. Pulsar **Actualizar**. Esperar contador cero y, en **Info**, «Pantallas listas para abrir sin conexión».

Actualizar envía tus cambios pendientes y después descarga los del servidor. Reconectar no envía automáticamente. Al entrar con internet puede comprobarse si hay novedades; navegar entre apartados reutiliza la copia descargada.

## Recorrido 1: tareas y horarios

Usar tareas nuevas con el prefijo PRUEBA IPHONE. No modificar rutinas habituales.

1. Con internet, crear una tarea en Inbox y agregar dos subtareas seguidas. Listo → Guardar las guarda juntas.
2. Usar el reloj junto al lápiz de la principal para agendarla hoy. En Agenda abrir su detalle, programar un hijo y comprobar que hereda el calendario. Su casilla sigue existiendo y se indica que está agendado.
3. Pulsar Actualizar. En PC abrir la misma cuenta y Actualizar: deben verse la tarea, sus hijos y horarios.
4. En iPhone activar modo avión y apagar también Wi-Fi. Crear otra tarea, editar su nombre, agregar hijos, completar uno, agendar la principal y cambiar su horario desde Editar.
5. Cerrar/reabrir desde el icono sin conexión. Deben conservarse nombres, horarios, marcas y contador pendiente.
6. Reconectar: el contador debe seguir pendiente. Pulsar Actualizar; debe llegar a cero. Actualizar en PC para comprobar lo mismo.

## Recorrido 2: series

Preparar conectada una serie nueva de prueba con tres subtareas y varias fechas. Actualizar antes de desconectarse.

1. Renombrar un hijo en una instancia y eliminar ese hijo en otra. Programar o cambiar su horario para **Esta y las siguientes**; la renombrada se reconoce y la eliminada no reaparece. Las anteriores no cambian; las completadas conservan su horario al cambiar horarios por alcance.
2. Agregar hijos para **Toda la serie**. Cerrar/reabrir y comprobar las fechas descargadas. El círculo rápido afecta solo a la instancia; Aplicar completado permite alcance explícito.
3. Borrar toda la serie de prueba. En **Borrados sin enviar**, deshacer: reaparecen las instancias y excepciones. Repetir y Actualizar si se quiere confirmar el borrado.
4. Con otra serie y cola vacía, revisar **Dejar de repetir y pasar a Inbox**. Conservar futuras modificadas está activo inicialmente. Cancelar no cambia nada; confirmar conserva la elegida y sus hijos, y sus hijos agendados siguen en Agenda. Actualizar confirma el cambio.

No usar la serie habitual para probar borrado o separación. El alcance de siguientes usa la fecha original de la repetición, aunque una instancia se haya movido.

## Recorrido 3: Cocina

Preparar conectadas una receta de prueba con ingrediente obligatorio, opcional y un tramo previo, y dos comidas: A cocina dos porciones y come una; B no cocina y come la restante. Cargar existencias suficientes y Actualizar.

1. Sin conexión, cambiar una cantidad en Alacena; registrar una compra en Compras y revisar que sume esa cantidad. Deshacerla y comprobar que se revierte.
2. Completar el tramo previo de A: marca sus pasos obligatorios en orden, sin consumir ingredientes ni completar la comida.
3. Completar A desde su círculo: elegir los opcionales usados. Debe descontar exactamente las cantidades planificadas una vez y generar una porción sobrante.
4. Completar B: usa la sobra sin otro descuento. Intentar deshacer A debe explicar que primero se deshace B.
5. Deshacer B y A devuelve el consumo registrado. Cerrar/reabrir mantiene existencias, marcas y pendientes.
6. Reconectar, Actualizar y revisar desde PC. No deben duplicarse compras ni consumos.

## Interfaz y límites

- Navegación inferior: Inbox, Agenda, Menú. Cocina está dentro de Menú.
- Semana móvil muestra tres días y cada flecha avanza un día; PC conserva siete. Mes no debe exigir desplazamiento lateral. Año muestra los doce meses.
- Planificar móvil muestra un día; PC una tabla semanal. Comprobar editor, teclado, cierre y botones sin quedar ocultos.
- Solo pueden consultarse sin internet fechas descargadas. Fuera del rango se ofrece descarga explícita.
- Crear/editar planes, cambiar frecuencia, calendarios, sustituir ingredientes y cambiar su seguimiento todavía requieren conexión y enviar pendientes primero.
- Si hay conflicto, los cambios siguen guardados hasta elegir una resolución. No borrar almacenamiento ni reinstalar como solución automática.
- El almacenamiento de Safari puede perderse al borrar datos o liberar espacio; la copia local no sustituye un respaldo.

## Evidencia y alcance de la revisión

La revisión automatizada reciente registró 139 comprobaciones correctas en servicios y cliente local real, con esquemas temporales y Chromium. Consultar [informe](REVISION_BLOQUES_LOCALES_2026-10-09.md). La revisión visual a ancho de iPhone no demuestra funcionamiento en Safari físico: este recorrido debe completarse en el dispositivo del usuario.

## Configuración del alojamiento existente

Vercel usa el repositorio MiAgenda, raíz del proyecto y el comando de vercel.json. No aplica migraciones automáticamente. Variables privadas: NEXTAUTH_URL (dominio estable HTTPS), NEXTAUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, MIAGENDA_CORE_DATABASE_URL (miagenda_core), MIAGENDA_ALLOWED_EMAILS y CRON_SECRET. No pegarlas en documentos ni chat. El callback de Google debe coincidir con el dominio más /api/auth/callback/google; conservar localhost para desarrollo y no pedir permisos de Calendar. El cron de retención se configura a las 09:00 UTC.
