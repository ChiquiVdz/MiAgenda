import type { LocalCopy } from "./local-contract";
import type { LocalOperation, SeriesChange } from "../../../reconstruction/core/src/local-task-contract";
import { taskRows } from "./local-tasks";

/** Matches the existing server SHA-1 identity scheme; Web Crypto is used only for IDs. */
async function childId(seriesId:string,ordinal:number,key:string){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-1",new TextEncoder().encode(`miagenda:occurrence:${seriesId}:step:${key}:${ordinal}`)));
  const hex=Array.from(bytes).map(value=>value.toString(16).padStart(2,"0")).join("").slice(0,32).split("");
  hex[12]="5";hex[16]=((parseInt(hex[16],16)&3)|8).toString(16);
  const value=hex.join("");return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
export async function prepareSeriesChildIds(copy:LocalCopy,op:LocalOperation,ref:SeriesChange):Promise<SeriesChange>{
  const c=op.command,additions=c.action==="addSubtasks"?c.children:c.action==="createTask"?[c]:[];
  if(!additions.length)return ref;
  const childIds:Record<string,Record<string,string>>={};
  for(const root of taskRows(copy).values()){
    if(root.parentId||root.recurrence?.seriesId!==ref.seriesId||ref.fromDate!==null&&(!root.recurrence.originalDate||root.recurrence.originalDate<ref.fromDate))continue;
    childIds[root.id]={};
    for(const child of additions)childIds[root.id][child.id]=root.id===op.rootId?child.id:await childId(ref.seriesId,root.recurrence.ordinal,child.id);
  }
  return {...ref,childIds};
}
