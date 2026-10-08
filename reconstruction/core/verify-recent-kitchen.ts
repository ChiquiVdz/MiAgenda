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
  {
    stage = "Cantidades elegidas y disponibilidad: últimos bloques";
    const egg=randomUUID(), flour=randomUUID(), seasoning=randomUUID(), garnish=randomUUID();
    for(const [id,name,unit,trackingMode] of [[egg,"Prueba huevo","piece","quantity"],[flour,"Prueba harina","g","quantity"],[seasoning,"Prueba sal","g","availability"],[garnish,"Prueba salsa","ml","availability"]])
      await pantry.execute(owner,command({action:"createIngredient",id,name,unit,trackingMode,confirmSimilar:true}));
    async function tracking(id:string,mode:"quantity"|"availability",available:boolean,quantity:string|null=null) {
      const ingredient=await db.ingredient.findUniqueOrThrow({where:{id}}), preference=await db.ingredientPreference.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}}), row=await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}});
      return pantry.execute(owner,command({action:"setIngredientTracking",id,mode,available,quantity,listed:true,expectedIngredientRevision:ingredient.revision,expectedPreferenceRevision:preference?.revision??null,expectedBalanceRevision:row?.revision??null}));
    }
    const isAvailable=async(id:string)=>(await db.pantryBalance.findUnique({where:{userId_ingredientId:{userId:owner,ingredientId:id}}}))?.available??false;
    await tracking(seasoning,"availability",true); await tracking(garnish,"availability",false);
    await stock(egg,"0"); await stock(flour,"0");
    const definitionId=randomUUID(), egg1=randomUUID(), egg2=randomUUID(), eggOpt=randomUUID();
    const recentRecipe={description:null,name:"Tres porciones de prueba",baseServings:"3",cookingMinutes:15,steps:[
      {stepKey:egg1,text:"Mezclar",optional:false,ingredientId:egg,expectedIngredientRevision:0,quantity:"1",equivalent:null,minutesBefore:null,priorTitle:null},
      {stepKey:egg2,text:"Añadir",optional:false,ingredientId:egg,expectedIngredientRevision:0,quantity:"1",equivalent:null,minutesBefore:null,priorTitle:null},
      {stepKey:eggOpt,text:"Decorar",optional:true,ingredientId:egg,expectedIngredientRevision:0,quantity:"1",equivalent:null,minutesBefore:null,priorTitle:null},
      {stepKey:randomUUID(),text:"Harina",optional:false,ingredientId:flour,expectedIngredientRevision:0,quantity:"90",equivalent:null,minutesBefore:null,priorTitle:null},
      {stepKey:randomUUID(),text:"Sazonar",optional:false,ingredientId:seasoning,expectedIngredientRevision:0,quantity:null,equivalent:"al gusto",minutesBefore:null,priorTitle:null},
      {stepKey:randomUUID(),text:"Salsa",optional:true,ingredientId:garnish,expectedIngredientRevision:0,quantity:null,equivalent:"un chorrito",minutesBefore:null,priorTitle:null},
    ]};
    const definition=(await recipes.execute(owner,command({action:"createRecipe",id:definitionId,recipe:recentRecipe}))).item!;
    check("Receta con ingredientes al gusto queda lista sin cantidades ficticias",!definition.draft&&definition.steps.find(s=>s.ingredientId===seasoning)?.quantity===null);
    const req=`${egg}:required`, opt=`${egg}:optional`;
    function recentBody(date:string,cooked="1",eaten="1",amounts:Record<string,string>={}) {return {action:"saveMeal",id:randomUUID(),expectedRevision:null as number|null,date,time:"10:00",slotId,cookingEnabled:cooked!=="0",eatingEnabled:true,washingEnabled:true,eatingMinutes:20,washingMinutes:10,cookingMinutesOverride:null,recipes:[{id:randomUUID(),recipeRevisionId:definition.revisionId,cookedServings:cooked,eatenServings:eaten,cookingMinutesOverride:null,ingredientQuantities:amounts}],reminders:[]};}
    const current=recentBody("2027-01-04"); await cook(current);
    const children=()=>item(current.id);
    let detail=await children(), currentList=await shopping.snapshot(owner);
    const eggSteps=detail.children.filter(s=>s.mealIngredient?.name==="Prueba huevo"&&!s.mealOptional);
    check("Tres porciones a una: suma usos antes de redondear piezas",eggSteps.length===2&&eggSteps.every(s=>s.mealIngredient?.quantity==="0.5"));
    check("Gramos se escalan proporcionalmente a 30 g",detail.children.find(s=>s.mealIngredient?.name==="Prueba harina")?.mealIngredient?.quantity==="30");
    check("Compras agrupa huevo obligatorio y opcional con total de dos piezas",currentList.items.find(s=>s.ingredientId===egg)?.quantity==="2"&&currentList.items.find(s=>s.ingredientId===egg)?.required==="1"&&currentList.items.find(s=>s.ingredientId===egg)?.optional==="1");
    check("Opcional al gusto faltante no impide disponibilidad obligatoria",!(await planner.snapshot(owner,"2027-01-04",7)).availability[current.id].shortages.some(s=>s.ingredientId===seasoning));
    check("Compra al gusto aparece sin una cantidad calculada",currentList.items.find(s=>s.ingredientId===garnish)?.availabilityOnly&&currentList.items.find(s=>s.ingredientId===garnish)?.quantity==="0");
    current.recipes[0].ingredientQuantities={[req]:"0.5",[opt]:"0.25"}; current.expectedRevision=(await children()).revision; await cook(current);
    currentList=await shopping.snapshot(owner);
    check("Cantidad manual fraccionaria persiste al reabrir",(await planner.cell(owner,current.date,slotId)).meal?.recipes[0].ingredientQuantities?.[req]==="0.5");
    check("Compras usa exactamente obligatorio 0.5 y opcional 0.25",currentList.items.find(s=>s.ingredientId===egg)?.required==="0.5"&&currentList.items.find(s=>s.ingredientId===egg)?.optional==="0.25"&&currentList.items.find(s=>s.ingredientId===egg)?.quantity==="0.75");
    current.recipes[0].cookedServings="2"; current.expectedRevision=(await children()).revision; await cook(current);
    detail=await children();
    check("Cambiar porciones conserva cantidad manual y escala automático",detail.children.filter(s=>s.mealIngredient?.name==="Prueba huevo"&&!s.mealOptional).every(s=>s.mealIngredient?.quantity==="0.25")&&detail.children.find(s=>s.mealIngredient?.name==="Prueba harina")?.mealIngredient?.quantity==="60");
    check("Modificar comida no altera recetario",(await recipes.snapshot(owner)).items.find(r=>r.id===definitionId)?.steps.filter(s=>s.ingredientId===egg).every(s=>s.quantity==="1"));
    await stock(egg,"0.5"); await stock(flour,"60");
    let recentPlan=await planner.snapshot(owner,"2027-01-04",7);
    check("Disponibilidad utiliza cantidad manual y deja solo opcionales faltantes",!recentPlan.availability[current.id].shortages.some(s=>!s.optional));
    const farther=recentBody("2027-01-05","1","1",{[req]:"0.5",[opt]:"0.25"}); await cook(farther);
    recentPlan=await planner.snapshot(owner,"2027-01-04",7);
    check("Prioridad cronológica: faltante obligatorio aparece en comida posterior",!recentPlan.availability[current.id].shortages.some(s=>!s.optional)&&recentPlan.availability[farther.id].shortages.some(s=>s.ingredientId===egg&&!s.optional&&s.quantity==="0.5"));
    await change(farther.id,"deleteTask");
    const receiptCommand=command({action:"buyShoppingItems",expectedDataRevision:await revision(),items:[{key:`i:${garnish}`,quantity:"0"},{key:`i:${egg}`,quantity:"1.25"}]});
    await shopping.execute(owner,receiptCommand); await shopping.execute(owner,receiptCommand);
    check("Compra mixta reintentada suma cantidad real solo una vez",await balance(egg)==="1.75"&&await isAvailable(garnish)&&await balance(garnish)==="0");
    check("Comprar disponibilidad no registra movimiento numérico",await db.inventoryMovement.count({where:{userId:owner,ingredientId:garnish}})===0);
    currentList=await shopping.snapshot(owner); const garnishReceipt=currentList.purchased.find(s=>s.name==="Prueba salsa")!, eggReceipt=currentList.purchased.find(s=>s.name==="Prueba huevo")!;
    await buy({action:"undoShoppingPurchase",id:eggReceipt.id}); await buy({action:"undoShoppingPurchase",id:garnishReceipt.id});
    check("Deshacer compra mixta devuelve cantidad y disponibilidad anterior",await balance(egg)==="0.5"&&!await isAvailable(garnish));
    await rejected("Opcional seleccionado sin disponibilidad bloquea consumo",()=>change(current.id,"setCompleted",{completed:true,optionalStepIds:[(detail.children.find(s=>s.mealIngredient?.name==="Prueba salsa"))!.id]}),"DEPENDENCY");
    check("Consumo rechazado no altera stock ni completa",await balance(egg)==="0.5"&&await balance(flour)==="60"&&!(await children()).completedAt);
    await change(current.id,"setCompleted",{completed:true,optionalStepIds:[]});
    check("Completar sin opcionales descuenta solo cantidades elegidas",await balance(egg)==="0"&&await balance(flour)==="0");
    check("Disponibilidad no se consume ni se convierte en movimiento",await isAvailable(seasoning)&&await balance(seasoning)==="0"&&await db.inventoryMovement.count({where:{userId:owner,ingredientId:seasoning}})===0);
    check("Cocinar dos y comer una deja una porción real",(await planner.snapshot(owner,"2027-01-04",7)).resources.realBatches?.some(b=>b.mealId===current.id&&b.quantity==="1"));
    const leftover=recentBody("2027-01-06","0","1",{[req]:"99"}); await cook(leftover);
    check("Sin Cocinar ignora cantidades manuales al calcular compras",!(await shopping.snapshot(owner)).items.some(s=>s.ingredientId===egg));
    await change(leftover.id,"setCompleted",{completed:true});
    check("Comer sobras consume la tanda sin descontar ingredientes",await balance(egg)==="0"&&(await planner.cell(owner,leftover.date,slotId)).meal?.portionSources.some(s=>s.mealId===current.id&&s.quantity==="1"));
    await rejected("Sobras ya utilizadas impiden deshacer su origen",()=>change(current.id,"setCompleted",{completed:false}),"DEPENDENCY");
    await change(leftover.id,"setCompleted",{completed:false}); await change(current.id,"setCompleted",{completed:false});
    check("Deshacer en orden devuelve exactamente cantidades fraccionarias",await balance(egg)==="0.5"&&await balance(flour)==="60"&&await isAvailable(seasoning));
    await change(leftover.id,"deleteTask");
    await stock(egg,"0.75"); await tracking(garnish,"availability",true);
    const optionalEgg=(await children()).children.find(s=>s.mealIngredient?.name==="Prueba huevo"&&s.mealOptional)!, optionalGarnish=(await children()).children.find(s=>s.mealIngredient?.name==="Prueba salsa")!;
    await change(current.id,"setCompleted",{completed:true,optionalStepIds:[optionalEgg.id,optionalGarnish.id]});
    check("Opcionales elegidos consumen la fracción exacta y conservan Tengo",await balance(egg)==="0"&&await isAvailable(garnish));
    await change(current.id,"setCompleted",{completed:false});
    check("Deshacer restaura fracciones obligatorias y opcionales",await balance(egg)==="0.75"&&await balance(flour)==="60");
    current.recipes[0].ingredientQuantities={};current.expectedRevision=(await children()).revision;await cook(current);
    const resetNeed=(await shopping.snapshot(owner)).items.find(s=>s.ingredientId===egg)!;
    check("Volver al cálculo automático redondea grupos por separado",resetNeed.required==="1.25"&&resetNeed.optional==="1");
    check("Recalcular faltantes conserva cantidad elegida al deshacer compra",resetNeed.quantity==="1.25"&&resetNeed.edited);
    current.recipes[0].ingredientQuantities={[req]:"0.5",[opt]:"0.25"};current.expectedRevision=(await children()).revision;await cook(current);
    await cook({action:"copyPreviousMealWeek",start:"2027-01-11",expectedDataRevision:await revision(),reminders:[]});
    const copied=(await planner.snapshot(owner,"2027-01-11",7)).meals[0];
    check("Copiar semana conserva cantidades elegidas e identidades nuevas",copied.id!==current.id&&copied.recipes[0].ingredientQuantities?.[req]==="0.5"&&copied.recipes[0].ingredientQuantities?.[opt]==="0.25");
    const copiedNeed=(await shopping.snapshot(owner)).items.find(s=>s.ingredientId===egg)!;
    check("Copia pendiente no duplica consumo y recalcula compras globales",!copied.completedAt&&await balance(egg)==="0.75"&&copiedNeed.required==="0.25"&&copiedNeed.optional==="0.5");
    recentPlan=await planner.snapshot(owner,"2027-01-11",7);
    check("Copia vuelve a reservar por fecha respetando planes anteriores",recentPlan.availability[copied.id].shortages.some(s=>s.ingredientId===egg&&!s.optional&&s.quantity==="0.25"));
    await cook({action:"deleteMealWeek",start:"2027-01-11",expectedDataRevision:await revision()});
    check("Eliminar semana copiada libera sus demandas sin cambiar stock",await balance(egg)==="0.75"&&!(await shopping.snapshot(owner)).items.some(s=>s.ingredientId===egg));
    current.recipes[0].cookedServings="0";current.cookingEnabled=false;current.expectedRevision=(await children()).revision;await cook(current);
    check("Desactivar Cocinar elimina demanda numérica y de disponibilidad",!(await shopping.snapshot(owner)).items.some(s=>([egg,flour,seasoning,garnish] as string[]).includes(s.ingredientId??"")));
    await change(current.id,"deleteTask");
    const presencePlan=recentBody("2027-02-01"),presenceLater=recentBody("2027-02-02");await cook(presencePlan);await cook(presenceLater);
    await tracking(seasoning,"availability",false);
    currentList=await shopping.snapshot(owner);
    check("Disponibilidad faltante se agrupa una vez para todas las recetas",currentList.items.filter(s=>s.ingredientId===seasoning).length===1);
    await buy({action:"buyShoppingItems",items:[{key:`i:${seasoning}`,quantity:"0"}]});
    check("Compra Tengo mantiene cantidad cero y no crea movimiento",await isAvailable(seasoning)&&await balance(seasoning)==="0"&&await db.inventoryMovement.count({where:{userId:owner,ingredientId:seasoning}})===0);
    recentPlan=await planner.snapshot(owner,"2027-02-01",7);
    check("Tengo quita aviso de ambos planes",[presencePlan.id,presenceLater.id].every(id=>!recentPlan.availability[id].shortages.some(s=>s.ingredientId===seasoning)));
    const presenceReceipt=(await shopping.snapshot(owner)).purchased.find(s=>s.name==="Prueba sal")!;
    await tracking(seasoning,"availability",false);
    await rejected("Cambio manual posterior protege al deshacer disponibilidad",()=>buy({action:"undoShoppingPurchase",id:presenceReceipt.id}),"DEPENDENCY");
    await tracking(seasoning,"quantity",true,"12");
    check("Volver a cantidad establece existencias reales con ajuste",await balance(seasoning)==="12");
    await stock(egg,"5");await stock(flour,"200");
    await change(presencePlan.id,"setCompleted",{completed:true,optionalStepIds:[]});
    check("Versión antigua al gusto no inventa descuento al pasar a cantidad",await balance(seasoning)==="12");
    await change(presencePlan.id,"setCompleted",{completed:false});
    await tracking(seasoning,"availability",true);
    check("Volver a disponibilidad conserva saldo numérico histórico",await balance(seasoning)==="12"&&await isAvailable(seasoning));
    await change(presencePlan.id,"deleteTask");await change(presenceLater.id,"deleteTask");
    check("Últimos bloques no generan stock negativo",!await db.pantryBalance.count({where:{userId:owner,quantity:{lt:0}}}));
  }

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
  if(created) {
    assert.match(schema,/^miagenda_integral_test_[a-f0-9]{32}$/);
    const cleanup = new pg.Client({connectionString,connectionTimeoutMillis:10000});
    cleanup.on("error",()=>{});
    try { await cleanup.connect(); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); report.temporarySchemaRemoved=true; console.log("Esquema temporal eliminado"); }
    catch { report.failure??="No se pudo eliminar el esquema temporal";process.exitCode=1;console.error("Limpieza temporal pendiente; consulta schema en el informe."); }
    finally { await cleanup.end(); }
  }
  await admin.end(); writeFileSync("reconstruction/core/recent-kitchen-verification.json",JSON.stringify(report,null,2)+"\n");
}
