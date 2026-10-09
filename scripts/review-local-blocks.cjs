// Authorized review only. Application sources are loaded unchanged. All database
// fixtures live in a random schema that is removed in finally; no public data is mutated.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { registerHooks } = require('node:module');
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      for (const ext of ['.ts', '.tsx']) try { return next(specifier + ext, context); } catch {}
    }
    throw error;
  }
} });
const root = path.resolve(__dirname, '..');
const only = process.env.REVIEW_GROUP;
const reportPath = path.join(root, only === 'kitchen' ? 'docs/revision-cocina-local-2026-10-09.json' : only === 'uncertain' ? 'docs/revision-envio-local-2026-10-09.json' : 'docs/revision-bloques-locales-2026-10-09.json');
const report = { at: new Date().toISOString(), checks: [], failures: [], environment: 'Chromium aislado, IndexedDB/Web Locks reales; servicios y migraciones reales en esquema temporal', publicFixtures: 0, temporarySchemaRemoved: false, limits: ['No comprueba Safari/iPhone real ni los componentes visuales de React.', 'Las rutas HTTP del banco de pruebas delegan en los servicios reales, pero no ejercitan OAuth ni los handlers de Next.'] };
const schema = `miagenda_local_review_${randomUUID().replaceAll('-', '')}`;
const schemaPattern = /^miagenda_local_review_[a-f0-9]{32}$/;
assert.match(schema, schemaPattern);
function safe(error) { return String(error?.message ?? error).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g, 'REDACTED').slice(0, 1200); }
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log('PASS ' + name); }
async function scenario(name, work) { try { await work(); } catch (error) { const value = { name, error: safe(error) }; report.failures.push(value); console.log('FAIL ' + JSON.stringify(value)); } }

// Test-only CJS bundle: compile the actual client modules without changing them.
// React subscription/auth rendering is stubbed; persistence, projection and queue code are real.
function clientBundle() {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const modules = new Map();
  function collect(file) {
    file = path.resolve(file); const id = path.relative(root, file).replaceAll('\\', '/');
    if (modules.has(id)) return id;
    modules.set(id, '');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const mapped = code.replace(/require\("([^"\n]+)"\)/g, (whole, specifier) => {
      if (!specifier.startsWith('.')) {
        assert.ok(['react', 'next-auth/react'].includes(specifier), `Unexpected client dependency ${specifier}`);
        return whole;
      }
      let target = path.resolve(path.dirname(file), specifier);
      if (!path.extname(target)) target += fs.existsSync(target + '.ts') ? '.ts' : '.tsx';
      assert.ok(target.startsWith(root + path.sep), 'Client bundle restricted to repository');
      return `require(${JSON.stringify(collect(target))})`;
    });
    modules.set(id, mapped); return id;
  }
  const entry = collect(path.join(root, 'src/app/core/local-data.ts'));
  const tasks = collect(path.join(root, 'src/app/core/local-tasks.ts'));
  return `(()=>{const factories={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:(module,exports,require)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(id==='react')return {useSyncExternalStore:(_s,get)=>get()};if(id==='next-auth/react')return {signOut:async()=>{}};if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};factories[id](m,m.exports,require);return m.exports;}window.review={local:require(${JSON.stringify(entry)}),tasks:require(${JSON.stringify(tasks)})};})();`;
}

(async () => {
  const pg = require(path.join(root, 'node_modules/pg'));
  const { PrismaPg } = require(path.join(root, 'node_modules/@prisma/adapter-pg'));
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  const { Prisma, PrismaClient } = await imp('reconstruction/core/generated/client.ts');
  const { coreDatabaseUrl } = await imp('reconstruction/core/src/environment.ts');
  const { ActivityService, LocalTaskConflict } = await imp('reconstruction/core/src/service.ts');
  const { ActivityQueries } = await imp('reconstruction/core/src/queries.ts');
  const { seriesFingerprint } = await imp('reconstruction/core/src/series-fingerprint.ts');
  const { localInstant, localParts, shiftDate } = await imp('reconstruction/core/src/local-time.ts');
  const { occurrenceId, stepActivityId } = await imp('reconstruction/core/src/series-runtime.ts');
  const { kitchenSnapshot, executeKitchenBatch, KitchenConflict } = await imp('reconstruction/core/src/local-kitchen.ts');
  const { PlannerService } = await imp('reconstruction/core/src/planner.ts');
  const { PantryService } = await imp('reconstruction/core/src/pantry.ts');
  const { RecipeService } = await imp('reconstruction/core/src/recipes.ts');
  const playwright = require('C:/Users/emimt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const connectionString = coreDatabaseUrl();
  const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
  admin.on('error', () => {});
  let client, browser, server, created = false;
  const owners = [];
  const tableNames = [...fs.readFileSync(path.join(root, 'reconstruction/core/schema.prisma'), 'utf8').matchAll(/@@map\("([a-z_]+)"\)/g)].map(m => m[1]);
  const bare = new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+(${tableNames.join('|')})\\b`, 'gi');
  const rewrite = sql => sql.replace(/\bpublic\b/g, schema).replace(bare, `$1 ${schema}.$2`);
  function template(strings) { const result = strings.map(rewrite); Object.defineProperty(result, 'raw', { value: strings.map(rewrite) }); return result; }
  function isolated(object) { return new Proxy(object, { get(target, key) {
    if (key === '$transaction') return (fn, options) => target.$transaction(tx => fn(isolated(tx)), options);
    if (key === '$queryRaw' || key === '$executeRaw') return (query, ...values) => target[key](Array.isArray(query) ? template(query) : Prisma.sql(template(query.strings), ...query.values), ...values);
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }); }
  try {
    browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const bundle = clientBundle();
    await admin.connect(); await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const migrationFolder = path.join(root, 'reconstruction/core/migrations');
    for (const name of fs.readdirSync(migrationFolder).filter(n => /^\d/.test(n)).sort()) {
      await admin.query('BEGIN');
      await admin.query(`SET LOCAL search_path = "${schema}", pg_catalog`);
      await admin.query(rewrite(fs.readFileSync(path.join(migrationFolder, name, 'migration.sql'), 'utf8')).replace(/^(BEGIN|COMMIT);\s*$/gm, ''));
      await admin.query('COMMIT');
    }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }, { schema }) });
    const db = isolated(client), service = new ActivityService(db), queries = new ActivityQueries(db);
    const owner = randomUUID(), other = randomUUID(); owners.push(owner, other);
    for (const id of owners) await db.user.create({ data: { id, name: 'Revision temporal', timeZone: 'America/Mexico_City' } });
    check('Prisma y SQL aislados: solo dos usuarios de prueba', Number((await db.$queryRaw`SELECT count(*) AS n FROM users`)[0].n) === 2);
    const ca = randomUUID(), cb = randomUUID(), zone = 'America/Mexico_City';
    const today = localParts(new Date(), zone).date, from = shiftDate(today, -7), end = shiftDate(from, 42);
    const act = body => service.execute(owner, { commandId: randomUUID(), ...body });
    for (const [id, name] of [[ca, 'Prueba A'], [cb, 'Prueba B']]) await act({ action: 'createCalendar', id, name, color: '#2a7a3d' });
    await new PlannerService(db).execute(owner, { commandId: randomUUID(), action: 'initializeKitchen' });
    const revision = async () => (await db.user.findUniqueOrThrow({ where: { id: owner } })).dataRevision.toString();
    const timed = (date, time = '08:00', minutes = 30, calendarId = ca) => { const startsAt = localInstant(date, time, zone); return { mode: 'timed', calendarId, timeZone: zone, startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60000).toISOString() }; };
    const agenda = async (start = from, until = end) => {
      const items = []; let afterId;
      do { const result = await queries.agenda(owner, { startDate: start, endDate: until, startsAt: localInstant(start, '00:00', zone), endsAt: localInstant(until, '00:00', zone), limit: 100, afterId }); items.push(...result.items); afterId = result.nextAfterId; } while (afterId);
      return items;
    };
    async function item(id) { const material = await db.activity.findFirst({ where: { id, userId: owner, lifecycle: 'active' } }); if (material) return (await queries.detail(owner, id)).item; const row = (await agenda(shiftDate(today, -10), shiftDate(today, 100))).flatMap(r => [r, ...r.children]).find(r => r.id === id); assert.ok(row, `Missing test row ${id}`); return row; }
    async function change(id, action, scope = 'this', body = {}) {
      const row = await item(id); return act({ action, id, expectedRevision: row.revision, scope, ...(scope !== 'this' ? { expectedSeriesRevision: row.recurrence.seriesRevision } : {}), ...(row.recurrence?.virtual ? { occurrence: { seriesId: row.recurrence.seriesId, ordinal: row.recurrence.ordinal, seriesRevision: row.recurrence.seriesRevision } } : {}), ...body });
    }
    async function newSeries(label, start = shiftDate(today, 1), count = 14, children = 3) {
      const id = randomUUID(), keys = Array.from({ length: children }, () => randomUUID());
      await act({ action: 'createRecurringTask', id, title: `REV ${label}`, description: null, schedule: timed(start), rule: { frequency: 'DAILY', interval: 1, weekdays: [], untilDate: shiftDate(start, count - 1) } });
      const fixture = { id, keys, start, root: n => occurrenceId(id, n), child: (n, k = 0) => n === 0 ? keys[k] : stepActivityId(id, n, keys[k]) };
      if (children) await change(fixture.root(0), 'addSubtasks', 'all', { children: keys.map((id, i) => ({ id, title: `Paso ${i + 1}` })) });
      return fixture;
    }
    async function snapshot() {
      const dataRevision = await revision();
      const inbox = await queries.inbox(owner, { limit: 100 }); const items = await agenda();
      const kitchen = await db.$transaction(tx => kitchenSnapshot(tx, owner, from), { timeout: 25000, maxWait: 10000 });
      const families = await db.recurrenceSeries.findMany({ where: { userId: owner }, select: { id: true } });
      const fingerprints = {};
      for (const family of families) fingerprints[family.id] = await db.$transaction(tx => seriesFingerprint(tx, owner, family.id));
      return { ...kitchen, format: 1, ownerId: owner, dataRevision, savedAt: new Date().toISOString(), today, start: from, end, inbox, agenda: { items, dataRevision, nextAfterId: null }, highlighted: { items: items.filter(r => r.highlighted), dataRevision, nextAfterId: null }, calendars: (await queries.calendars(owner)).items, seriesFingerprints: fingerprints };
    }
    let syncCalls = 0, failAfterCommit = false; const sentBodies = [];
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost'); let value;
        if (url.pathname === '/_next/static/review.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(bundle); return; }
        if (url.pathname === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(path.join(root, 'public/sw.js'))); return; }
        if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
        if (!url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Revisión aislada MiAgenda</title><script src="/_next/static/review.js"></script>'); return; }
        if (req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk; const raw = body ? JSON.parse(body) : {};
          if (url.pathname === '/api/core/retention') value = { removed: 0 }; // Retention intentionally excluded from this fixture server.
          else if (url.pathname === '/api/core/local/sync') {
            syncCalls++; sentBodies.push(body);
            if (req.headers['x-miagenda-owner'] !== owner) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'ACCOUNT_CHANGED' })); return; }
            value = await service.executeLocalBatch(owner, raw);
            // A raw socket reset may be retried automatically by Chrome. Return an
            // unreadable acknowledgement after the commit to force an unknown result.
            if (failAfterCommit) { failAfterCommit = false; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); return; }
          } else if (url.pathname === '/api/core/local/kitchen') {
            const ack = await executeKitchenBatch(db, owner, raw);
            value = { ...ack, snapshot: await db.$transaction(tx => kitchenSnapshot(tx, owner, raw.start), { timeout: 30000 }) };
          }
          else value = await service.execute(owner, raw);
        } else if (url.searchParams.has('fingerprints')) {
          const ids = url.searchParams.get('fingerprints').split(','); const seriesFingerprints = {};
          for (const id of ids) seriesFingerprints[id] = await db.$transaction(tx => seriesFingerprint(tx, owner, id));
          value = { ownerId: owner, dataRevision: await revision(), seriesFingerprints, activeSeries: (await db.recurrenceSeries.findMany({ where: { id: { in: ids }, userId: owner, retiredAt: null } })).map(r => r.id) };
        } else if (url.searchParams.has('check')) value = { ownerId: owner, dataRevision: await revision() };
        else if (url.searchParams.get('view') === 'recurrence') value = await queries.recurrence(owner, url.searchParams.get('seriesId'), Number(url.searchParams.get('ordinal')));
        else if (url.searchParams.get('view') === 'recurrencePreview') value = await queries.recurrencePreview(owner, JSON.parse(url.searchParams.get('command')));
        else value = await snapshot();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
      } catch (error) {
        if (error instanceof KitchenConflict) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'KITCHEN_CONFLICT', snapshot: error.snapshot, message: error.message })); return; }
        const conflict = error instanceof LocalTaskConflict;
        res.writeHead(conflict ? 409 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(conflict ? { error: 'LOCAL_CONFLICT', message: error.message, rootId: error.rootId, item: error.item, seriesDeletion: error.seriesDeletion, seriesChange: error.seriesChange } : { error: error.code, message: safe(error) }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${server.address().port}`;
    let context, page;
    async function freshBrowser() {
      await context?.close(); context = await browser.newContext(); page = await context.newPage();
      await page.goto(address + '/inbox'); await page.waitForFunction(() => !!window.review);
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.waitForFunction(async () => { const names = await caches.keys(); for (const name of names) if (await (await caches.open(name)).match('/local')) return true; return false; });
    }
    const update = () => page.evaluate(() => window.review.local.refreshLocalCopy());
    const row = id => page.evaluate(id => window.review.tasks.taskRows(window.review.local.currentCopy()).get(id), id);
    const status = () => page.evaluate(() => window.review.local.useLocalStatus());
    async function local(id, action, scope = 'this', extra = {}) {
      return page.evaluate(async ({ id, action, scope, extra }) => {
        const { local, tasks } = window.review, copy = local.currentCopy(), target = tasks.taskRows(copy).get(id), root = target?.parentId ? tasks.taskRows(copy).get(target.parentId) : target;
        const command = { action, id, commandId: crypto.randomUUID(), ...(action === 'createTask' ? {} : { expectedRevision: target?.revision ?? 0 }), ...(extra.optionalStepIds === undefined ? { scope } : {}), ...(scope !== 'this' && root?.recurrence ? { expectedSeriesRevision: root.recurrence.seriesRevision } : {}), ...extra };
        const response = await local.coreFetch('/api/core', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
        const value = await response.json(); if (!response.ok) throw new Error(value.message); return value;
      }, { id, action, scope, extra });
    }
    const reload = async () => { await page.reload(); await page.waitForFunction(() => !!window.review); await page.evaluate(() => window.review.local.restoreLocalCopy()); };
    const sync = () => page.evaluate(() => window.review.local.synchronizeLocalTasks());
    const test = (name, fn, group = 'series') => only && group !== only ? Promise.resolve() : scenario(name, async () => { await freshBrowser(); await fn(); });

    await test('Contenido recurrente: identidad, ausentes, siguientes, persistencia y envío', async () => {
      const s = await newSeries('contenido');
      await change(s.child(1), 'editTask', 'this', { title: 'Renombrada individual' });
      await change(s.child(2), 'deleteTask');
      await change(s.root(3), 'setCompleted', 'this', { completed: true });
      await change(s.child(4, 1), 'scheduleTask', 'this', { schedule: timed(shiftDate(s.start, 4), '10:00') });
      await update(); const before = syncCalls;
      await local(s.root(2), 'editTask', 'following', { title: 'Nombre siguientes' });
      check('Nombre por siguientes no cambia anteriores', (await row(s.root(1))).title !== 'Nombre siguientes' && (await row(s.root(5))).title === 'Nombre siguientes');
      const addKey = randomUUID(); await local(s.root(0), 'addSubtasks', 'all', { children: [{ id: addKey, title: 'Nuevo compartido' }] });
      check('Agregar a serie reabre completada y conserva otras marcas', !(await row(s.root(3))).completedAt && (await row(s.root(3))).children.slice(0, 3).every(c => c.completedAt));
      await local(s.child(0), 'editTask', 'all', { title: 'Renombrada por clave' });
      check('Renombra por clave estable y omite eliminada', (await row(s.child(1))).title === 'Renombrada por clave' && !(await row(s.child(2))));
      check('Editar contenido mantiene horario propio', (await row(s.child(4, 1))).schedule.startsAt === timed(shiftDate(s.start, 4), '10:00').startsAt);
      const ids = (await row(s.root(5))).children.map(c => c.id);
      await context.setOffline(true); await reload();
      check('IndexedDB real conserva cola y contenido al recargar offline', (await status()).pending === 3 && (await row(s.root(5))).title === 'Nombre siguientes');
      await context.setOffline(false); await page.evaluate(() => window.review.local.setLocalOnline(true));
      check('Reconectar no envía cambios', syncCalls === before);
      await update();
      check('Actualizar vacía cola', (await status()).pending === 0);
      check('Confirmar no cambia IDs de hijos', JSON.stringify((await row(s.root(5))).children.map(c => c.id)) === JSON.stringify(ids));
      check('Contenido servidor coincide con proyección', (await item(s.child(1))).title === 'Renombrada por clave' && !(await item(s.root(2))).children.some(c => c.stepKeyId === s.keys[0]));
      check('No materializa todas las ocurrencias al editar alcance', await db.occurrenceOverride.count({ where: { userId: owner, seriesId: s.id } }) < 14);
    });

    await test('Horarios recurrentes: fecha movida, hijos y calendario', async () => {
      const s = await newSeries('horarios');
      await change(s.child(0), 'scheduleTask', 'all', { schedule: timed(s.start, '10:00') });
      await change(s.root(4), 'scheduleTask', 'this', { schedule: timed(shiftDate(s.start, 9), '06:00') });
      await change(s.child(1), 'editTask', 'this', { title: 'Horario renombrada' });
      await change(s.child(2), 'deleteTask');
      await change(s.child(3), 'setCompleted', 'this', { completed: true });
      const completedSchedule = (await item(s.child(3))).schedule;
      await update(); await context.setOffline(true);
      await local(s.root(1), 'saveTask', 'following', { title: 'Horario guardado junto', schedule: timed(shiftDate(s.start, 1), '09:15', 45, cb) });
      check('Horario principal conserva fecha movida y cambia calendario', (await row(s.root(4))).schedule.startsAt === timed(shiftDate(s.start, 9), '09:15').startsAt && (await row(s.root(4))).schedule.calendarId === cb);
      check('Horario principal conserva hora del hijo y hereda calendario', (await row(s.child(3))).schedule.startsAt === completedSchedule.startsAt && (await row(s.child(3))).schedule.calendarId === cb);
      await local(s.child(0), 'scheduleTask', 'all', { schedule: timed(shiftDate(s.start, -1), '23:45', 30) });
      check('Hijo usa diferencia de día respecto a cada fecha actual', (await row(s.child(4))).schedule.startsAt === timed(shiftDate(s.start, 8), '23:45').startsAt);
      check('Cambiar horario omite ausente y mantiene completado', !(await row(s.child(2))) && (await row(s.child(3))).schedule.startsAt === completedSchedule.startsAt);
      await local(s.child(5), 'unscheduleTask', 'following');
      check('Quitar siguientes conserva casilla y borra programación de pendientes', !(await row(s.child(5))).schedule && !!(await row(s.child(4))).schedule && !(await row(s.child(5))).keep && !(await row(s.child(5))).highlighted);
      await reload(); await context.setOffline(false); await update();
      check('Horario y nombre conjuntos se confirman', (await item(s.root(4))).title === 'Horario guardado junto' && (await item(s.root(4))).schedule.startsAt === timed(shiftDate(s.start, 9), '09:15').startsAt);
      check('Servidor conserva diferencia de días para excepción movida', (await item(s.child(4))).schedule.startsAt === timed(shiftDate(s.start, 8), '23:45').startsAt);
      check('Servidor conserva horario completado y omite ausentes', (await item(s.child(3))).schedule.startsAt === completedSchedule.startsAt && !(await item(s.root(2))).children.some(c => c.stepKeyId === s.keys[0]));
      check('Servidor mantiene casilla al quitar horario siguientes', !(await item(s.child(8))).schedule);
    });

    await test('Completado por alcance: marcas diferentes, ausentes y reloj adelantado', async () => {
      const s = await newSeries('marcas');
      await change(s.child(1), 'editTask', 'this', { title: 'Marca renombrada' });
      await change(s.child(2), 'deleteTask');
      await change(s.child(4, 1), 'setCompleted', 'this', { completed: true });
      await update(); await context.setOffline(true);
      await local(s.child(1), 'setCompleted', 'following', { completed: true });
      check('Marca siguientes encuentra renombrada y omite ausente', !!(await row(s.child(1))).completedAt && !(await row(s.child(0))).completedAt && !(await row(s.child(2))));
      check('Marca una sub conserva otras marcas diferentes', !!(await row(s.child(4, 1))).completedAt && !(await row(s.child(4, 2))).completedAt);
      await local(s.child(1), 'setCompleted', 'all', { completed: false });
      check('Deshacer sub toda serie solo desmarca esa clave', !(await row(s.child(4))).completedAt && !!(await row(s.child(4, 1))).completedAt);
      await local(s.root(3), 'setCompleted', 'following', { completed: true });
      check('Completar principal siguientes completa todos sus hijos', (await row(s.root(4))).children.every(c => c.completedAt) && !!(await row(s.root(4))).completedAt && !(await row(s.root(1))).completedAt);
      await reload(); await context.setOffline(false); await update();
      check('Completado llega al servidor sin materializar futuro entero', (await item(s.root(8))).children.every(c => c.completedAt) && await db.occurrenceOverride.count({ where: { userId: owner, seriesId: s.id } }) < 14);
      await local(s.root(0), 'setCompleted', 'all', { completed: false }); await update();
      check('Deshacer principal toda serie desmarca hijos', (await item(s.root(8))).children.every(c => !c.completedAt) && !(await item(s.root(8))).completedAt);
      // Feed the real sync service a future action timestamp; no personal records involved.
      const snap = await snapshot(), rootRow = snap.agenda.items.find(r => r.id === s.root(0));
      const at = new Date(Date.now() + 365 * 86400000).toISOString();
      await service.executeLocalBatch(owner, { commandId: randomUUID(), operations: [{ command: { action: 'setCompleted', commandId: randomUUID(), id: rootRow.id, expectedRevision: rootRow.revision, scope: 'all', expectedSeriesRevision: rootRow.recurrence.seriesRevision, completed: true }, rootId: rootRow.id, at, seriesChange: { seriesId: s.id, fingerprint: snap.seriesFingerprints[s.id], fromDate: null, stepKeyId: null } }], guards: [{ id: rootRow.id, revision: rootRow.revision, children: rootRow.children.map(c => ({ id: c.id, revision: c.revision })) }] });
      check('Servidor limita marcas futuras al presente', Date.parse((await item(s.root(8))).completedAt) <= Date.now());
    });

    await test('Borrado recurrente: excepción movida, deshacer y tres alcances', async () => {
      const s = await newSeries('borrado');
      await change(s.root(5), 'saveTask', 'this', { title: 'Excepción futura movida atrás', schedule: timed(shiftDate(s.start, -2)) });
      await update(); await context.setOffline(true);
      await local(s.root(3), 'deleteTask', 'following');
      check('Borrar siguientes usa fecha original incluso excepción movida atrás', !(await row(s.root(5))) && !!(await row(s.root(2))));
      const deletion = (await status()).deletions[0]; await page.evaluate(id => window.review.local.undoPendingDeletion(id), deletion.id);
      check('Deshacer borrado restaura excepciones y cola', !!(await row(s.root(5))) && (await status()).pending === 0);
      await local(s.root(1), 'deleteTask', 'this');
      check('Borrar solo esta conserva otras instancias', !(await row(s.root(1))) && !!(await row(s.root(2))));
      await local(s.root(0), 'deleteTask', 'all'); await reload();
      check('Borrado toda serie persiste offline y oculta hijos', !(await row(s.root(5))) && !(await row(s.child(5))));
      await context.setOffline(false); await update();
      check('Borrado serie se confirma y no reaparece', (await status()).pending === 0 && !(await agenda()).some(r => r.recurrence?.seriesId === s.id));
    });

    await test('Envío incierto: reintento idempotente y prohibición de descartar', async () => {
      const s = await newSeries('incierto', shiftDate(today, 1), 7, 1); await update();
      await local(s.root(0), 'editTask', 'all', { title: 'Confirmación única' });
      failAfterCommit = true; const before = sentBodies.length;
      await assert.rejects(sync);
      check('Respuesta perdida mantiene cola', (await status()).pending === 1);
      await assert.rejects(() => page.evaluate(() => { window.confirm = () => true; return window.review.local.discardLocalTasks(); }));
      check('No descarta un lote de resultado incierto', (await status()).pending === 1);
      await reload(); await sync();
      check('Reintento conserva payload byte por byte', sentBodies[before] === sentBodies[before + 1]);
      check('Reintento no duplica aplicación y vacía cola', (await status()).pending === 0 && (await item(s.root(4))).title === 'Confirmación única');
    }, 'uncertain');

    await test('Conflictos serie: cambios fuera de descarga y elección explícita', async () => {
      const s = await newSeries('conflicto', shiftDate(today, 1), 90, 1); await update();
      await local(s.root(0), 'editTask', 'all', { title: 'Cambio local' });
      await change(s.root(70), 'editTask', 'this', { title: 'Cambio remoto fuera de ventana' });
      await assert.rejects(sync);
      check('Huella detecta cambio fuera de ventana', (await status()).conflict?.seriesChange === true && (await status()).pending === 1);
      const calls = syncCalls; await page.evaluate(() => window.review.local.resolveLocalConflict('mine'));
      check('Conservar local no envía automáticamente', syncCalls === calls && (await status()).pending === 1 && !(await status()).conflict);
      await update(); check('Elección local se aplica también fuera de ventana', (await item(s.root(70))).title === 'Cambio local');
      await local(s.root(0), 'editTask', 'all', { title: 'Cambio cancelado' });
      await change(s.root(60), 'editTask', 'this', { title: 'Conservar remoto' }); await assert.rejects(sync);
      await page.evaluate(() => window.review.local.resolveLocalConflict('server'));
      check('Cancelar alcance conserva servidor y retira operación', (await status()).pending === 0 && (await item(s.root(60))).title === 'Conservar remoto');
      await update();
    });

    await test('Cancelar alta en conflicto retira ediciones dependientes', async () => {
      const s = await newSeries('dependencias', shiftDate(today, 1), 7, 1); await update(); const key = randomUUID();
      await local(s.root(0), 'addSubtasks', 'all', { children: [{ id: key, title: 'Sub nueva dependiente' }] });
      await local(key, 'editTask', 'this', { title: 'Edición dependiente' });
      await change(s.root(1), 'editTask', 'this', { title: 'Remota desencadenante' }); await assert.rejects(sync);
      await page.evaluate(() => window.review.local.resolveLocalConflict('server'));
      check('Cancelar alta cancela también edición de hijo nuevo', (await status()).pending === 0 && !(await row(key)));
      await update();
    });

    for (const preserve of [true, false]) await test(`Dejar de repetir: conservar modificadas=${preserve}`, async () => {
      const s = await newSeries(`detener-${preserve}`, shiftDate(today, -2), 14, 2);
      await change(s.root(3), 'editTask', 'this', { title: 'Futura modificada' });
      await change(s.child(2), 'scheduleTask', 'this', { schedule: timed(shiftDate(today, 1), '12:00', 15, cb) });
      await change(s.child(2), 'setCompleted', 'this', { completed: true });
      await change(s.root(5), 'setCompleted', 'this', { completed: true });
      await update(); const selected = await row(s.root(2)), childBefore = await row(s.child(2));
      const info = await queries.recurrence(owner, s.id, 2);
      const command = { action: 'stopRecurrence', commandId: randomUUID(), id: selected.id, expectedRevision: selected.revision, scope: 'following', expectedSeriesRevision: info.seriesRevision, expectedDataRevision: info.dataRevision, seriesId: s.id, ordinal: 2, effectiveDate: info.today, preserveModified: preserve };
      const preview = await queries.recurrencePreview(owner, command);
      check(`Revisión no modifica serie (${preserve})`, await revision() === info.dataRevision && preview.modifiedCount === 1);
      await local(selected.id, 'stopRecurrence', 'following', command);
      check(`Tarea elegida pasa a Inbox sin perder identidad (${preserve})`, (await row(selected.id)).recurrence === null && (await row(selected.id)).schedule === null && (await row(selected.id)).children.length === 2);
      check(`Hijo conserva marca y horario propio (${preserve})`, (await row(s.child(2))).schedule.startsAt === childBefore.schedule.startsAt && (await row(s.child(2))).completedAt === childBefore.completedAt && !(await row(s.child(2))).recurrence);
      check(`Pasadas y completadas permanecen (${preserve})`, !!(await row(s.root(0))) && !!(await row(s.root(5))).completedAt);
      check(`Modificadas siguen opción elegida (${preserve})`, preserve ? (await row(s.root(3)))?.recurrence === null : !(await row(s.root(3))));
      await context.setOffline(true); await reload(); check(`Inbox y cola persisten sin internet (${preserve})`, !(await row(selected.id)).schedule && (await status()).pending === 1);
      await context.setOffline(false); await update();
      check(`Separación confirmada mantiene IDs (${preserve})`, !(await item(selected.id)).recurrence && (await item(selected.id)).children.some(c => c.id === s.child(2)));
      check(`No aparecen nuevas pendientes al detener (${preserve})`, !(await agenda()).some(r => !r.parentId && r.recurrence?.seriesId === s.id && r.recurrence.originalDate >= today && !r.completedAt));
    });

    await test('Cocina local: compras, preparaciones, consumo y sobras', async () => {
      const pantry = new PantryService(db), recipes = new RecipeService(db), planner = new PlannerService(db);
      const grain = randomUUID(), extra = randomUUID(), salt = randomUUID(), recipeId = randomUUID();
      for (const [id, name, trackingMode] of [[grain, 'REV avena local', 'quantity'], [extra, 'REV miel local', 'quantity'], [salt, 'REV canela local', 'availability']])
        await pantry.execute(owner, { commandId: randomUUID(), action: 'createIngredient', id, name, unit: 'g', trackingMode, confirmSimilar: true });
      const keys = Array.from({ length: 4 }, () => randomUUID());
      const definition = { name: 'REV overnight local', description: null, baseServings: '1', cookingMinutes: 10, steps: keys.map((stepKey, i) => ({ stepKey, text: `Paso ${i}`, optional: i === 1, ingredientId: i === 0 ? grain : i === 1 ? extra : i === 3 ? salt : null, expectedIngredientRevision: i === 2 ? null : 0, quantity: i === 0 ? '20' : i === 1 ? '5' : null, equivalent: i === 3 ? 'al gusto' : null, minutesBefore: i === 2 ? 60 : null, priorTitle: i === 2 ? 'Guardar en frío' : null, priorGroup: i === 2 })) };
      const recipe = (await recipes.execute(owner, { commandId: randomUUID(), action: 'createRecipe', id: recipeId, recipe: definition })).item;
      const slots = (await planner.snapshot(owner, today, 7)).slots;
      const first = randomUUID(), second = randomUUID(), dish = randomUUID();
      const meal = (id, date, cooking) => ({ commandId: randomUUID(), action: 'saveMeal', id, expectedRevision: null, date, time: '08:00', slotId: slots[0].id, cookingEnabled: cooking, eatingEnabled: true, washingEnabled: true, eatingMinutes: 20, washingMinutes: 5, cookingMinutesOverride: null, recipes: [{ id: id === first ? dish : randomUUID(), recipeRevisionId: recipe.revisionId, cookedServings: cooking ? '2' : '0', eatenServings: '1', cookingMinutesOverride: null, ingredientQuantities: cooking ? { [`${grain}:required`]: '41' } : {} }], reminders: id === first ? [{ mealRecipeId: dish, stepKey: keys[2], startsAt: timed(today, '07:00', 5).startsAt, endsAt: timed(today, '07:00', 5).endsAt, manual: false }] : [] });
      await planner.execute(owner, meal(first, today, true)); await planner.execute(owner, meal(second, shiftDate(today, 1), false));
      await update(); await context.setOffline(true);
      const copy = () => page.evaluate(() => window.review.local.currentCopy());
      const kitchen = body => page.evaluate(async body => {
        const local = window.review.local, response = await local.coreFetch('/api/core', { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...body }) });
        const value = await response.json(); if (!response.ok) throw new Error(value.message); return value;
      }, body);
      const quantity = async id => Number((await copy()).pantry.ingredients.find(i => i.id === id).quantity);
      const purchase = items => kitchen({ action: 'buyShoppingItems', expectedDataRevision: '0', items });
      let c = await copy();
      check('Compras offline usa cantidad corregida y solo planes con Cocinar', c.shopping.items.find(i => i.ingredientId === grain).quantity === '41' && c.shopping.items.find(i => i.ingredientId === extra).optional === '10');
      check('Ingrediente por disponibilidad aparece sin gramos inventados', c.shopping.items.find(i => i.ingredientId === salt).availabilityOnly);
      const prior = c.kitchenLedger.steps.find(s => s.mealId === first && s.stepKey === keys[2]).id;
      const optional = c.kitchenLedger.steps.find(s => s.mealId === first && s.stepKey === keys[1]).id;
      await local(prior, 'setCompleted', 'this', { completed: true });
      check('Preparación previa offline no consume ni completa la comida', await quantity(grain) === 0 && !(await row(first)).completedAt);
      await purchase([{ key: `i:${grain}`, quantity: '60' }, { key: `i:${extra}`, quantity: '20' }, { key: `i:${salt}`, quantity: '0' }]);
      check('Compra local suma cantidades elegidas y marca disponibilidad', await quantity(grain) === 60 && await quantity(extra) === 20 && (await copy()).pantry.ingredients.find(i => i.id === salt).available);
      await assert.rejects(() => local(first, 'setCompleted', 'this', { completed: true }), /opcionales/);
      check('Finalizar exige elegir opcionales y el rechazo no cambia inventario', await quantity(grain) === 60 && !(await row(first)).completedAt);
      await local(first, 'setCompleted', 'this', { completed: true, optionalStepIds: [optional] });
      const after = await quantity(grain);
      await local(first, 'setCompleted', 'this', { completed: true, optionalStepIds: [optional] });
      check('Completar local descuenta cantidades exactas una sola vez', after === 19 && await quantity(grain) === 19 && await quantity(extra) === 10);
      check('Agenda y Planificar comparten completado; disponibilidad no se descuenta', !!(await row(first)).completedAt && !!(await copy()).planners.flatMap(p => p.meals).find(m => m.id === first).completedAt && (await copy()).pantry.ingredients.find(i => i.id === salt).available);
      await local(second, 'setCompleted', 'this', { completed: true, optionalStepIds: [] });
      check('Segunda comida usa sobras reales sin descontar ingredientes', await quantity(grain) === 19 && (await copy()).planners.flatMap(p => p.meals).find(m => m.id === second).portionSources.some(s => s.mealId === first));
      await assert.rejects(() => local(first, 'setCompleted', 'this', { completed: false }), /Primero deshaz/);
      check('Dependencia de sobras muestra motivo y conserva marcas e inventario', !!(await row(first)).completedAt && !!(await row(second)).completedAt && await quantity(grain) === 19);
      await local(second, 'setCompleted', 'this', { completed: false }); await local(first, 'setCompleted', 'this', { completed: false });
      check('Deshacer en orden devuelve cantidades y conserva preparación previa', await quantity(grain) === 60 && await quantity(extra) === 20 && !!(await row(prior)).completedAt);
      const grainReceipt = (await copy()).kitchenLedger.purchases.find(p => p.ingredientId === grain).id;
      await kitchen({ action: 'undoShoppingPurchase', expectedDataRevision: '0', id: grainReceipt });
      check('Deshacer una compra todavía sin enviar restaura faltante', await quantity(grain) === 0 && (await copy()).shopping.items.some(i => i.ingredientId === grain));
      const personalIngredient = randomUUID(), newRecipe = randomUUID();
      await kitchen({ action: 'createIngredient', id: personalIngredient, name: 'REV ingrediente temporal', unit: 'piece', trackingMode: 'quantity', confirmSimilar: true });
      const personalRecipe = { name: 'REV receta offline', description: null, baseServings: '3', cookingMinutes: 5, steps: [{ stepKey: randomUUID(), text: 'Agregar', optional: false, ingredientId: personalIngredient, expectedIngredientRevision: 0, quantity: '2', equivalent: null, minutesBefore: null, priorTitle: null }] };
      await kitchen({ action: 'createRecipe', id: newRecipe, recipe: personalRecipe });
      const frozen = (await copy()).planners.flatMap(p => p.meals).find(m => m.id === first).recipes[0].revisionId;
      await kitchen({ action: 'editRecipe', id: recipeId, expectedRevision: recipe.revision, recipe: { ...definition, name: 'REV receta nueva versión', steps: definition.steps.map((s, i) => ({ ...s, quantity: i === 0 ? '90' : s.quantity })) } });
      check('Edición local del recetario conserva versión y cantidades del plan', (await copy()).planners.flatMap(p => p.meals).find(m => m.id === first).recipes[0].revisionId === frozen && (await copy()).shopping.items.find(i => i.ingredientId === grain).required === '41');
      const pending = (await status()).pending; await reload();
      check('Cocina completa persiste tras cerrar sin conexión', (await status()).pending === pending && await quantity(grain) === 0 && !!(await row(prior)).completedAt && (await copy()).recipes.items.some(r => r.id === newRecipe));
      await context.setOffline(false); await update();
      check('Enviar confirma compras, deshacer y recetas sin duplicar', (await status()).pending === 0 && Number((await db.pantryBalance.findUnique({ where: { userId_ingredientId: { userId: owner, ingredientId: grain } } })).quantity) === 0 && await db.shoppingReceipt.count({ where: { userId: owner } }) === 3 && !!await db.recipe.findUnique({ where: { id: newRecipe } }));
      check('Servidor mantiene preparación realizada y comidas pendientes', !!(await item(prior)).completedAt && !(await item(first)).completedAt && !(await item(second)).completedAt);
      check('El plan confirmado sigue en su versión anterior', (await planner.cell(owner, today, slots[0].id)).meal.recipes[0].revisionId === frozen);
      // Conservative conflict fence must preserve unrelated local task operations.
      await kitchen({ action: 'setPantryQuantity', id: grain, expectedBalanceRevision: null, expectedIngredientRevision: 0, quantity: '12', listed: true });
      const taskId = randomUUID(); await local(taskId, 'createTask', 'this', { title: 'REV tarea no descartable', description: null, parentId: null, expectedParentRevision: null, position: 0 });
      const ing = await db.ingredient.findUnique({ where: { id: grain } }), bal = await db.pantryBalance.findUnique({ where: { userId_ingredientId: { userId: owner, ingredientId: grain } } });
      await pantry.execute(owner, { commandId: randomUUID(), action: 'setPantryQuantity', id: grain, expectedIngredientRevision: ing.revision, expectedBalanceRevision: bal.revision, quantity: '7', listed: true });
      await assert.rejects(update);
      check('Conflicto de stock conserva Cocina pendiente y confirma tarea sin pisar stock', !!(await status()).kitchenConflict && (await status()).pending === 1 && !!await db.activity.findUnique({ where: { id: taskId } }) && Number((await db.pantryBalance.findUnique({ where: { userId_ingredientId: { userId: owner, ingredientId: grain } } })).quantity) === 7);
      await page.evaluate(() => window.review.local.resolveKitchenConflict('server'));
      check('Usar Cocina del servidor conserva la tarea ya confirmada', await quantity(grain) === 7 && (await status()).pending === 0 && !!(await row(taskId)));
      await update(); check('Tarea ajena al conflicto se confirma normalmente', (await status()).pending === 0 && (await item(taskId)).title === 'REV tarea no descartable');
    }, 'kitchen');

    await test('Aislamiento de propietario', async () => {
      const s = await newSeries('propietario', shiftDate(today, 1), 3, 1); await update();
      const snap = await snapshot(), r = snap.agenda.items.find(r => r.id === s.root(0));
      await assert.rejects(() => service.executeLocalBatch(other, { commandId: randomUUID(), operations: [{ command: { action: 'deleteTask', id: r.id, commandId: randomUUID(), expectedRevision: r.revision, scope: 'all', expectedSeriesRevision: r.recurrence.seriesRevision }, rootId: r.id, at: new Date().toISOString(), seriesDeletion: { seriesId: s.id, fingerprint: snap.seriesFingerprints[s.id], fromDate: null } }], guards: [{ id: r.id, revision: r.revision, children: r.children.map(c => ({ id: c.id, revision: c.revision })) }] }));
      check('Otra cuenta no aplica lote de una serie ajena', !!(await item(s.root(0))));
    });
    const publicRows = await admin.query('SELECT count(*)::int AS count FROM public.users WHERE id = ANY($1::uuid[])', [owners]);
    report.publicFixtures = publicRows.rows[0].count; check('Ningún usuario de prueba se creó en public', report.publicFixtures === 0);
    await context.close();
  } catch (error) { report.failures.push({ name: 'Preparación o ejecución', error: safe(error) }); console.error('FAIL ' + safe(error)); }
  finally {
    await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    await client?.$disconnect();
    if (created) {
      assert.match(schema, schemaPattern);
      const cleanup = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 }); cleanup.on('error', () => {});
      try { await cleanup.connect(); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); report.temporarySchemaRemoved = true; console.log('Esquema temporal eliminado'); }
      catch (error) { report.failures.push({ name: 'Limpieza temporal', error: safe(error), schema }); }
      finally { await cleanup.end(); }
    }
    await admin.end().catch(() => {});
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`DONE ${report.checks.length} comprobaciones; ${report.failures.length} escenarios fallidos`);
    if (report.failures.length) process.exitCode = 1;
  }
})();
