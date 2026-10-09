import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { coreOrigin, coreRuntime } from "@/lib/core-runtime";
import { readJson } from "../../../../../../reconstruction/core/src/http";
import { CoreError } from "../../../../../../reconstruction/core/src/errors";
import { executeKitchenBatch, KitchenConflict, kitchenSnapshot } from "../../../../../../reconstruction/core/src/local-kitchen";
import { parseKitchenBatch } from "../../../../../../reconstruction/core/src/local-kitchen-contract";
export const runtime="nodejs";
export const maxDuration=60;
const buckets=new Map<string,{count:number;until:number}>();
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(request:Request){
  let owner:string|undefined,start:string|undefined;
  try{
    if(request.headers.get("origin")!==new URL(coreOrigin()).origin)return json({message:"Origen no permitido."},403);
    owner=(await getServerSession(authOptions))?.user?.id;if(!owner)return json({message:"Inicia sesión con la misma cuenta; conservamos tus cambios."},401);
    if(request.headers.get("X-MiAgenda-Owner")!==owner)return json({error:"ACCOUNT_CHANGED",message:"Entra con la cuenta original para enviar estos cambios."},409);
    const now=Date.now();for(const[id,b]of buckets)if(b.until<now)buckets.delete(id);const bucket=buckets.get(owner)??{count:0,until:now+60000};bucket.count++;buckets.set(owner,bucket);if(bucket.count>20)return json({message:"Espera un minuto antes de reintentar."},429);
    const batch=parseKitchenBatch(await readJson(request));start=batch.start;
    const {db}=coreRuntime(),result=await executeKitchenBatch(db,owner,batch);
    const snapshot=await db.$transaction(tx=>kitchenSnapshot(tx,owner!,batch.start),{isolationLevel:"RepeatableRead",maxWait:10000,timeout:30000});
    return json({...result,snapshot});
  }catch(cause){
    if(cause instanceof KitchenConflict)return json({error:"KITCHEN_CONFLICT",snapshot:cause.snapshot,message:cause.message},409);
    if(cause instanceof CoreError){
      // The failed transaction committed NO inventory effects. Supply a coherent base for an explicit decision.
      if(owner&&start&&["CONFLICT","DEPENDENCY","NOT_FOUND"].includes(cause.code)){
        try{const snapshot=await coreRuntime().db.$transaction(tx=>kitchenSnapshot(tx,owner!,start!),{isolationLevel:"RepeatableRead",maxWait:10000,timeout:30000});return json({error:"KITCHEN_CONFLICT",snapshot,message:cause.message},409);}catch{/* Keep unknown outcomes frozen on the device. */}
      }
      return json({error:cause.code,message:cause.message},cause.code==="UNAUTHENTICATED"?401:cause.code==="INVALID_INPUT"?400:409);
    }
    return json({message:"No pudimos confirmar el envío. Reintenta Actualizar; no se duplicarán compras ni consumos."},500);
  }
}
