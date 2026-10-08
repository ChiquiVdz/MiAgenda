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
import { localInstant, shiftDate } from "./src/local-time.ts";
import { occurrenceId, stepActivityId } from "./src/series-runtime.ts";
import type { ActivityView } from "./src/views.ts";
import { identityAdapter } from "./src/authentication.ts";

// Explicitly authorized integration review. All fixtures, transactions and SQL
// run in a random temporary namespace; public app data and sessions are untouched.
const schema = `miagenda_integral_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^miagenda_integral_test_[a-f0-9]{32}$/);
const connectionString = coreDatabaseUrl(), admin = new pg.Client({ connectionString });
// A sleeping PC or closed Neon connection must not abort cleanup/reporting.
admin.on("error", () => {});
let client: PrismaClient | undefined, created = false;
const checks: string[] = [];
const report = { at: new Date().toISOString(), schema, passed: checks, failure: null as string | null, temporarySchemaRemoved: false };
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
  const owner = randomUUID(), other = randomUUID();
  await db.user.create({ data: { id: owner, name: "Integral verification", email:"revision@example.invalid", timeZone: "America/Mexico_City" } });
  await db.user.create({ data: { id: other, name: "Other verification owner", timeZone: "America/Mexico_City" } });
  check("SQL sin calificar y Prisma comparten solo los usuarios de prueba", (await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM users`)[0].count===2n);
  const testToken=randomUUID(); await db.session.create({data:{userId:owner,sessionToken:testToken,expires:new Date(Date.now()+86400000)}});
  check("Acceso encuentra sesión y propietario",(await identityAdapter(db).getSessionAndUser!(testToken))?.user.id===owner);
  await db.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL search_path = pg_catalog`;
    check("Acceso no depende del search_path compartido",(await identityAdapter(tx as unknown as PrismaClient).getSessionAndUser!(testToken))?.user.id===owner);
  });
  {
  const service = new ActivityService(db), queries = new ActivityQueries(db), pantry = new PantryService(db), recipes = new RecipeService(db), planner = new PlannerService(db), shopping = new ShoppingService(db);
  const revision = async () => (await db.user.findUniqueOrThrow({ where: { id: owner }, select: { dataRevision: true } })).dataRevision.toString();
  const command = (body: Record<string, unknown>) => ({ commandId: randomUUID(), ...body });
  const act = (body: Record<string, unknown>) => service.execute(owner, command(body));
  const cook = (body: Record<string, unknown>) => planner.execute(owner, command(body));
  const buy = async (body: Record<string, unknown>) => shopping.execute(owner, command({ expectedDataRevision: await revision(), ...body }));
  const item = async (id: string) => (await queries.detail(owner, id)).item;
  const change = async (id: string, action: string, body: Record<string, unknown> = {}) => act({ action, id, expectedRevision: (await item(id)).revision, ...body });
  async function rejected(name: string, read: () => Promise<unknown>, code: string) { let observed: unknown; try { await read(); } catch (error) { observed = (error as { code?: string }).code; } check(name, observed === code); }

  await cook({action:"initializeKitchen"});
  const slotId=(await planner.snapshot(owner,"2027-01-04",7)).slots[0].id;
  async function stock(id:string, quantity:string) {
    const ingredient=await db.ingredient.findUniqueOrThrow({where:{id}}), balance=await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}});
    return pantry.execute(owner,command({action:"setPantryQuantity",id,expectedIngredientRevision:ingredient.revision,expectedBalanceRevision:balance?.revision??null,quantity,listed:true}));
  }
  const balance=async(id:string)=>(await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}}))?.quantity.toString()??"0";

    stage="Subtareas recurrentes y calendario heredado";
    const ca=randomUUID(),cb=randomUUID();
    for(const [id,name] of [[ca,"Prueba calendario A"],[cb,"Prueba calendario B"]])await act({action:"createCalendar",id,name,color:"#22aa44"});
    const timed=(date:string,time="08:00",minutes=15,calendarId=ca)=>{const startsAt=localInstant(date,time,"America/Mexico_City");return {mode:"timed",calendarId,timeZone:"America/Mexico_City",startsAt,endsAt:new Date(Date.parse(startsAt)+minutes*60000).toISOString()};};
    const agenda=async(start="2027-03-01",end="2027-03-15",calendarIds=[ca,cb])=>(await queries.agenda(owner,{startDate:start,endDate:end,startsAt:localInstant(start,"00:00","America/Mexico_City"),endsAt:localInstant(end,"00:00","America/Mexico_City"),calendarIds,limit:100})).items;
    async function fresh(id:string):Promise<ActivityView>{const found=(await agenda()).find(row=>row.id===id);return found??await item(id);}
    async function scopeChange(id:string,action:string,scope="this",body:Record<string,unknown>={}){
      const row=await fresh(id);return act({action,id,expectedRevision:row.revision,scope,...(scope!=="this"?{expectedSeriesRevision:row.recurrence!.seriesRevision}:{}),...(row.recurrence?.virtual?{occurrence:{seriesId:row.recurrence.seriesId,ordinal:row.recurrence.ordinal,seriesRevision:row.recurrence.seriesRevision}}:{}),...body});
    }
    const series=randomUUID(),key=randomUUID();
    await act({action:"createRecurringTask",id:series,title:"Prueba rutina",description:null,schedule:timed("2027-03-01","07:00",60),rule:{frequency:"DAILY",interval:1,weekdays:[],untilDate:"2027-03-14"}});
    const root=(n:number)=>occurrenceId(series,n),child=(n:number)=>n===0?key:stepActivityId(series,n,key);
    await scopeChange(root(0),"addSubtasks","all",{children:[{id:key,title:"Prueba bañarme"}]});
    check("Agregar subtareas a toda la serie no materializa el futuro",await db.occurrenceOverride.count({where:{userId:owner,seriesId:series}})===1);
    await scopeChange(child(0),"scheduleTask","all",{schedule:timed("2027-03-01","08:00",15,cb)});
    let rows=await agenda();
    check("Horario de toda la serie aparece en las catorce subtareas",rows.filter(r=>r.parentId&&r.recurrence?.seriesId===series).length===14);
    check("Subtareas futuras heredan calendario aunque el comando elija otro",rows.filter(r=>r.parentId).every(r=>r.schedule?.calendarId===ca&&r.parentCalendarId===ca));
    await scopeChange(child(1),"editTask","this",{title:"Prueba nombre modificado"});
    await scopeChange(child(2),"deleteTask");
    await scopeChange(child(3),"setCompleted","this",{completed:true});
    const oldCompleted=(await fresh(child(3))).schedule!.startsAt;
    await scopeChange(child(4),"scheduleTask","following",{schedule:timed("2027-03-05","09:00")});
    check("Esta y siguientes conserva hora anterior",(await fresh(child(1))).schedule?.startsAt===timed("2027-03-02").startsAt);
    check("Esta y siguientes cambia la hora futura",(await fresh(child(8))).schedule?.startsAt===timed("2027-03-09","09:00").startsAt);
    await scopeChange(child(0),"scheduleTask","all",{schedule:timed("2027-03-01","10:00")});
    check("Renombrada se actualiza por identidad",(await fresh(child(1))).title==="Prueba nombre modificado"&&(await fresh(child(1))).schedule?.startsAt===timed("2027-03-02","10:00").startsAt);
    check("Eliminada no reaparece al programar toda la serie",!(await agenda()).some(row=>row.id===child(2)));
    check("Completada materializada conserva hora",(await fresh(child(3))).schedule?.startsAt===oldCompleted);
    await scopeChange(child(6),"scheduleTask","this",{schedule:timed("2027-03-07","11:00")});
    check("Solo esta cambia únicamente esa subtarea",(await fresh(child(6))).schedule?.startsAt===timed("2027-03-07","11:00").startsAt&&(await fresh(child(7))).schedule?.startsAt===timed("2027-03-08","10:00").startsAt);
    await scopeChange(child(6),"unscheduleTask");
    check("Quitar solo esta conserva casilla y deja otra instancia agendada",!(await item(child(6))).schedule&&(await fresh(child(7))).schedule!==null);
    await scopeChange(child(8),"unscheduleTask","following");
    check("Quitar siguientes omite futuro y conserva anteriores",!(await agenda()).some(r=>r.parentId&&r.recurrence?.seriesId===series&&r.recurrence.ordinal>=8)&&(await fresh(child(7))).schedule!==null);
    await scopeChange(child(0),"unscheduleTask","all");
    check("Quitar toda la serie conserva horario completado",(await agenda()).filter(r=>r.parentId&&r.recurrence?.seriesId===series).map(r=>r.id).join()===child(3));
    check("Quitar horario conserva subtareas pendientes en la principal",(await fresh(root(9))).children.some(r=>r.stepKeyId===key&&!r.schedule&&!r.completedAt));
    await scopeChange(child(0),"scheduleTask","all",{schedule:timed("2027-02-28","23:45",30)});
    check("Programación del día anterior cruza el borde de mes",(await agenda("2027-02-28","2027-03-01")).some(r=>r.id===child(0)));
    check("No se crean instancias indefinidamente al consultar",await db.occurrenceOverride.count({where:{userId:owner,seriesId:series}})<14);
    await scopeChange(root(0),"scheduleTask","all",{schedule:timed("2027-03-01","07:00",60,cb)});
    rows=await agenda("2027-02-28","2027-03-15");
    check("Cambiar calendario de serie mueve hijos pendientes y completados",rows.filter(r=>r.parentId).every(r=>r.schedule?.calendarId===cb&&r.parentCalendarId===cb));
    check("Cambiar calendario conserva horario y marca completada",(await fresh(child(3))).schedule?.startsAt===oldCompleted&&!!(await fresh(child(3))).completedAt);
    check("Filtrar calendario anterior oculta toda la familia",!(await agenda("2027-02-28","2027-03-15",[ca])).some(r=>r.recurrence?.seriesId===series));
    check("Filtrar calendario nuevo incluye hijos fuera del día del padre",(await agenda("2027-02-28","2027-03-01",[cb])).some(r=>r.id===child(0)));
    const info=await queries.recurrence(owner,series,0),r0=await fresh(root(0));
    await act({action:"changeRecurrence",id:r0.id,expectedRevision:r0.revision,scope:"all",expectedSeriesRevision:r0.recurrence!.seriesRevision,seriesId:series,ordinal:0,expectedDataRevision:await revision(),rule:{frequency:"WEEKLY",interval:1,weekdays:[1,5],untilDate:"2027-03-14"}});
    check("Cambiar frecuencia conserva reglas horarias de hijos nuevos",(await agenda()).filter(r=>r.parentId&&!r.completedAt).every(r=>r.schedule?.calendarId===cb));
    await scopeChange(root(0),"deleteTask","all");
    check("Borrar toda la serie retira excepciones e hijos programados",!(await agenda("2027-02-28","2027-03-15")).some(r=>r.recurrence?.seriesId===series));
    const inboxId=randomUUID(),inboxChild=randomUUID();
    await act({action:"createTask",id:inboxId,title:"Prueba Inbox",description:null,position:0,parentId:null,expectedParentRevision:null});
    await change(inboxId,"addSubtasks",{children:[{id:inboxChild,title:"Prueba hijo independiente"}]});
    await change(inboxChild,"scheduleTask",{schedule:timed("2027-03-01","12:00",15,cb)});
    check("Principal sin horario permite elegir calendario del hijo",(await item(inboxChild)).schedule?.calendarId===cb&&!(await item(inboxChild)).parentCalendarId);
    check("Inbox conserva su principal y Agenda muestra solo hijo programado",(await queries.inbox(owner)).items.some(r=>r.id===inboxId)&&(await agenda()).some(r=>r.id===inboxChild)&&!(await agenda()).some(r=>r.id===inboxId));
    await change(inboxChild,"setCompleted",{completed:true});
    await change(inboxId,"scheduleTask",{schedule:timed("2027-03-01","07:00",60,ca)});
    check("Agendar principal desde Inbox adopta calendario incluso hijo completado",(await item(inboxChild)).schedule?.calendarId===ca&&(await item(inboxChild)).parentCalendarId===ca&&!!(await item(inboxChild)).completedAt);
    check("Agendar conserva hora del hijo",(await item(inboxChild)).schedule?.startsAt===timed("2027-03-01","12:00").startsAt);
    await change(inboxId,"unscheduleTask");
    check("Volver a Inbox libera elección sin quitar horario hijo",!(await item(inboxChild)).parentCalendarId&&(await item(inboxChild)).schedule!==null);
    await change(inboxChild,"scheduleTask",{schedule:timed("2027-03-01","12:00",15,cb)});
    check("Hijo de Inbox vuelve a admitir otro calendario",(await item(inboxChild)).schedule?.calendarId===cb);
    await change(inboxId,"deleteTask");

    stage="Preparaciones previas y cruces de Cocina";
    const grain=randomUUID(),extra=randomUUID(),salt=randomUUID();
    for(const [id,name,unit,trackingMode] of [[grain,"Prueba avena","g","quantity"],[extra,"Prueba miel","g","quantity"],[salt,"Prueba canela","g","availability"]])await pantry.execute(owner,command({action:"createIngredient",id,name,unit,trackingMode,confirmSimilar:true}));
    const keys=Array.from({length:6},()=>randomUUID()),recipeId=randomUUID();
    const recipe={description:null,name:"Prueba overnight",baseServings:"1",cookingMinutes:10,steps:keys.map((stepKey,i)=>({stepKey,text:`Prueba paso ${"ABCDEF"[i]}`,optional:i===1||i===3,ingredientId:i===0?grain:i===1?extra:i===3?salt:null,expectedIngredientRevision:[0,1,3].includes(i)?0:null,quantity:i===0?"20":i===1?"5":null,equivalent:i===3?"al gusto":null,minutesBefore:i===2?660:i===4?60:null,priorTitle:i===2?"Prueba paso C":i===4?"Prueba paso E":null,priorGroup:i===2||i===4}))};
    const definition=(await recipes.execute(owner,command({action:"createRecipe",id:recipeId,recipe}))).item!;
    check("Crear receta permite tramos previos sin guardado intermedio",definition.steps.filter(s=>s.priorGroup).length===2&&!definition.draft);
    const mealId=randomUUID(),dishId=randomUUID();
    const mealBody={action:"saveMeal",id:mealId,expectedRevision:null as number|null,date:"2027-04-05",time:"08:00",slotId,cookingEnabled:true,eatingEnabled:true,washingEnabled:true,eatingMinutes:20,washingMinutes:5,cookingMinutesOverride:null,recipes:[{id:dishId,recipeRevisionId:definition.revisionId,cookedServings:"1",eatenServings:"1",cookingMinutesOverride:null}],reminders:[{mealRecipeId:dishId,stepKey:keys[2],startsAt:timed("2027-04-04","21:00").startsAt,endsAt:timed("2027-04-04","21:00",5).endsAt,manual:false},{mealRecipeId:dishId,stepKey:keys[4],startsAt:timed("2027-04-05","07:00").startsAt,endsAt:timed("2027-04-05","07:00",5).endsAt,manual:false}]};
    await cook(mealBody);
    const step=async(i:number)=>(await item(mealId)).children.find(s=>s.title===`Prueba paso ${"ABCDEF"[i]}`)!;
    check("Agendar tramo reutiliza paso sin duplicar casilla",(await item(mealId)).children.length===6&&(await item(mealId)).children.filter(s=>s.schedule).length===2);
    check("Preparaciones quedan programadas cinco minutos",[await step(2),await step(4)].every(s=>Date.parse(s.schedule!.endsAt!)-Date.parse(s.schedule!.startsAt!)===300000));
    check("Lectura independiente de Agenda conserva padre y calendario heredado",(await queries.agenda(owner,{startDate:"2027-04-04",endDate:"2027-04-06",startsAt:localInstant("2027-04-04","00:00","America/Mexico_City"),endsAt:localInstant("2027-04-06","00:00","America/Mexico_City"),limit:100})).items.filter(s=>s.parentId===mealId).every(s=>s.mealPriorGroup&&s.parentCalendarId===s.schedule?.calendarId));
    await rejected("No permite completar segundo tramo antes del primero",async()=>change((await step(4)).id,"setCompleted",{completed:true}),"DEPENDENCY");
    check("Rechazo de orden no modifica pasos",(await item(mealId)).children.every(s=>!s.completedAt));
    await change((await step(2)).id,"setCompleted",{completed:true});
    check("Completar C marca A y C sin asumir opcional B",!!(await step(0)).completedAt&&!!(await step(2)).completedAt&&!(await step(1)).completedAt);
    check("Tramo previo no completa comida ni descuenta sin existencias",!(await item(mealId)).completedAt&&await balance(grain)==="0"&&await db.inventoryMovement.count({where:{userId:owner,ingredientId:grain}})===0);
    let list=await shopping.snapshot(owner);
    check("Compras conserva obligación y opcional tras tramo previo",list.items.some(s=>s.ingredientId===grain&&s.required==="20")&&list.items.some(s=>s.ingredientId===extra&&s.optional==="5"));
    await change((await step(4)).id,"setCompleted",{completed:true});
    check("Completar E no marca opcional disponibilidad ni termina comida",!!(await step(4)).completedAt&&!(await step(3)).completedAt&&!(await item(mealId)).completedAt);
    await rejected("No permite deshacer C con E realizado",async()=>change((await step(2)).id,"setCompleted",{completed:false}),"DEPENDENCY");
    await rejected("Comida con opcionales exige selección al finalizar",()=>change(mealId,"setCompleted",{completed:true}),"DEPENDENCY");
    await buy({action:"buyShoppingItems",items:[{key:`i:${grain}`,quantity:"40"},{key:`i:${extra}`,quantity:"10"}]});
    check("Compra registrada aumenta Alacena y elimina faltantes",await balance(grain)==="40"&&await balance(extra)==="10"&&!(await shopping.snapshot(owner)).items.some(s=>s.ingredientId===grain));
    const completionCommand=command({action:"setCompleted",id:mealId,expectedRevision:(await item(mealId)).revision,completed:true,optionalStepIds:[(await step(1)).id]});
    await service.execute(owner,completionCommand);await service.execute(owner,completionCommand);
    check("Finalizar y reintentar consume obligatorio y opcional una vez",await balance(grain)==="20"&&await balance(extra)==="5"&&await db.mealCompletion.count({where:{userId:owner,blockId:mealId,reversedAt:null}})===1);
    check("Solo opcionales seleccionados quedan realizados al finalizar",!!(await step(1)).completedAt&&!(await step(3)).completedAt&&!!(await item(mealId)).completedAt);
    check("Planificador refleja completado de Agenda",!!(await planner.cell(owner,mealBody.date,slotId)).meal?.completedAt);
    check("Compras no incluye ingredientes de comida completada",!(await shopping.snapshot(owner)).items.some(s=>([grain,extra] as string[]).includes(s.ingredientId??"")));
    await rejected("Corregir tramo consumido requiere deshacer comida",async()=>change((await step(4)).id,"setCompleted",{completed:false}),"DEPENDENCY");
    await change(mealId,"setCompleted",{completed:false});
    check("Deshacer devuelve cantidades exactas y conserva tramos previos",await balance(grain)==="40"&&await balance(extra)==="10"&&!!(await step(2)).completedAt&&!!(await step(4)).completedAt&&!(await step(5)).completedAt);
    const firstTime=(await step(2)).schedule!.startsAt,secondTime=(await step(4)).schedule!.startsAt;
    mealBody.date="2027-04-06";mealBody.expectedRevision=(await item(mealId)).revision;
    mealBody.reminders=mealBody.reminders.map(reminder=>({...reminder,startsAt:new Date(Date.parse(reminder.startsAt)+86400000).toISOString(),endsAt:new Date(Date.parse(reminder.endsAt)+86400000).toISOString()}));
    await cook(mealBody);
    check("Mover comida conserva horarios de tramos completados",(await step(2)).schedule!.startsAt===firstTime&&(await step(4)).schedule!.startsAt===secondTime);
    await change((await step(4)).id,"setCompleted",{completed:false});await change((await step(2)).id,"setCompleted",{completed:false});
    check("Deshacer tramos en orden no devuelve inventario adicional",await balance(grain)==="40"&&await balance(extra)==="10"&&(await item(mealId)).children.every(s=>!s.completedAt));
    await change((await step(2)).id,"unscheduleTask");
    check("Quitar horario de preparación conserva identidad y casilla",!(await step(2)).schedule&&(await item(mealId)).children.length===6);
    await change((await step(2)).id,"scheduleTask",{schedule:timed("2027-04-05","21:00",5,ca)});
    check("Reagendar cinco minutos hereda Cocina aunque se solicite otro",(await step(2)).schedule?.calendarId===(await item(mealId)).schedule?.calendarId&&Date.parse((await step(2)).schedule!.endsAt!)-Date.parse((await step(2)).schedule!.startsAt!)===300000);
    await change((await step(2)).id,"setCompleted",{completed:true});await change((await step(4)).id,"setCompleted",{completed:true});
    await change((await step(5)).id,"setCompleted",{completed:true});
    check("Paso final permite completar solo obligatorios sin opcionales",!!(await item(mealId)).completedAt&&await balance(grain)==="20"&&await balance(extra)==="10");
    await change(mealId,"setCompleted",{completed:false});
    const optionalOnly=recipe.steps.map(s=>({...s,optional:s.stepKey===keys[0]||s.optional,priorGroup:s.stepKey===keys[0],minutesBefore:s.stepKey===keys[0]?60:null,priorTitle:s.stepKey===keys[0]?s.text:null}));
    const firstPrior=(await recipes.execute(owner,command({action:"createRecipe",id:randomUUID(),recipe:{...recipe,name:"Prueba previo primero",steps:optionalOnly}}))).item!;
    check("Primer paso puede ser un tramo previo",firstPrior.steps[0].priorGroup);
    await change(mealId,"deleteTask");
    check("Retirar comida pendiente libera Agenda y compras sin alterar Alacena",await balance(grain)==="40"&&await balance(extra)==="10"&&!(await shopping.snapshot(owner)).items.some(s=>([grain,extra] as string[]).includes(s.ingredientId??"")));

  }
  console.log(`DONE ${checks.length} comprobaciones`);
} catch(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).replace(/[^A-Z0-9_]/gi,"").slice(0,32) : "ERROR";
  function errorCodes(value: unknown, depth=0): string[] {
    if(!value||typeof value!=="object"||depth>5)return [];
    return Object.entries(value).flatMap(([key,entry]) => ["code","originalCode","kind","constraint","name","column","modelName","columnName"].includes(key)&&typeof entry==="string"&&/^[A-Za-z0-9_.]{1,150}$/.test(entry) ? [`${key}:${entry}`] : key==="originalMessage"&&typeof entry==="string"?[entry.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,"REDACTED").slice(0,300)]:["meta","cause","driverAdapterError"].includes(key)?errorCodes(entry,depth+1):[]);
  }
  report.failure = error instanceof assert.AssertionError ? error.message : `${stage}: ${code} ${error instanceof Error ? error.message.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,"REDACTED").slice(0,300) : ""}`;
  console.error(`FAIL ${report.failure} ${errorCodes(error).join(" ")}`); process.exitCode=1;
} finally {
  await client?.$disconnect();
  if(created) {
    assert.match(schema,/^miagenda_integral_test_[a-f0-9]{32}$/);
    const cleanup = new pg.Client({connectionString,connectionTimeoutMillis:10000});
    cleanup.on("error",()=>{});
    try { await cleanup.connect(); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); report.temporarySchemaRemoved=true; console.log("Esquema temporal eliminado"); }
    catch { report.failure??="No se pudo eliminar el esquema temporal";process.exitCode=1;console.error("Limpieza temporal pendiente; consulta schema en el informe."); }
    finally { await cleanup.end(); }
  }
  await admin.end(); writeFileSync("reconstruction/core/subtasks-preparations-verification.json",JSON.stringify(report,null,2)+"\n");
}
