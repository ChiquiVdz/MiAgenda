# Referencia recuperable anterior al retiro de Google Calendar

Creada el 2026-10-06, antes de modificar el código de este bloque.

- `before-calendar-removal.zip`: 287 archivos de código, esquemas, migraciones, herramientas, pruebas antiguas, documentos y configuración pública.
- SHA-256: `CCD58B5635E041B35A4A7DE33869D331B0EE78A2BA18511D4EF04459ED6AA91F`.
- `files.txt`: inventario de la copia.
- `source-removal.json`: archivos retirados y piezas conservadas según sus dependencias desde las páginas, rutas y declaraciones activas.
- `retired-tools.txt`: esquema/migraciones antiguos y herramientas/pruebas retiradas.

La copia excluye credenciales, `.env.local`, clientes generados, `node_modules`, `.next` y Git. No contiene una copia de PostgreSQL: ambas bases existentes permanecen intactas.

## Recuperar una referencia

Extraer el ZIP a una carpeta separada y consultar los archivos necesarios. No extraer encima de la app actual: sustituiría el núcleo activo por el diseño anterior. Los clientes de Prisma pueden regenerarse desde sus respectivos esquemas. Las credenciales locales no se han borrado, pero no se incluyen en esta copia ni deben subirse a Git.

Este archivo es histórico. `PROJECT.md` sigue siendo el contrato de la app actual.
