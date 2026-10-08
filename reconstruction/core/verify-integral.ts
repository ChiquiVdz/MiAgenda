import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/client.ts";
import { coreDatabaseUrl } from "./src/environment.ts";
import { ActivityService } from "./src/service.ts";
import { ActivityQueries } from "./src/queries.ts";
import { PantryService } from "./src/pantry.ts";
import { RecipeService } from "./src/recipes.ts";
import { PlannerService } from "./src/planner.ts";
import { ShoppingService } from "./src/shopping.ts";
import { createCoreHandler } from "./src/http.ts";
import { expandRecurrence } from "./src/recurrence.ts";
import { mealDuration } from "./src/planner-input.ts";
import { cleanupCoreUser } from "./src/retention.ts";
import { identityAdapter } from "./src/authentication.ts";
import { shiftDate } from "./src/local-time.ts";
import type { ActivityView } from "./src/views.ts";

// Explicitly authorized integration review. All fixtures, transactions and SQL
// run in a random temporary namespace; public app data and sessions are untouched.
const schema = `miagenda_integral_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^miagenda_integral_test_[a-f0-9]{32}$/);
const connectionString = coreDatabaseUrl(), admin = new pg.Client({ connectionString });
let client: PrismaClient | undefined, created = false;
const checks: string[] = [];
const report = { at: new Date().toISOString(), passed: checks, failure: null as string | null, temporarySchemaRemoved: false };
let stage = "Preparar esquema temporal";
function check(name: string, condition: unknown) { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`); }
const tableNames = [...readFileSync("reconstruction/core/schema.prisma", "utf8").matchAll(/@@map\("([a-z_]+)"\)/g)].map(match=>match[1]);
const bareTables = new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+(${tableNames.join("|")})\\b`, "gi");
function rewrite(sql: string) { return sql.replace(/\bpublic\b/g, schema).replace(bareTables, `$1 ${schema}.$2`); }
function template(strings: readonly string[]) { const mapped = strings.map(rewrite) as unknown as TemplateStringsArray; Object.defineProperty(mapped, "raw", { value: strings.map(rewrite) }); return mapped; }
function isolated<T extends object>(target: T): T {
  return new Proxy(target, { get(object, key) {
    if (key === "$transaction") return (fn: (tx: object) => unknown, options: unknown) =>
      (object as any).$transaction((tx: object) => fn(isolated(tx)), options);
    if (key === "$queryRaw" || key === "$executeRaw") return (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const adapted = Array.isArray(query) ? template(query) : Prisma.sql(template((query as Prisma.Sql).strings), ...(query as Prisma.Sql).values);
      return (object as any)[key](adapted, ...values);
    };
    const value = Reflect.get(object, key); return typeof value === "function" ? value.bind(object) : value;
  } });
}
try {
  await admin.connect(); await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const folder = resolve("reconstruction/core/migrations");
  for (const name of readdirSync(folder).filter(name => /^\d/.test(name)).sort()) {
    await admin.query("BEGIN");
    await admin.query(`SET LOCAL search_path = "${schema}", pg_catalog`);
    await admin.query(rewrite(readFileSync(resolve(folder, name, "migration.sql"), "utf8")).replace(/^(BEGIN|COMMIT);\s*$/gm, ""));
    await admin.query("COMMIT");
  }
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }, { schema }) });
  const db = isolated(client);
  stage = "Verificar aislamiento SQL";
  const namespace = await db.$queryRaw<{ name: string }[]>`SELECT table_schema::text AS name FROM information_schema.tables WHERE table_schema=${schema} AND table_name='users'`;
  check("Esquema temporal creado con migraciones reales", namespace[0].name === schema);
  const owner = randomUUID(), other = randomUUID(), calendarId = randomUUID();
  await db.user.create({ data: { id: owner, name: "Integral verification", email:"revision@example.invalid", timeZone: "America/Mexico_City" } });
  await db.user.create({ data: { id: other, name: "Other verification owner", timeZone: "America/Mexico_City" } });
  check("SQL sin calificar y Prisma comparten solo los usuarios de prueba", (await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM users`)[0].count===2n);
  const testToken=randomUUID(); await db.session.create({data:{userId:owner,sessionToken:testToken,expires:new Date(Date.now()+86400000)}});
  check("Acceso encuentra sesión y propietario",(await identityAdapter(db).getSessionAndUser!(testToken))?.user.id===owner);
  await db.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL search_path = pg_catalog`;
    check("Acceso no depende del search_path compartido",(await identityAdapter(tx as unknown as PrismaClient).getSessionAndUser!(testToken))?.user.id===owner);
  });
  if(!process.argv.includes("--isolation")) {
  const service = new ActivityService(db), queries = new ActivityQueries(db), pantry = new PantryService(db), recipes = new RecipeService(db), planner = new PlannerService(db), shopping = new ShoppingService(db);
  const revision = async () => (await db.user.findUniqueOrThrow({ where: { id: owner }, select: { dataRevision: true } })).dataRevision.toString();
  const command = (body: Record<string, unknown>) => ({ commandId: randomUUID(), ...body });
  const act = (body: Record<string, unknown>) => service.execute(owner, command(body));
  const cook = (body: Record<string, unknown>) => planner.execute(owner, command(body));
  const buy = async (body: Record<string, unknown>) => shopping.execute(owner, command({ expectedDataRevision: await revision(), ...body }));
  const item = async (id: string) => (await queries.detail(owner, id)).item;
  const change = async (id: string, action: string, body: Record<string, unknown> = {}) => act({ action, id, expectedRevision: (await item(id)).revision, ...body });
  const schedule = (date: string, hour = "10:00", calendar: string = calendarId) => ({ mode: "timed", calendarId: calendar, timeZone: "America/Mexico_City", startsAt: `${date}T${hour}:00-06:00`, endsAt: `${date}T${String(Number(hour.slice(0,2))+1).padStart(2,"0")}:${hour.slice(3)}:00-06:00` });
  const agenda = (start = "2026-11-01", end = "2026-12-01", extra = {}) => queries.agenda(owner, { startsAt: `${start}T00:00:00-06:00`, endsAt: `${end}T00:00:00-06:00`, startDate: start, endDate: end, ...extra });
  async function rejected(name: string, read: () => Promise<unknown>, code: string) { let observed: unknown; try { await read(); } catch (error) { observed = (error as { code?: string }).code; } check(name, observed === code); }
  async function task(title: string, parentId: string | null = null) { const id = randomUUID(); await act({ action: "createTask", id, title, description: null, parentId, position: 0, expectedParentRevision: parentId ? (await item(parentId)).revision : null }); return id; }

  stage = "Actividades, permisos y recibos";
  await act({ action: "createCalendar", id: calendarId, name: "Revisión", color: "#527860" });
  if (process.argv.includes("--schema")) {
    stage="Comprobar escritura mínima de receta";
    await recipes.execute(owner,command({action:"createRecipe",id:randomUUID(),recipe:{name:"Schema check",description:null,draft:true,baseServings:null,cookingMinutes:null,steps:[]}}));
    check("Escritura mínima de receta con todas las migraciones",true);
  }
  if (!process.argv.includes("--kitchen")) {
  const root = await task("Principal"), first = await task("Uno", root), second = await task("Dos", root);
  check("Inbox conserva principal y subtareas", (await queries.inbox(owner)).items.find(row => row.id === root)?.children.length === 2);
  await change(first, "setCompleted", { completed: true }); check("Una subtarea no completa la principal", !(await item(root)).completedAt);
  await change(second, "setCompleted", { completed: true }); check("Todas las subtareas completan principal", !!(await item(root)).completedAt);
  await change(root, "setCompleted", { completed: false }); check("Deshacer principal desmarca todos los hijos", (await item(root)).children.every(child => !child.completedAt));
  await change(root, "setCompleted", { completed: true }); await task("Tres", root); check("Agregar pendiente reabre principal", !(await item(root)).completedAt);
  await rejected("Un segundo nivel de subtareas se rechaza", () => task("Nieto", first), "DEPENDENCY");
  await rejected("Conservar sin horario se rechaza", () => change(root, "setFlags", { keep: true }), "DEPENDENCY");
  await change(first, "scheduleTask", { schedule: schedule("2026-11-02") });
  check("Hijo de Inbox aparece en Agenda con padre estable", (await agenda()).items.some(row => row.id === first && row.parentId === root));
  await change(first, "setFlags", { highlighted: true }); check("Destacar activa Conservar", (await item(first)).keep && (await item(first)).highlighted);
  await change(first, "setFlags", { keep: false }); check("Las dos marcas son independientes", !(await item(first)).keep && (await item(first)).highlighted);
  await change(first, "unscheduleTask"); check("Quitar horario conserva casilla y desactiva marcas", !(await item(first)).schedule && !(await item(first)).highlighted && (await item(root)).children.some(child => child.id === first));
  await change(root, "scheduleTask", { schedule: schedule("2026-11-03") }); check("Agendar principal la retira de Inbox", !(await queries.inbox(owner)).items.some(row => row.id === root));
  await rejected("Lectura de otro propietario se rechaza", () => queries.detail(other, root), "NOT_FOUND");
  await rejected("Escritura de otro propietario se rechaza", () => service.execute(other, command({ action: "deleteTask", id: root, expectedRevision: (0) })), "NOT_FOUND");
  const replayId = randomUUID(), repeated = command({ action: "createTask", id: replayId, title: "Idempotencia", description: null, parentId: null, position: 0, expectedParentRevision: null });
  await service.execute(owner, repeated); check("Reintentar comando no duplica actividad", (await service.execute(owner, repeated)).replayed && await db.activity.count({ where: { id: replayId } }) === 1);
  await rejected("Mismo comando con contenido distinto se rechaza", () => service.execute(owner, { ...repeated, title: "Otro" }), "IDEMPOTENCY_CONFLICT");
  await rejected("Revisión antigua no sobrescribe", () => act({ action: "editTask", id: root, expectedRevision: 0, title: "Viejo" }), "CONFLICT");
  const handler = createCoreHandler({ service, queries, pantry, recipes, planner, shopping, applicationOrigin: "http://localhost:3000", sessionOwner: async () => owner });
  const anon = createCoreHandler({ service, queries, applicationOrigin: "http://localhost:3000", sessionOwner: async () => null });
  check("API sin sesión devuelve 401", (await anon(new Request("http://localhost:3000/api/core?view=inbox"))).status === 401);
  check("API rechaza origen indebido", (await handler(new Request("http://localhost:3000/api/core", { method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: JSON.stringify(repeated) }))).status === 403);
  check("API rechaza cuerpo mayor a 64 KB", (await handler(new Request("http://localhost:3000/api/core", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(66000) }) }))).status === 400);
  check("Lecturas de API no se cachean públicamente", (await handler(new Request("http://localhost:3000/api/core?view=inbox"))).headers.get("cache-control") === "private, no-store");

  stage = "Calendarios y recurrencias";
  const movedCalendar = randomUUID(); await act({ action: "createCalendar", id: movedCalendar, name: "Destino", color: "#225566" });
  const impact = await queries.calendarImpact(owner, calendarId);
  await act({ action: "deleteCalendar", id: calendarId, expectedRevision: impact.revision, expectedDataRevision: impact.dataRevision, destinationId: movedCalendar });
  check("Eliminar calendario trasladando conserva identidad y horario", (await item(root)).schedule?.calendarId === movedCalendar);
  const seriesId = randomUUID(); await act({ action: "createRecurringTask", id: seriesId, title: "Rutina", description: null, schedule: schedule("2026-11-02", "09:00", movedCalendar), rule: { frequency: "WEEKLY", interval: 1, weekdays: [1,2,5], untilDate: null } });
  async function seriesItems() { return (await agenda()).items.filter(row => row.recurrence?.seriesId === seriesId); }
  const countBefore = await db.activity.count({ where: { userId: owner } }); await seriesItems(); check("Leer recurrencia no materializa futuro", await db.activity.count({ where: { userId: owner } }) === countBefore);
  async function seriesChange(row: ActivityView | ActivityView["children"][number], action: string, scope: "this" | "following" | "all", body: Record<string, unknown>) {
    const current = (await seriesItems()).flatMap(value => [value, ...value.children]).find(value => value.id === row.id)!;
    return act({ action, id: current.id, expectedRevision: current.revision, scope, ...(scope !== "this" ? { expectedSeriesRevision: current.recurrence!.seriesRevision } : {}), ...(current.recurrence?.virtual ? { occurrence: { seriesId, ordinal: current.recurrence.ordinal, seriesRevision: current.recurrence.seriesRevision } } : {}), ...body });
  }
  let rows = await seriesItems(), monday = rows.find(row => row.schedule?.startsAt?.startsWith("2026-11-02"))!, tuesday = rows.find(row => row.schedule?.startsAt?.startsWith("2026-11-03"))!;
  const subId = randomUUID(); await act({ action: "createTask", id: subId, title: "Agua", description: null, position: 0, parentId: monday.id, expectedParentRevision: monday.revision, scope: "all", expectedSeriesRevision: monday.recurrence!.seriesRevision, occurrence: { seriesId, ordinal: monday.recurrence!.ordinal, seriesRevision: monday.recurrence!.seriesRevision } });
  rows = await seriesItems(); check("Agregar subtarea en toda serie propaga su clave", rows.every(row => row.children.some(child => child.title === "Agua")));
  tuesday = rows.find(row => row.id === tuesday.id)!; const key = tuesday.children[0].stepKeyId;
  await seriesChange(tuesday.children[0], "setCompleted", "following", { completed: true });
  rows = await seriesItems(); check("Marca de subtarea alcanza siguientes por clave", rows.filter(row => row.recurrence!.ordinal >= tuesday.recurrence!.ordinal).every(row => row.children.find(child => child.stepKeyId === key)?.completedAt));
  tuesday = rows.find(row => row.id === tuesday.id)!; await seriesChange(tuesday, "scheduleTask", "this", { schedule: schedule("2026-11-03", "11:00", movedCalendar) });
  monday = (await seriesItems()).find(row => row.id === monday.id)!;
  await seriesChange(monday, "changeRecurrence", "all", { seriesId, ordinal: monday.recurrence!.ordinal, expectedDataRevision: await revision(), rule: { frequency: "WEEKLY", interval: 1, weekdays: [1,5], untilDate: null } });
  rows = await seriesItems(); check("Nueva frecuencia conserva martes modificado ligado", rows.some(row => row.id === tuesday.id && row.schedule?.startsAt?.startsWith("2026-11-03")));
  await seriesChange(rows[0], "deleteTask", "all", {}); check("Borrar toda la serie incluye sus excepciones", !(await seriesItems()).length);
  const monthly = expandRecurrence({ anchorLocal: "2027-01-31T10:00", rule: { frequency:"MONTHLY",interval:1,weekdays:[],untilDate:null }, startDate:"2027-01-01",endDate:"2027-04-01" });
  check("Día 31 se ajusta en febrero y vuelve al 31", monthly.items.map(row=>row.date).join(",") === "2027-01-31,2027-02-28,2027-03-31");
  const leap = expandRecurrence({ anchorLocal:"2028-02-29T10:00",rule:{frequency:"YEARLY",interval:1,weekdays:[],untilDate:null},startDate:"2029-01-01",endDate:"2030-01-01" });
  check("29 de febrero se ajusta al último día", leap.items[0].date === "2029-02-28");
  await change(root, "deleteTask"); check("Borrar principal retira todos los hijos y horarios", !await db.activity.count({ where:{userId:owner,lifecycle:"active",OR:[{id:root},{parentId:root}]} }));
  }

  stage = "Recetas, alacena, consumo y sobras";
  await cook({action:"initializeKitchen"}); const initial = await planner.snapshot(owner,"2026-11-02",7), slotId = initial.slots[0].id;
  check("Cocina inicializa tres filas personales", initial.slots.length === 3);
  const pieces = randomUUID(), liquid = randomUUID();
  for(const [id,name,unit] of [[pieces,"Revisión piezas","piece"],[liquid,"Revisión líquido","ml"]]) await pantry.execute(owner,command({action:"createIngredient",id,name,unit,confirmSimilar:true}));
  async function stock(id:string, quantity:string) { const ingredient = await db.ingredient.findUniqueOrThrow({where:{id}}), balance = await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}}); return pantry.execute(owner,command({action:"setPantryQuantity",id,expectedIngredientRevision:ingredient.revision,expectedBalanceRevision:balance?.revision??null,quantity,listed:true})); }
  const balance = async(id:string)=>(await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}}))?.quantity.toString()??"0";
  await stock(pieces,"20"); await stock(liquid,"1000");
  await rejected("Unidad con movimientos no se puede cambiar",()=>pantry.execute(owner,command({action:"editIngredient",id:pieces,expectedRevision:0,name:"Revisión piezas",unit:"g",confirmSimilar:true})),"DEPENDENCY");
  await rejected("Ingrediente privado de otro usuario no se puede usar",()=>pantry.execute(other,command({action:"setPantryQuantity",id:pieces,expectedIngredientRevision:0,expectedBalanceRevision:null,quantity:"1",listed:true})),"NOT_FOUND");
  const recipeId=randomUUID(),requiredKey=randomUUID(),optionalKey=randomUUID();
  const recipeBody={name:"Revisión receta",description:null,draft:false,baseServings:"1",cookingMinutes:10,steps:[{stepKey:requiredKey,text:"Agregar",optional:false,ingredientId:pieces,expectedIngredientRevision:0,quantity:"2",equivalent:"dos piezas",minutesBefore:720,priorTitle:"Preparar ingrediente"},{stepKey:optionalKey,text:"Servir",optional:true,ingredientId:liquid,expectedIngredientRevision:0,quantity:"50",equivalent:"un chorrito",minutesBefore:null,priorTitle:null}]};
  stage="Crear receta borrador";
  const draft=await recipes.execute(owner,command({action:"createRecipe",id:recipeId,recipe:{...recipeBody,baseServings:null,cookingMinutes:null,steps:[]}})); check("Receta incompleta es borrador automáticamente",draft.item?.draft);
  const saved=await recipes.execute(owner,command({action:"editRecipe",id:recipeId,expectedRevision:draft.item!.revision,recipe:recipeBody})); let version=saved.item!;
  check("Datos mínimos habilitan receta y equivalencias",!version.draft&&version.steps[0].equivalent==="dos piezas");
  function mealBody(id:string,date:string,cooked="4",eaten="1",cookingEnabled=true){return {action:"saveMeal",id,expectedRevision:null,date,time:"10:00",slotId,cookingEnabled,eatingEnabled:true,washingEnabled:true,eatingMinutes:20,washingMinutes:10,cookingMinutesOverride:null,recipes:[{id:randomUUID(),recipeRevisionId:version.revisionId,cookedServings:cooked,eatenServings:eaten,cookingMinutesOverride:null}],reminders:[]};}
  const origin=randomUUID(),later=randomUUID(),originBody=mealBody(origin,"2026-11-02"); await cook(originBody); await cook(mealBody(later,"2026-11-03","0","2",false));
  check("Planificar no descuenta inventario",await balance(pieces)==="20");
  let plan=await planner.snapshot(owner,"2026-11-02",7); check("Sin cocinar reserva sobrante previsto de origen",plan.availability[later].dependencies.some(dep=>dep.mealId===origin&&!dep.real));
  await rejected("No consumir porciones solamente previstas",()=>change(later,"setCompleted",{completed:true}),"DEPENDENCY");
  await change(origin,"setCompleted",{completed:true,optionalStepIds:[]}); check("Cocinar cuatro descuenta ocho piezas, opcional omitido",await balance(pieces)==="12"&&await balance(liquid)==="1000");
  plan=await planner.snapshot(owner,"2026-11-02",7); check("Tanda real deja tres porciones disponibles",plan.resources.realBatches?.some(batch=>batch.mealId===origin&&batch.quantity==="3"));
  await change(later,"setCompleted",{completed:true}); check("Comer sobras no descuenta ingredientes",await balance(pieces)==="12");
  plan=await planner.snapshot(owner,"2026-11-02",7); check("Comida registra origen y queda una porción",plan.meals.find(meal=>meal.id===later)?.portionSources.some(source=>source.mealId===origin&&source.quantity==="2")&&plan.resources.realBatches?.some(batch=>batch.mealId===origin&&batch.quantity==="1"));
  await rejected("No deshacer cocina con sobras consumidas",()=>change(origin,"setCompleted",{completed:false}),"DEPENDENCY");
  await change(later,"setCompleted",{completed:false}); await change(origin,"setCompleted",{completed:false}); check("Deshacer devuelve el consumo exacto",await balance(pieces)==="20"&&await balance(liquid)==="1000");
  const optional=(await item(origin)).children.find(child=>child.mealOptional)!;
  await change(origin,"setCompleted",{completed:true,optionalStepIds:[optional.id]}); check("Opcional se escala una sola vez por porciones cocinadas",await balance(liquid)==="800");
  await change(origin,"setCompleted",{completed:false}); check("Deshacer devuelve el opcional usado",await balance(liquid)==="1000");
  const required=(await item(origin)).children.find(child=>child.mealRole==="preparation"&&!child.mealOptional)!; await change(required.id,"setCompleted",{completed:true}); check("Paso obligatorio final completa comida sin preguntar opcional",!!(await item(origin)).completedAt&&await balance(liquid)==="1000"); await change(origin,"setCompleted",{completed:false});
  await recipes.execute(owner,command({action:"editRecipe",id:recipeId,expectedRevision:version.revision,recipe:{...recipeBody,name:"Revisión v2",cookingMinutes:15}}));
  check("Editar recetario no cambia versión planificada",(await planner.cell(owner,"2026-11-02",slotId)).meal!.recipes[0].recipeRevisionId===version.revisionId);
  check("Cocina combinada se redondea hacia arriba a cinco",mealDuration({cookingEnabled:true,eatingEnabled:false,washingEnabled:false,eatingMinutes:0,washingMinutes:0,cookingMinutesOverride:null},[10,5]).total===15);
  await change(origin,"deleteTask"); await change(later,"deleteTask");

  stage = "Disponibilidad cronológica y compras";
  await stock(pieces,"2"); const distant=randomUUID(),near=randomUUID(); await cook(mealBody(distant,"2026-11-10","1","1")); await cook(mealBody(near,"2026-11-02","1","1"));
  plan=await planner.snapshot(owner,"2026-11-02",14); check("Plan cercano desplaza reserva del lejano",!plan.availability[near].shortages.some(s=>!s.optional)&&plan.availability[distant].shortages.some(s=>s.ingredientId===pieces&&s.quantity==="2"));
  let list=await shopping.snapshot(owner); check("Compras suma faltantes de ambas semanas",list.items.find(row=>row.ingredientId===pieces)?.quantity==="2");
  await buy({action:"saveShoppingQuantity",key:`i:${pieces}`,quantity:"12"}); await stock(liquid,"999"); check("Cantidad elegida sobrevive recálculo",(await shopping.snapshot(owner)).items.find(row=>row.ingredientId===pieces)?.quantity==="12");
  const purchase=command({action:"buyShoppingItems",expectedDataRevision:await revision(),items:[{key:`i:${pieces}`,quantity:"12"}]}); await shopping.execute(owner,purchase); await shopping.execute(owner,purchase); check("Compra reintentada aumenta Alacena solo una vez",await balance(pieces)==="14");
  list=await shopping.snapshot(owner); const receipt=list.purchased.find(row=>row.name==="Revisión piezas")!; await buy({action:"undoShoppingPurchase",id:receipt.id}); check("Deshacer compra resta cantidad registrada",await balance(pieces)==="2");
  const soap=randomUUID(); await buy({action:"addShoppingEntry",id:soap,ingredientId:null,expectedIngredientRevision:null,name:"Jabón",unit:"piezas",quantity:"1"}); list=await shopping.snapshot(owner); check("Artículos libres van al final",list.items.at(-1)?.id===soap);
  await buy({action:"buyShoppingItems",items:[{key:`e:${soap}`,quantity:"1"}]}); check("Comprar jabón no crea ingrediente",!await db.ingredient.count({where:{ownerUserId:owner,name:"Jabón"}}));
  list=await shopping.snapshot(owner); await buy({action:"undoShoppingPurchase",id:list.purchased.find(row=>row.name==="Jabón")!.id}); await buy({action:"removeShoppingEntry",id:soap});
  await change(near,"deleteTask"); plan=await planner.snapshot(owner,"2026-11-02",14); check("Borrar plan cercano libera reserva del lejano",!plan.availability[distant].shortages.some(s=>!s.optional));
  await change(distant,"deleteTask"); await stock(pieces,"0"); const missing=randomUUID(); await cook(mealBody(missing,"2026-11-02","0","2",false)); check("Sin Cocinar no añade ingredientes a Compras",!(await shopping.snapshot(owner)).items.some(row=>row.ingredientId===pieces)); await change(missing,"deleteTask");

  stage = "Copiar/borrar semanas y preparaciones";
  await stock(pieces,"20"); const copySource=randomUUID(),body=mealBody(copySource,"2026-11-02");
  body.reminders.push({mealRecipeId:body.recipes[0].id,stepKey:requiredKey,startsAt:"2026-11-01T22:00:00-06:00",endsAt:"2026-11-01T22:15:00-06:00",manual:true} as never);
  await cook(body); let source=(await planner.cell(owner,"2026-11-02",slotId)).meal!; const reminder=source.activity.children.find(child=>child.mealRole==="priorReminder")!;
  await change(reminder.id,"setCompleted",{completed:true}); check("Preparación previa no completa ni consume comida",!(await item(copySource)).completedAt&&await balance(pieces)==="20");
  await change(copySource,"scheduleTask",{schedule:schedule("2026-11-02","11:00",initial.calendarId!)}); check("Mover comida conserva preparación realizada",!!(await item(reminder.id)).completedAt);
  await change(copySource,"setCompleted",{completed:true,optionalStepIds:[]}); const stockBeforeCopy=await balance(pieces), preview=await planner.weekPreview(owner,"2026-11-09","copy");
  await cook({action:"copyPreviousMealWeek",start:"2026-11-09",expectedDataRevision:await revision(),reminders:[]});
  const copy=(await planner.snapshot(owner,"2026-11-09",7)).meals[0]; check("Copiar crea nuevas identidades pendientes sin consumos",copy.id!==copySource&&!copy.completedAt&&copy.activity.children.every(child=>!child.completedAt)&&await balance(pieces)===stockBeforeCopy);
  check("Copia mantiene receta, porciones y fases",copy.recipes[0].recipeRevisionId===source.recipes[0].recipeRevisionId&&copy.recipes[0].cookedServings==="4"&&copy.cookingEnabled);
  check("Preparaciones de copia no se aceptan automáticamente",copy.recipes[0].reminders.length===0);
  await rejected("No copiar sobre semana ocupada",async()=>cook({action:"copyPreviousMealWeek",start:"2026-11-09",expectedDataRevision:await revision(),reminders:[]}),"CONFLICT");
  await cook({action:"deleteMealWeek",start:"2026-11-02",expectedDataRevision:await revision()}); check("Borrar semana consumida mantiene stock y sobras reales",await balance(pieces)===stockBeforeCopy&&(await planner.snapshot(owner,"2026-11-09",7)).resources.realBatches?.some(batch=>batch.mealId===copySource));
  await cook({action:"deleteMealWeek",start:"2026-11-09",expectedDataRevision:await revision()}); check("Borrar semana pendiente libera compras",!(await shopping.snapshot(owner)).items.some(row=>row.ingredientId===pieces));

  const expiredMeal=randomUUID(); await cook(mealBody(expiredMeal,"2026-09-14","2","1"));
  await change(expiredMeal,"setCompleted",{completed:true,optionalStepIds:[]});
  const sixDaysAgo=new Date(Date.now()-6*86400000);
  await db.activity.updateMany({where:{userId:owner,OR:[{id:expiredMeal},{parentId:expiredMeal}],completedAt:{not:null}},data:{completedAt:sixDaysAgo}});
  const stockBeforeRetention=await balance(pieces); await cleanupCoreUser(db,owner);
  check("Retención de comida mantiene inventario y tanda real",(await db.activity.findUniqueOrThrow({where:{id:expiredMeal}})).lifecycle==="retired"&&await balance(pieces)===stockBeforeRetention&&await db.cookedBatch.count({where:{userId:owner,completion:{blockId:expiredMeal},quantity:{gt:0}}})>0);
  await stock(pieces,stockBeforeCopy);

  stage = "Sustitución de ingredientes y versiones";
  const replacement=randomUUID(); await pantry.execute(owner,command({action:"createIngredient",id:replacement,name:"Revisión sustituto",unit:"piece",confirmSimilar:true}));
  const replacePlan=randomUUID(); await cook(mealBody(replacePlan,"2026-11-16","1","1"));
  await pantry.execute(owner,command({action:"retireIngredient",id:pieces,expectedDataRevision:await revision(),replacementId:replacement,updatePending:true}));
  check("Sustitución traslada existencias sin duplicarlas",await balance(pieces)==="0"&&await balance(replacement)===stockBeforeCopy);
  source=(await planner.cell(owner,"2026-11-16",slotId)).meal!; check("Sustitución actualiza pendiente y conserva evidencia histórica",source.recipes[0].steps.some(step=>step.ingredientId===replacement)&&await db.inventoryMovement.count({where:{userId:owner,ingredientId:pieces}})>0);
  check("Sustitución conserva versión completada retirada",(await db.mealRecipe.findFirstOrThrow({where:{userId:owner,blockId:copySource},include:{recipeRevision:{include:{steps:true}}}})).recipeRevision.steps.some(step=>step.ingredientId===pieces));
  await change(replacePlan,"setCompleted",{completed:true,optionalStepIds:[]}); await change(replacePlan,"setCompleted",{completed:false}); check("Consumo y reversión después del reemplazo son exactos",await balance(replacement)===stockBeforeCopy);
  await change(replacePlan,"deleteTask");
  await stock(replacement,"0"); await pantry.execute(owner,command({action:"retireIngredient",id:replacement,expectedDataRevision:await revision(),replacementId:null,updatePending:false}));
  version=(await recipes.snapshot(owner)).items.find(row=>row.id===recipeId)!; check("Retirar ingrediente conserva texto del paso",version.steps.some(step=>step.stepKey===requiredKey&&!step.ingredientId&&step.text==="Agregar"));
  check("Otra cuenta no ve recetas ni inventario privado",!(await recipes.snapshot(other)).items.length&&!(await pantry.snapshot(other)).items.length);
  check("Todos los saldos y cantidades de sobras permanecen no negativos",!await db.pantryBalance.count({where:{quantity:{lt:0}}})&&!await db.cookedBatch.count({where:{quantity:{lt:0}}}));
  }
  console.log(`DONE ${checks.length} comprobaciones`);
} catch(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).replace(/[^A-Z0-9_]/gi,"").slice(0,32) : "ERROR";
  function errorCodes(value: unknown, depth=0): string[] {
    if(!value||typeof value!=="object"||depth>5)return [];
    return Object.entries(value).flatMap(([key,entry]) => ["code","originalCode","kind","constraint","name","column","modelName","columnName"].includes(key)&&typeof entry==="string"&&/^[A-Za-z0-9_.]{1,150}$/.test(entry) ? [`${key}:${entry}`] : key==="originalMessage"&&typeof entry==="string"?[entry.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,"REDACTED").slice(0,300)]:["meta","cause","driverAdapterError"].includes(key)?errorCodes(entry,depth+1):[]);
  }
  report.failure = error instanceof assert.AssertionError ? error.message : `${stage}: ${code}`;
  console.error(`FAIL ${report.failure} ${errorCodes(error).join(" ")}`); process.exitCode=1;
} finally {
  await client?.$disconnect();
  if(created) { assert.match(schema,/^miagenda_integral_test_[a-f0-9]{32}$/); await admin.query("ROLLBACK"); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); report.temporarySchemaRemoved=true; console.log("Esquema temporal eliminado"); }
  await admin.end(); writeFileSync(process.argv.includes("--isolation")?"reconstruction/core/isolation-verification.json":"reconstruction/core/integral-verification.json",JSON.stringify(report,null,2)+"\n");
}
