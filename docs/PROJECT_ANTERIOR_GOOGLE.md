# Proyecto: Agenda personal integrada con Google Calendar + módulo de cocina

## 1. Objetivo general

Quiero desarrollar una aplicación personal de organización que utilice **Google Calendar como fuente principal para la información relacionada con fechas y horarios**, pero que tenga una interfaz propia y funcionalidades adicionales que Google Calendar no proporciona de la manera que necesito.

El primer y principal módulo adicional será el de **cocina / planificación de comidas**.

La aplicación NO debe intentar reemplazar Google Calendar. La idea es construir una capa de aplicación encima de Google Calendar que permita organizar y completar actividades de una manera más cómoda y personalizada.

---

# 2. Integración con Google Calendar

La aplicación debe conectarse con la cuenta de Google del usuario mediante las APIs oficiales de Google.

Debe poder:

- Leer eventos existentes de Google Calendar.
- Crear eventos desde la aplicación.
- Modificar eventos desde la aplicación.
- Eliminar eventos cuando corresponda.
- Detectar cambios realizados directamente desde Google Calendar.
- Mantener sincronizada la información entre Google Calendar y la aplicación.
- Respetar eventos recurrentes.
- Trabajar con eventos futuros, incluso si están programados con meses de anticipación.

Google Calendar debe encargarse principalmente de:

- Fechas.
- Horarios.
- Duración.
- Recurrencias.
- Eventos futuros.
- Información general del calendario.
- Sincronización entre dispositivos.

La aplicación debe encargarse principalmente de la lógica adicional y de la experiencia de usuario.

---

# 3. Interfaz propia de agenda

Ademas del calendario en general. Quiero una vista semanal similar a Google Calendar, pero diseñada alrededor de mi flujo de trabajo.

Los eventos deben mostrarse respetando su duración real.

Por ejemplo:

```text
3:00 PM ┌──────────────────────────┐
        │ ☐ Clase de Arquitectura  │
        │                          │
4:00 PM │                          │
        │                          │
5:00 PM └──────────────────────────┘
```

Quiero poder marcar elementos como completados mediante un checkbox.

La aplicación debe diferenciar entre:

- Evento de calendario.
- Actividad propia de la aplicación.
- Comida planificada.
- Otras actividades que posteriormente puedan agregarse.

Al marcar algo como completado, el evento **no se borra de inmediato**. Completar registra el estado en la app (`completed`, `completed_at`) y el evento sigue en Google Calendar.

**Retención (sin excepciones por tipo):** todo ítem completado (clase, tarea, comida, etc.) permanece **5 días desde que se completa**. No se purgan eventos futuros antes de que terminen. Luego se **borra** de Calendar y de la app, **salvo** que el usuario indique lo contrario.

Conservar no es un tipo distinto al crear el evento. Por ahora: un **botón dentro de la tarea/evento** (p. ej. “Conservar”) para que no entre en el borrado automático. Si no se pulsa, se borra al vencer el plazo.

Motivo: no guardar toda la vida del usuario, y poder **deshacer un completado** dentro de esa ventana. En comidas, deshacer debe **devolver los ingredientes a la alacena** (la inversa de descontar).

```text
Google Calendar:
Clase de Arquitectura
3:00–5:00 PM  (sigue existiendo hasta que expire o se borre)

Base de datos:
completed = true
completed_at = fecha/hora
keep = false | true   // true si el usuario pulsó Conservar
```

---

# 4. Módulo de cocina

El primer módulo especializado debe ser para organizar alimentación y cocina.

Debe existir un **área propia de Cocina** (navegación aparte de la agenda semanal), donde **sí o sí** el contexto es solo alimentación: alacena, recetas, sugerencias, planificar/agregar comidas y lista de compras. Ahí viven esas funciones; no se entierran solo como filtros del calendario general.

La agenda semanal sigue mostrando comidas como eventos (junto con el resto) cuando esos calendarios estén visibles.

## Alacena / inventario

El usuario debe poder registrar ingredientes y cantidades.

Ejemplo:

```text
Pasta       500 g
Tomate      4 piezas
Queso       200 g
Pollo       600 g
Arroz       1 kg
```

Debe ser posible:

- Agregar ingredientes.
- Modificar cantidades.
- Eliminar ingredientes.
- Consultar cantidades disponibles.
- Registrar unidades **fijas** para la lógica (g, kg, ml, piezas, etc.).
- Mantener actualizado el inventario.
- Elegir ingredientes de un catálogo compartido y buscable. Los ingredientes agregados por el usuario quedan privados para su cuenta.
- Las equivalencias humanas de cantidades (p. ej. `45 g (2 cucharadas)`) se muestran en recetas; no se guardan como propiedad del stock de alacena.

---

# 5. Recetas

Debe existir un sistema de recetas.

Cada receta debe tener:

- Nombre.
- Ingredientes.
- Cantidades necesarias. por porcion
- Porciones.
- Instrucciones.

Ejemplo:

```text
Pasta con tomate

2 porciones

200 g pasta
2 tomates
100 g queso
```

---

# 6. Sugerencias de recetas

La aplicación debe poder analizar lo que existe actualmente en la alacena y sugerir recetas.

Debe priorizar recetas cuyos ingredientes estén disponibles.

También quiero permitir recetas en las que falten pocos ingredientes.

Por ejemplo:

```text
Pasta con tomate

Tienes:
✓ Pasta
✓ Tomate

Falta:
✗ Queso
```

La aplicación puede permitir la receta si faltan como máximo una cantidad configurable de ingredientes; inicialmente puede utilizarse un límite de 3 ingredientes faltantes.

Esto debe ser configurable para poder modificarlo posteriormente.

---

# 7. Planificador de comidas

Debe existir un calendario o planificador de comidas.
Las comidas planificadas deben verse también en Google Calendar y en la vista de agenda de la app.

**Dos superficies (no elegir solo una):**

1. **Agenda / semana:** como Google — calendarios a un lado para encender/apagar capas (Comidas, general, otros) y ver el día mezclado.
2. **Módulo Cocina (aparte):** pantalla(s) donde solo aparece el flujo de alimentación y **todas** sus funciones: sugerir, alacena, lista de compras, planear y agregar. No es un filtro del grid; es el lugar de trabajo de cocina.

Opcional: en la agenda, un atajo “solo comidas” que apaga las otras capas. Eso no sustituye el módulo Cocina.

El usuario debe poder seleccionar:

```text
Receta: Pasta con tomate
Fecha: Viernes
Hora: 2:00 PM
Porciones: 2
```

Cuando se planifique una comida, la aplicación debe crear un evento correspondiente en Google Calendar.

Ejemplo:

```text
Google Calendar

Viernes
2:00–2:45 PM
🍝 Pasta con tomate
```

Duración de comidas:

- Defecto: **45 minutos**.
- Cada receta puede definir su propia duración.
- Cada usuario puede **ajustar esa duración de forma personal** (p. ej. tiempo extra para comer y/o lavar).

El evento en Google Calendar debe usar esa duración efectiva.

La aplicación debe almacenar la relación entre el evento de Google Calendar y la comida planificada.

Por ejemplo:

```text
google_event_id
meal_plan_id
recipe_id
```

No quiero depender únicamente del nombre del evento para identificar la relación.

---

# 8. Completar una comida

Cuando el usuario marque una comida como completada desde la aplicación:

```text
☐ Pasta con tomate

        ↓

☑ Pasta con tomate
```

deben ocurrir las siguientes acciones:

1. Marcar la comida como completada.
2. Identificar la receta utilizada.
3. Identificar las porciones preparadas.
4. Calcular los ingredientes utilizados.
5. Restar esos ingredientes de la alacena.
6. Actualizar el inventario.
7. Mantener el evento correspondiente en Google Calendar (no borrar al completar).
8. Registrar el historial de la operación (qué se descontó), para poder **deshacer**.

Deshacer un completado (dentro de la ventana de retención): revertir `completed`, **sumar de nuevo** a la alacena exactamente lo descontado, y no dejar el inventario inconsistente. El evento sigue hasta que expire el plazo o el usuario lo borre/conserve según las reglas de retención.

Ejemplo:

Antes:

```text
Pasta       500 g
Tomate      4 piezas
Queso       200 g
```

Después de preparar 2 porciones:

```text
Pasta       300 g
Tomate      2 piezas
Queso       100 g
```

---

# 9. Lista de compras

Cuando una receta sea planificada y no exista suficiente inventario, la aplicación debe poder calcular qué ingredientes faltan.

Ejemplo:

```text
Receta necesita:

Pasta       200 g
Tomate      2
Queso       150 g

Alacena:

Pasta       500 g
Tomate      3
Queso        40 g
```

La aplicación debería generar:

```text
Lista de compras

☐ Queso — 110 g
```

La lista de compras debe poder marcarse como completada.

Cuando corresponda, comprar un ingrediente debería permitir aumentar la cantidad disponible en la alacena.

---

# 10. Integridad de los datos

Este punto es importante.

La aplicación debe evitar situaciones como:

- Restar dos veces los ingredientes por marcar una comida dos veces.
- Descontar ingredientes incorrectos.
- Crear dos eventos de Google para la misma comida accidentalmente.
- Perder la relación entre una comida y su evento de Calendar.
- Sobrescribir cambios realizados directamente en Google Calendar.
- Crear cantidades negativas en la alacena.
- Completar una comida sin registrar correctamente sus ingredientes utilizados.
- Deshacer un completado sin devolver exactamente lo descontado (o devolverlo dos veces).
- Borrar por retención un evento que el usuario marcó Conservar.
- Borrar de inmediato al completar (eso rompe el deshacer).

La lógica de completar y de deshacer una comida debe ser segura e idealmente transaccional.

---

# 11. Sincronización

La aplicación debe considerar que el usuario puede modificar un evento desde:

```text
Google Calendar
        ↓
o
Tu aplicación
```

Por lo tanto, debe existir una estrategia de sincronización.

Ejemplo:

Si desde Google Calendar cambio:

```text
Viernes 2:00 PM
```

a:

```text
Viernes 3:00 PM
```

la aplicación debe detectar el cambio y actualizar su representación.

Igualmente, si modifico la comida desde la aplicación, el cambio debe reflejarse en Google Calendar.

La implementación debe considerar sincronización incremental, identificadores únicos y conflictos de edición.

---

# 12. Qué debe permanecer en Google y qué debe permanecer en mi aplicación

Quiero mantener una separación clara.

## Google Calendar

Debe ser responsable principalmente de:

- Eventos.
- Fechas.
- Horarios.
- Duraciones.
- Recurrencias.
- Información futura.
- Sincronización del calendario.

## Base de datos propia

Debe ser responsable principalmente de:

- Recetas.
- Ingredientes.
- Alacena.
- Cantidades.
- Comidas planificadas.
- Relación receta ↔ comida.
- Relación comida ↔ evento de Google.
- Estado de completado.
- Historial.
- Lista de compras.
- Lógica de negocio.

No quiero almacenar toda la lógica de la aplicación dentro de Google Calendar.

---

# 13. Aplicación móvil / widget

Desde el inicio quiero considerar que la aplicación también se utilizará desde el celular.

Una de las funciones importantes debe ser poder consultar rápidamente:

```text
¿Qué me toca hoy?
```

y poder marcar una actividad como completada sin tener que navegar por toda la aplicación.

Idealmente debería existir un widget móvil que muestre actividades próximas o del día.

Ejemplo:

```text
MI DÍA

12:00 🍝 Pasta con tomate
      ☐

3:00  🏫 Arquitectura
      ☐

6:00  🏋️ Gimnasio
      ☐
```

Al tocar el checkbox desde el widget, debe ejecutarse la misma lógica que si se completara desde la aplicación.

En el caso de una comida:

```text
Widget
   ↓
Marcar comida completada
   ↓
Backend
   ↓
Actualizar comida
   ↓
Restar ingredientes
   ↓
Actualizar alacena
```

La arquitectura debe diseñarse desde el principio para permitir este tipo de cliente móvil (API usable desde web y luego desde nativo/widget). **No hace falta decidir ahora Android vs iPhone.** El MVP es **web primero**. El widget es fase posterior; la plataforma nativa se elige entonces (un widget nativo no es el mismo código en ambos).

---

# 14. Arquitectura

Antes de implementar, quiero que analices cuál sería una arquitectura adecuada.

Como mínimo quiero separar:

```text
Frontend
    ↓
Backend / API
    ↓
Base de datos

Backend
    ↕
Google Calendar API
```

Quiero que evalúes tecnologías apropiadas .

No quiero elegir tecnologías únicamente porque sean populares.

Quiero que consideres:

- Facilidad de desarrollo.
- Escalabilidad.
- Mantenibilidad.
- Seguridad.
- OAuth con Google.
- Integración con APIs.
- Base de datos.
- Desarrollo móvil/widget.
- Gratis
- Facilidad para desplegar.
- Valor como proyecto de portafolio.
- Lo mas probable o por mucho tiempo solo sea yo o maximo 2 usuarios

---

# 15. Seguridad

La aplicación debe utilizar correctamente OAuth para Google.

No se deben almacenar contraseñas de Google.

Los tokens y credenciales deben manejarse de forma segura.

También quiero que analices:

- Manejo de access tokens.
- Refresh tokens.
- Scopes mínimos necesarios.
- Protección de endpoints.
- Autenticación de usuarios.
- Variables de entorno.
- Protección de datos sensibles.

---

# 16. Desarrollo por fases

No quiero intentar construir todo de una sola vez.

Propón un desarrollo por fases.

Por ejemplo:

### Fase 1

- Proyecto base.
- Autenticación.
- OAuth con Google.
- Lectura de Calendar.

### Fase 2

- Vista semanal.
- Eventos como bloques.
- Checkbox propio.
- Estado de completado.

### Fase 3

- Recetas.
- Ingredientes.
- Alacena.

### Fase 4

- Planificador de comidas.
- Creación automática de eventos en Google Calendar.

### Fase 5

- Descontar ingredientes al completar comidas.

### Fase 6

- Lista de compras.

### Fase 7

- Sincronización avanzada.

### Fase 8

- Aplicación móvil / widget.

Pero modifica este orden si técnicamente existe una mejor estrategia.
Que pueda por lo menos empezar agregar tareas en 1 semana

---

# 17. Antes de programar

Antes de escribir código quiero que hagas un análisis técnico del proyecto.

Identifica:

1. Requisitos funcionales.
2. Requisitos no funcionales.
3. Entidades principales.
4. Relaciones entre entidades.
5. Arquitectura recomendada.
6. Flujo de autenticación con Google.
7. Flujo de sincronización.
8. Modelo de base de datos.
9. API endpoints necesarios.
10. Posibles problemas de sincronización.
11. Problemas de concurrencia.
12. Casos límite.
13. Riesgos de seguridad.
14. Qué debería vivir en Google y qué debería vivir en nuestra BD.
15. Qué debe formar parte del MVP.
16. Qué debería dejarse para fases posteriores.

No empieces directamente a generar toda la aplicación.

Primero quiero que diseñemos correctamente la arquitectura y el modelo de datos para evitar tener que rehacer el proyecto después.

El objetivo es construir una aplicación real, mantenible y ampliable, pero comenzar con un MVP razonable.

Preguntame otras consideraciones que debas saber que creas necesarias

---

# 18. Decisiones acordadas (2026-09-30)

Estas decisiones actualizan y precisan el resto del documento. Si hay conflicto, gana esta sección hasta que se cambie de nuevo.

- **Retención:** completar **nunca** borra de inmediato. **Todo**, sin excepción por tipo, permanece **5 días desde que se completa** y luego se borra de Calendar y de la app. Los eventos futuros no se purgan antes de terminar; Conservar los exime. Conservar = botón (por ahora) **dentro** de la tarea/evento; no hay tipo “nace persistente” vs “nace efímera”.
- **Deshacer:** dentro de esa ventana se puede deshacer un completado. En comidas, los ingredientes **regresan a la alacena** usando el historial de lo descontado.
- **Clientes:** web primero. Widget / nativo después. No bloquear Android vs iPhone ahora. API agnóstica al cliente.
- **Usuarios:** cada persona conecta **su propia cuenta de Google**. Uso real: principalmente Emilio; permitir más de un usuario sin producto multi-tenant complejo.
- **Navegación:** **Agenda** (grid + capas tipo Google) **y** **módulo Cocina aparte** (solo cocina: sugerir, alacena, lista, planear, agregar). El toggle de calendarios no sustituye el módulo. Atajo “solo comidas” en la agenda es opcional.
- **Idioma UI:** español o inglés; no bloqueante.
- **Hosting / costo:** sin proveedor fijo; **preferir gratis** (1–2 usuarios).
- **Velocidad:** más rápido si se puede; sin saltarse integridad ni OAuth.
- **Duración de comidas:** 45 min por defecto; override por receta; override personal (comer / lavar).
- **Unidades:** fijas para inventario; la equivalencia en cucharadas/pizcas es descriptiva por cantidad de receta, nunca una unidad de stock adicional.
- **Catálogo de ingredientes:** usar un catálogo común de ingredientes frecuentes, seleccionable/buscable desde alacena y recetas. Los ingredientes personalizados quedan privados por cuenta. Alacena y recetas referencian el mismo ID; el inventario pertenece a cada usuario. Normalizar nombres (mayúsculas, espacios y acentos) para evitar duplicados accidentales. La cantidad equivalente pertenece a cada ingrediente de receta (p. ej. `45 g (2 cucharadas)`), no al inventario de alacena. Acordado 2026-10-01.
- **Nombre:** MiAgenda por ahora.
- **Recurrencia:** el job de retención **no borra masters recurrentes** en Google. Solo instancias terminadas, después de cumplirse la ventana fija de 5 días desde que se completaron y sin Conservar. Eventos futuros no se purgan. Confirmado 2026-09-30.

---

# 19. Análisis técnico (acordado para diseñar; aún no es código)

Fecha: 2026-09-30. Si hay conflicto con secciones 1–17, ganan las 18 y 19. Stack e implementación MVP **aprobados**; la excepción de series recurrentes **confirmada**.

## 19.1 Requisitos funcionales (resumen)

- Login con Google (OAuth). Cada usuario ve solo su Calendar y sus datos.
- Leer calendarios y eventos (incl. futuros y recurrentes).
- Vista semanal con bloques por duración real; capas on/off.
- Crear / editar / borrar eventos desde la app (reflejado en Google).
- Completar / deshacer completar sin borrar de inmediato.
- Conservar (botón en el ítem) para eximir del borrado automático.
- Job de retención: borrar cuando hayan pasado **5 días desde `completed_at`** y el evento haya terminado, si `keep = false`.
- Módulo Cocina (fase posterior al MVP de agenda): recetas, alacena, sugerencias, planificar comida (crea evento), lista de compras, descuento/reposición transaccional.

## 19.2 Requisitos no funcionales

- 1–2 usuarios; costo ~0.
- Web primero; API usable luego por widget.
- Tokens Google nunca en el frontend; refresh cifrado en servidor.
- Idempotencia al completar/deshacer comidas.
- Sync que no pise cambios hechos en Google (etag / `updated`).
- Tiempo de desarrollo: poder crear tareas en ~1 semana.

## 19.3 / 19.4 Entidades y relaciones

Google **no** es la base de recetas ni de `completed`. Nuestra BD guarda **overlay** + cocina.

- `User` 1—* `CalendarSubscription` (qué calendarios de Google usa, color, visible)
- `User` 1—* `EventOverlay` (clave: `google_calendar_id` + `google_event_id`; `completed`, `keep`, `kind`)
- `Ingredient` es catálogo común + personalizados por usuario; `User` 1—* `PantryItem` (cantidad propia en unidad canónica). Alacena y `RecipeIngredient` referencian el mismo ID.
- `User` 1—* `Recipe` 1—* `RecipeIngredient`
- `Recipe` 1—* `MealPlan` — `google_event_id` obligatorio cuando hay evento; `servings`; duración efectiva
- `MealPlan` 1—* `InventoryLedger` (movimientos; el deshacer revierte el ledger, no “adivina”)
- `User` 1—* `ShoppingList` 1—* `ShoppingListItem`
- `RecipeIngredient` guarda cantidad/unidad fija y una equivalencia descriptiva opcional por receta (p. ej. `45 g (2 cucharadas)`); nunca es otra cantidad de inventario.

Un evento de Google **puede no** tener overlay hasta que el usuario complete, conserve o sea comida nuestra.

## 19.5 Arquitectura y stack recomendados

Para 1–2 usuarios, gratis, OAuth, y MVP en una semana: **una sola app full-stack**, no microservicios.

```text
Navegador (Next.js)
    ↓ HTTPS sesión
Route Handlers / API
    ↓ Prisma
PostgreSQL
    ↕ googleapis
Google Calendar + OAuth
```

| Pieza | Elección | Por qué |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | Web + API juntas; despliegue simple; portafolio claro |
| Auth | **Auth.js** Google provider | OAuth estándar; sesión en cookie httpOnly |
| Calendar | **googleapis** Calendar v3 | API oficial |
| BD | **PostgreSQL** (Neon o equivalente free) | Transacciones (comidas); más sólido que SQLite si luego hay un segundo cliente |
| ORM | **Prisma** | Modelo explícito, migraciones |
| Host | **Vercel** (app) + Neon (BD) | Free tier típico para este tamaño |
| Jobs | Cron de Vercel o similar | Retención fija de 5 días desde completar + sync periódico |

Rechazado para el MVP: app nativa, Firebase como fuente de verdad de eventos, guardar toda la lógica en descripción de Calendar, SQLite embebido como único store (más frágil al desplegar).

## 19.6 Flujo de autenticación Google

1. Usuario pulsa “Continuar con Google”.
2. Consentimiento con **scopes mínimos**: `openid email profile` + `https://www.googleapis.com/auth/calendar` (leer/escribir eventos y poder tener calendario Comidas). No hay scope más pequeño que cubra CRUD + varios calendarios de forma limpia.
3. Auth.js guarda sesión; el **refresh token** se guarda **solo en servidor**, cifrado con un secreto de entorno.
4. Access token de corta vida se refresca en backend. Nunca se manda el refresh al cliente.
5. Si Google revoca, la app pide re-login; no se inventa acceso.

## 19.7 Flujo de sincronización

- Fuente de **tiempo**: Google (start, end, recurrence, title, calendarId).
- Fuente de **app**: overlay + cocina.
- Por calendario: `syncToken` (incremental). Si Google responde 410, resync completo de una ventana (p. ej. pasado reciente + futuro).
- Al abrir la semana: sync de esa ventana (MVP). Después: webhook `watch` (fase 7).
- Escritura app → Google primero (o en la misma petición); guardar `google_event_id` y etag. Si Google falla, no dejar comida “planificada” huérfana.
- Escritura Google → app: al sync, actualizar vista; **no** borrar `completed`/`keep`/`meal_plan` salvo que el evento ya no exista.
- Recurrencia: respetar `recurringEventId` e instancias; el overlay de completado es **por instancia**, no por la serie.

## 19.8 Modelo de datos (campos clave)

- `users`: id, google_sub, email, encrypted_refresh_token, created_at. La retención es fija en 5 días, no una preferencia del usuario.
- `ingredients`: catálogo global frecuente o personalizado/privado; `normalized_name` evita duplicados por formato. `pantry_items`: `user_id`, `ingredient_id`, `quantity` en unidad fija. Equivalencias descriptivas se guardan por ingrediente de receta, no como stock.
- `calendar_subscriptions`: user_id, google_calendar_id, summary_snapshot, selected (bool), is_meals (bool)
- `event_overlays`: user_id, google_calendar_id, google_event_id, recurring_event_id nullable, completed_at nullable, keep bool, kind enum (`plain`, `app_task`, `meal`), purge_after timestamptz
- `meal_plans`: id, user_id, recipe_id, overlay/event keys, servings, duration_minutes, completed_at, undoable until
- `inventory_ledger`: meal_plan_id, ingredient_id, delta (negativo al completar, positivo al deshacer), unit
- Recetas, pantry y shopping se aíslan por `user_id`; las recetas y pantry enlazan a la identidad de `ingredients`.

Índice único: `(user_id, google_calendar_id, google_event_id)` en overlay.

## 19.9 API (MVP primero; cocina después)

Autenticadas (sesión).

Agenda MVP:

- `GET /api/calendars` list + selected
- `PATCH /api/calendars/:id` selected on/off
- `GET /api/events?from=&to=` (merge Google + overlay)
- `POST /api/events` crea en Google
- `PATCH /api/events/:id`
- `DELETE /api/events/:id`
- `POST /api/events/:id/complete` y `/uncomplete`
- `POST /api/events/:id/keep`

Cocina (fases 3–6):

- CRUD `/api/ingredients`, `/api/pantry`, `/api/recipes`
- `GET /api/recipes/suggestions`
- `POST /api/meals` (crea evento Google + meal_plan)
- `POST /api/meals/:id/complete` | `/uncomplete`
- `/api/shopping-lists` …

## 19.10 Problemas de sync

- Token incremental inválido → full sync.
- Evento editado en Google mientras la app tenía un formulario abierto → usar etag; si choca, recargar, no overwrite ciego.
- Comida ligada a un event_id que el usuario borró en Google → meal_plan huérfano: marcar `event_missing`, no descontar dos veces.
- Recurrencia + completar el martes no debe completar todos los martes.
- All-day vs timed (zona horaria del usuario).

## 19.11 Concurrencia

- Completar comida: transacción: bloquear `meal_plan` + filas de pantry; si ya `completed_at` no nulo → no-op o 409.
- Deshacer: solo si existe ledger de esa comida y no se ha purgado.
- Dos pestañas: misma idempotencia.
- Purge job y uncomplete a la vez: el job no borra si `keep` o si `completed_at` reciente según regla; usar `purge_after` calculado.

## 19.12 Casos límite

- Evento futuro: **no se purga** aunque keep=false. Se elimina cuando ya terminó y también venció la ventana de 5 días desde su completado.
- Series recurrentes (clases): **no borrar la serie entera** en el job. Purgar solo instancias terminadas que ya cumplieron la ventana fija de 5 días desde completarse. (Excepción técnica a “borrar todo”; si no, se pierde el semestre.)
- Completar antes de la hora: overlay completed; el plazo de 5 días corre desde el completado, pero el evento no se purga mientras siga en el futuro.
- Inventario insuficiente al completar: permitir completar pero registrar faltante, o bloquear — **propuesta MVP cocina: bloquear o avisar y dejar cantidad en 0, nunca negativo**.
- Receta con 0 g “pizca”: la equivalencia no mueve stock distinto.

## 19.13 Seguridad

- Refresh tokens cifrados; `.env` nunca en git.
- CSRF en mutaciones (Auth.js); CORS cerrado.
- Autorización: todo filtrado por `user_id` de la sesión (no IDs ajenos).
- Scopes: no Drive, no Gmail.
- Rate limit básico en complete/purge.
- No loguear tokens ni cuerpos de OAuth.

## 19.14 Google vs BD

Google: start/end, título, location, recurrence, calendario, attendees si los hubiera.

BD: usuario, tokens, selected calendars, completed, keep, purge_after, recetas, pantry, ledger, meal_plan ↔ event_id, shopping, equivalencias.

## 19.15 MVP (~1 semana: agregar tareas)

1. Proyecto Next.js + Prisma + Postgres + Auth Google.
2. Listar calendarios y vista semanal (bloques).
3. Crear / editar tarea-evento.
4. Completar / deshacer.
5. Botón Conservar.
6. Sync al cargar la semana (sin webhooks todavía).

Fuera del MVP de 1 semana: cocina completa, lista de compras, sugerencias, widget, watch de Google, purge job pulido (se puede un cron mínimo al final de la semana si da tiempo).

## 19.16 Después

Fases 3–8 del doc original: recetas/alacena → planificador → descuento transaccional → shopping → sync avanzado → móvil/widget.

## 19.17 Excepción técnica (confirmar)

El job **no elimina masters recurrentes** en Google. Solo instancias terminadas que ya cumplieron la ventana de 5 días desde completarse, si no hay Conservar. Conservar en una instancia no tiene que conservar la serie; Conservar serie = botón en el evento maestro (fase posterior si hace falta).

