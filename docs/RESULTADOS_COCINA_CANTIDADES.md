# Revisión de cantidades y disponibilidad de Cocina

Fecha: 8 de octubre de 2026. Revisión solicitada de los últimos cambios de Cocina, siguiendo PROJECT.md sin modificarlo.

## Resultado

**45 comprobaciones aprobadas**, con los servicios reales, Prisma, PostgreSQL y todas las migraciones aplicadas en un esquema temporal. Resultado reproducible en `reconstruction/core/recent-kitchen-verification.json`; verificador en `reconstruction/core/verify-recent-kitchen.ts`.

El esquema temporal se eliminó al terminar. Las recetas, comidas, existencias y compras reales no se modificaron. TypeScript de la aplicación y del núcleo finalizó sin errores.

## Casos comprobados

1. **Porciones y cantidades:** receta de tres porciones planificada para una; suma de usos repetidos antes de redondear piezas; grupos obligatorios/opcionales separados; gramos proporcionales; cantidades fraccionarias manuales persistidas. Cambiar porciones conserva ajustes manuales, volver al cálculo automático los retira y el recetario no cambia.
2. **Solo disponibilidad:** receta válida con ingredientes «al gusto» sin cantidades ficticias; faltantes agrupados por ingrediente; Tengo satisface varias comidas sin agotarse. Comprar y deshacer disponibilidad no genera movimientos numéricos. Un cambio manual posterior bloquea una reversión que lo sobrescribiría. Cambiar de modo registra existencias reales o conserva saldos históricos según corresponda; una versión antigua sin cantidad no inventa consumo al pasar a cantidad.
3. **Compras y consumo:** faltantes según cantidades elegidas y prioridad cronológica; compra mixta de ingredientes medidos y por disponibilidad; reintento sin duplicar; deshacer exacto. Opcionales seleccionados no disponibles bloquean el completado sin efectos parciales. Completar consume solo cantidades obligatorias y opcionales utilizados; deshacer devuelve esas mismas cantidades.
4. **Sobras y copia de semanas:** cocinar dos y comer una deja una porción real; comer esa sobra no vuelve a descontar ingredientes; deshacer su origen exige deshacer primero el consumo posterior. Copiar conserva versiones y cantidades elegidas, crea identidades pendientes y recalcula compras/reservas globales. Borrar la copia libera sus demandas sin alterar inventario; desactivar Cocinar elimina demandas incluso con ajustes manuales guardados.

También se comprobaron el aislamiento del esquema, el acceso de la cuenta ficticia y la ausencia de saldos negativos.

## Cantidad necesaria y cantidad elegida para comprar

Son valores diferentes. Tras deshacer una compra se conserva la cantidad elegida, aunque cambien los faltantes calculados. Las pruebas comprueban ambos valores por separado; no se sustituyó esa regla para hacer coincidir el campo editable con la necesidad calculada.

## Incidencias durante la verificación

- Se corrigió un dato incompleto del verificador: la API de recetas exige enviar `description: null`, aunque la interfaz no tenga campo de descripción.
- Se corrigió una expectativa del verificador que confundía cantidad necesaria y elegida en Compras.
- Una ejecución se interrumpió por cierre de conexión con Neon (`P1017`/`ECONNRESET`). Se identificó y eliminó su esquema aislado, y se repitió la revisión completa. El verificador ahora usa una conexión independiente para limpiar y registra el nombre del esquema por si una interrupción impide hacerlo.
- No se requirieron cambios funcionales, nuevas dependencias ni migraciones de la aplicación.

## Repetir la comprobación

Desde la raíz del proyecto, con el runtime Node 24 utilizado en esta revisión y la conexión del núcleo configurada:

```powershell
& 'C:/Users/emimt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --experimental-transform-types reconstruction/core/verify-recent-kitchen.ts
```

El comando crea y elimina su propio esquema de pruebas. La ejecución correcta muestra `DONE 45 comprobaciones` y `Esquema temporal eliminado`; el informe debe contener `failure: null` y `temporarySchemaRemoved: true`.

## Límites

Esta revisión técnica valida los cálculos, consultas, transacciones y restricciones de datos. La herramienta de navegador no pudo iniciarse durante ese bloque; la revisión visual se realizó después por el usuario, según la aceptación registrada abajo. No se realizaron pruebas de carga, uso sin conexión ni despliegue. La advertencia de pg sobre consultas concurrentes de cara a pg 9 sigue siendo la ya registrada en la revisión integral anterior.

## Aceptación visual del usuario · 2026-10-08

El usuario confirmó «muy bien todo de revisión visual» después de revisar Cocina. Se ajustó el editor lateral de Planificar: cantidades más pequeñas con unidad junto al campo, menos separación entre ingredientes, filtros sin relleno heredado y Quitar receta compacto. La compilación local terminó correctamente y la app volvió a abrirse en modo de producción local.

Esta aceptación cierra la revisión visual de Cocina en PC de este bloque. No afirma una auditoría visual automatizada ni comprobación de celular, accesibilidad o todos los gestos de Agenda.
