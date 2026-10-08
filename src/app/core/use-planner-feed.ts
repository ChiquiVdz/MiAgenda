"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import { useEffect, useRef, useState } from "react";
import type { PlannerSnapshot } from "../../../reconstruction/core/src/planner";
export type PlannerDraft=Record<string,unknown>&{action:string};
type Attempt={command:PlannerDraft&{commandId:string};success?:()=>void};
export function usePlannerFeed(initial:PlannerSnapshot,start:string,days:number,refreshAfterWrite=true){
  const [data,setData]=useState(initial),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(false);
  const writing=useRef(false),attempt=useRef<Attempt|null>(null),controller=useRef<AbortController|null>(null),generation=useRef(0),pending=useRef(false),revision=useRef(initial.dataRevision),range=useRef({start,days}),initialized=useRef(false);range.current={start,days};
  async function load(){if(writing.current||attempt.current){pending.current=true;return;}controller.current?.abort();const abort=new AbortController();controller.current=abort;const version=++generation.current;setReading(true);
    try{const response=await coreFetch(`/api/core?${new URLSearchParams({view:"planner",start:range.current.start,days:String(range.current.days)})}`,{cache:"no-store",signal:abort.signal}),result=await response.json();if(!response.ok)throw new Error(result.message??"No pudimos actualizar Planificar.");if(version!==generation.current||BigInt(result.dataRevision)<BigInt(revision.current))return;revision.current=result.dataRevision;setError(null);setData(result);return result as PlannerSnapshot;}
    catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:"No pudimos actualizar.");}finally{if(controller.current===abort){controller.current=null;setReading(false);}}
  }
  async function send(value:Attempt){if(writing.current)return;writing.current=true;attempt.current=value;++generation.current;controller.current?.abort();controller.current=null;setReading(false);setBusy(true);setError(null);
    try{const response=await coreFetch("/api/core",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value.command)}),result=await response.json().catch(()=>null);
      if(!response.ok){if(response.status<500&&response.status!==429){attempt.current=null;setRetry(false);pending.current=true;}throw new Error(result?.message??"No pudimos confirmar el cambio. Reintenta el mismo comando.");}
      if(typeof result?.dataRevision!=="string"||(result.changed!==true&&!Array.isArray(result.activities)))throw new Error("Respuesta incierta. Reintenta; no se duplicará la comida.");
      // A dialog that closes into Agenda lets that surface refresh once instead
      // of also downloading a full planner snapshot that will be discarded.
      revision.current=BigInt(result.dataRevision)>BigInt(revision.current)?result.dataRevision:revision.current;attempt.current=null;setRetry(false);pending.current=refreshAfterWrite||value.command.action==="initializeKitchen";value.success?.();
    }catch(cause){setRetry(!!attempt.current);setError(cause instanceof Error?cause.message:"No pudimos guardar.");}finally{writing.current=false;setBusy(false);if(pending.current&&!attempt.current){pending.current=false;void load();}}
  }
  async function mutate(command:PlannerDraft,success?:()=>void){if(!writing.current&&!attempt.current)await send({command:{...command,commandId:crypto.randomUUID()},success});}
  useEffect(()=>{if(data.start!==start||data.days!==days)void load(); // Initial SSR already supplies the first range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[start,days]);
  useEffect(()=>{if(!initial.initialized&&!initialized.current){initialized.current=true;void mutate({action:"initializeKitchen"});}
    let timer:ReturnType<typeof setTimeout>;const localRange = () => { void load(); }; const refresh=()=>{if(localMode())return;if(document.visibilityState==="visible"){clearTimeout(timer);timer=setTimeout(()=>void load(),150);}};window.addEventListener("miagenda:local-range",localRange);window.addEventListener("focus",refresh);window.addEventListener("online",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{clearTimeout(timer);controller.current?.abort();window.removeEventListener("miagenda:local-range",localRange);window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  return {data,busy,reading,error,retry,locked:busy||retry||reading,load,mutate,reattempt:()=>{if(attempt.current)void send(attempt.current);}};
}
