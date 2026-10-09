import type { Prisma } from "../generated/client.ts";
import type { CoreCommand } from "./contracts.ts";
import { CoreError } from "./errors.ts";
import { recurrenceContext, protectedRanges } from "./series-frequency.ts";
import { ordinalFromDate, segmentEnd, splitSegment } from "./series-generation.ts";
import { materialize, occurrenceId } from "./series-runtime.ts";

type Tx=Prisma.TransactionClient;
type Stop=Extract<CoreCommand,{action:"stopRecurrence"}>;
async function plan(tx:Tx,userId:string,command:Stop,confirmedLocal=false){
  const value=await recurrenceContext(tx,userId,command.seriesId,command.ordinal);
  const owner=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
  if(command.id!==occurrenceId(command.seriesId,command.ordinal)||!confirmedLocal&&(value.family.revision!==command.expectedSeriesRevision||owner.dataRevision.toString()!==command.expectedDataRevision||value.today!==command.effectiveDate||(value.own?value.own.activity!.revision!==command.expectedRevision:command.expectedRevision!==0)))throw new CoreError("CONFLICT","La serie cambió. Revisa de nuevo antes de dejar de repetir.");
  const future=value.overrides.filter(item=>item.activity?.lifecycle==="active"&&item.activity.id!==command.id&&item.originalLocal.slice(0,10)>=command.effectiveDate&&!item.activity.completedAt);
  if(future.length>5000)throw new CoreError("INVALID_INPUT","Hay demasiadas excepciones para detener esta serie en una sola operación.");
  return {...value,future,owner};
}
export async function previewStop(tx:Tx,userId:string,command:Stop){
  const value=await plan(tx,userId,command);
  return {effectiveDate:value.today,modifiedCount:value.future.length,modified:value.future.slice(0,100).map(item=>({id:item.activity!.id,title:item.activity!.title,date:item.originalLocal.slice(0,10)}))};
}
export async function stopRecurrence(tx:Tx,userId:string,command:Stop,confirmedLocal=false){
  const value=await plan(tx,userId,command,confirmedLocal);
  // Materialize only the selected instance; keep its original exclusion forever.
  if(!value.own)await materialize(tx,userId,{seriesId:command.seriesId,ordinal:command.ordinal,seriesRevision:value.family.revision},command.id);
  // Freeze future expansion, retaining progressed virtual dates without creating them all.
  for(const segment of value.segments){
    const boundary=ordinalFromDate(segment,command.effectiveDate);
    if(boundary>=segmentEnd(segment))continue;
    const ranges=protectedRanges(segment,value.rules,boundary);
    const next=await splitSegment(tx,segment,boundary);
    if(next)await tx.seriesSegment.update({where:{id:next.id},data:{protectedOnly:true,protectedRanges:segment.protectedOnly?ranges.flatMap(range=>(segment.protectedRanges as {from:number;to:number}[]).flatMap(old=>Math.max(range.from,old.from)<Math.min(range.to,old.to)?[{from:Math.max(range.from,old.from),to:Math.min(range.to,old.to)}]:[])):ranges}});
  }
  const affectedIds:string[]=[],removedIds:string[]=[];
  // The trigger permits only removing ancestry, never reassigning a family/key.
  await tx.$executeRaw`SELECT set_config('miagenda.detach_recurrence',${userId},true)`;
  async function detach(id:string,inbox:boolean){
    const children=await tx.activity.findMany({where:{userId,parentId:id,lifecycle:"active"},select:{id:true}});
    await tx.activity.updateMany({where:{userId,parentId:id},data:{stepKeyId:null}});
    await tx.activity.update({where:{id,userId},data:{occurrenceId:null,...(inbox?{keep:false,highlighted:false}:{})}});
    if(inbox)await tx.activitySchedule.deleteMany({where:{userId,activityId:id}});
    affectedIds.push(id,...children.map(child=>child.id));
  }
  await detach(command.id,true);
  for(const item of value.future){
    const parent=item.activity!;
    if(command.preserveModified)await detach(parent.id,false);
    else{
      const ids=[parent.id,...parent.children.map(child=>child.id)];
      await tx.activitySchedule.deleteMany({where:{userId,activityId:{in:ids}}});
      await tx.activity.updateMany({where:{userId,id:{in:ids}},data:{lifecycle:"retired",title:"",description:null,keep:false,highlighted:false}});
      removedIds.push(...ids);
    }
  }
  await tx.$executeRaw`SELECT set_config('miagenda.detach_recurrence','',true)`;
  await tx.recurrenceSeries.update({where:{id:command.seriesId},data:{revision:{increment:1}}});
  return {affectedIds,removedIds};
}
