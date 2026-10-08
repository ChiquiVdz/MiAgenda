# Prueba real en iPhone

Estado: preparación local realizada; publicación y comprobación en el dispositivo pendientes. No existe todavía un enlace de esta versión en internet.

## Qué está preparado

- Manifiesto instalable, nombre MiAgenda, iconos 192/512 y Apple 180, apertura independiente desde Inicio.
- Copia de consulta y pantallas descargadas, sin guardar autenticación ni HTML privado en el service worker.
- Vercel genera el cliente Prisma antes de compilar. No ejecuta migraciones ni borra datos al publicar.
- Prueba personal con correos autorizados mediante `MIAGENDA_ALLOWED_EMAILS`. En Vercel la configuración es obligatoria; Google debe proporcionar un correo verificado incluido en la lista. Esto restringe los nuevos accesos, no revoca sesiones emitidas antes de cambiar la lista.
- URL estable HTTPS; Google sigue siendo solo inicio de sesión.

## Publicar la prueba en Vercel

1. Iniciar sesión en Vercel y crear/importar MiAgenda desde GitHub, o publicar el directorio actual con la CLI autorizada. Si se importa GitHub, comprobar que la rama contiene la reconstrucción actual: importar una versión antigua no publica estos cambios locales.
2. Framework Next.js, raíz del repositorio, instalación `npm ci`, compilación definida por `vercel.json`: `npm run db:generate && npm run build`. Elegir una versión de Node mantenida compatible con `package.json` (22 o 24), sin versiones experimentales.
3. Elegir el dominio estable asignado al proyecto, por ejemplo `https://NOMBRE.vercel.app`. El nombre real lo proporciona Vercel; no usar una URL temporal diferente en cada publicación.
4. Configurar las siguientes variables **en el servidor**, sin prefijo `NEXT_PUBLIC_`, para el entorno Production de esta prueba:

| Variable | Valor / procedencia |
|---|---|
| `NEXTAUTH_URL` | URL HTTPS estable del proyecto, sin `/inbox` ni `/login` |
| `NEXTAUTH_SECRET` | Secreto aleatorio propio del despliegue; no pegar en chat/Git |
| `AUTH_GOOGLE_ID` | ID del cliente web de Google actual, o uno exclusivo para la prueba |
| `AUTH_GOOGLE_SECRET` | Secreto del mismo cliente web |
| `MIAGENDA_CORE_DATABASE_URL` | Conexión Neon a **miagenda_core**; copiar de `reconstruction/core/.env.local` al campo privado de Vercel |
| `MIAGENDA_ALLOWED_EMAILS` | Tu correo de Google; varios separados por coma si se autorizan más usuarios |
| `CRON_SECRET` | Secreto aleatorio propio para autorizar limpieza automática |

5. En Google Cloud → Google Auth Platform → Clients (o APIs y servicios → Credenciales), editar el cliente OAuth web que corresponde al ID configurado. **Añadir**, conservando localhost:
   - Origen JavaScript autorizado: `https://NOMBRE.vercel.app`.
   - URI de redirección autorizada: `https://NOMBRE.vercel.app/api/auth/callback/google`.
   - Si la audiencia está en Testing, incluir la cuenta entre los usuarios de prueba cuando corresponda. No añadir permisos de Calendar.
6. Publicar/republicar después de configurar las variables. No habilitar publicaciones Preview contra la base diaria sin una separación acordada. Este primer ensayo usa deliberadamente la misma cuenta y base actual: guardar o borrar desde el iPhone afecta a los datos visibles en PC después de actualizar su copia.
7. Comprobar el acceso autorizado, rechazo de una cuenta no incluida y que las API sin sesión no devuelven datos. La URL de la pantalla de acceso es visible en internet; los datos requieren sesión. El cron existente está programado una vez al día a las 09:00 UTC y usa `CRON_SECRET`.

No se requiere App Store ni descargar un archivo de instalación. Tampoco mantener encendida la PC. La primera descarga y las operaciones conectadas sí requieren que el alojamiento y Neon respondan.

## En tu iPhone, cuando tengas el enlace

1. Abrir el enlace HTTPS **en Safari**, fuera de navegación privada.
2. Iniciar sesión con la misma cuenta Google que usas en PC. Esperar a que la copia termine de descargarse.
3. Compartir → **Agregar a Inicio**. Si aparece **Abrir como app web**, dejarlo activado. Nombre MiAgenda → Agregar. Si la acción no aparece, buscarla en Editar acciones.
4. Abrir MiAgenda desde su icono. Puede necesitar iniciar sesión y descargar la copia de nuevo: no asumir que la instalación comparte la sesión/almacenamiento de la pestaña Safari.
5. En Info, esperar **Pantallas listas para abrir sin conexión**. Entrar a Inbox, Agenda y Cocina; comprobar que se ven tus datos y que los controles caben sin desplazamiento horizontal inesperado.
6. Con conexión, crear un pendiente de prueba; en PC pulsar Actualizar copia y comprobar que aparece. Eliminar solo el pendiente creado para este ensayo.
7. Cerrar la app, activar modo avión y apagar también Wi-Fi. Abrir desde el icono: debe mostrar la última copia. Recorrer Inbox, Agenda, Alacena, Recetas, Planificar y Compras dentro de las fechas descargadas.
8. Sin conexión, guardar/completar todavía no está habilitado. No hay cola de cambios en este bloque. Las fechas sin descargar muestran el aviso correspondiente.
9. Reconectar. No debe descargarse una copia completa automáticamente. Una nueva entrada puede consultar si hubo novedades y ofrecer actualizar; **Actualizar copia** descarga los datos.

No cerrar sesión para probar el modo avión: cerrar sesión borra la copia privada. El almacenamiento local puede perderse si borras los datos de Safari o el sistema libera espacio; no sustituye el respaldo de la base.

## Qué falta para dar la prueba por terminada

Comprobaciones locales realizadas: generación de Prisma sin conexión a la base, compilación Next.js y TypeScript correctas, manifiesto servido con `display: standalone`, enlace Apple presente y tres iconos públicos con respuesta HTTP 200. Se revisaron las trazas de la compilación sin encontrar archivos `.env` incluidos. No se ejecutaron migraciones ni se modificaron actividades para estas comprobaciones. Vercel mostró su pantalla de inicio de sesión; no se creó ni publicó un proyecto.

- Crear o vincular el proyecto Vercel y obtener su URL real.
- Configurar variables y callback OAuth; publicar y revisar esa publicación.
- Recorrer los pasos anteriores en un iPhone real (la vista estrecha de la PC no verifica Safari).
- Anotar modelo/iOS, paso que falla y captura si aparece un error, sin compartir secretos.

Fuentes: [Apple: convertir un sitio en app desde Safari](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios), [Vercel: configuración de compilación](https://vercel.com/docs/builds/configure-a-build), [variables](https://vercel.com/docs/environment-variables), [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Google OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server). La implementación sigue las guías incluidas con la versión de Next.js instalada.
