"use client";
import { useContext, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { CoreCommand } from "../../../reconstruction/core/src/contracts";
import { coreFetch, currentCopy, localMode, useLocalStatus } from "./local-data";
import { CoreFeedback } from "./schedule-editor";
import type { Mutate } from "./use-core-feed";

type Stop=Extract<CoreCommand,{action:"stopRecurrence"}>;
type Preview={effectiveDate:string;modifiedCount:number;modified:{id:string;title:string;date:string}[]};
export function StopRecurrence({item,disabled,mutate,close}:{item:ActivityView;disabled:boolean;mutate:Mutate;close:()=>void}){
  const local=useLocalStatus(),feedback=useContext(CoreFeedback);
  const [reading,setReading]=useState(false),[error,setError]=useState<string|null>(null);
  const [review,setReview]=useState<{command:Stop;summary:Preview}|null>(null),[preserve,setPreserve]=useState(true);
  const locked=disabled||reading||feedback.busy;
  async function prepare(){
    setReading(true);setError(null);
    try{
      if(localMode()&&(!local.online||local.pending))throw new Error("Conéctate y pulsa Actualizar para revisar todas las repeticiones antes de detenerlas.");
      const ref=item.recurrence!;
      const response=await coreFetch(`/api/core?view=recurrence&seriesId=${ref.seriesId}&ordinal=${ref.ordinal}`,{cache:"no-store"});
      const info=await response.json();if(!response.ok)throw new Error(info.message??"No pudimos revisar la serie.");
      if(localMode()&&info.dataRevision!==currentCopy()?.dataRevision)throw new Error("Hay cambios nuevos. Pulsa Actualizar y vuelve a revisar la serie.");
      const command:Stop={action:"stopRecurrence",commandId:crypto.randomUUID(),id:item.id,expectedRevision:item.revision,seriesId:ref.seriesId,ordinal:ref.ordinal,scope:"following",expectedSeriesRevision:info.seriesRevision,expectedDataRevision:info.dataRevision,effectiveDate:info.today,preserveModified:true};
      const query=new URLSearchParams({view:"recurrencePreview",command:JSON.stringify(command)});
      const result=await coreFetch(`/api/core?${query}`,{cache:"no-store"}),summary=await result.json();
      if(!result.ok)throw new Error(summary.message??"No pudimos revisar las repeticiones futuras.");
      setPreserve(true);setReview({command,summary});
    }catch(cause){setError(cause instanceof Error?cause.message:"No pudimos revisar la serie.");}finally{setReading(false);}
  }
  if(item.parentId||!item.recurrence)return null;
  return <section className="core-inline-panel" aria-label="Dejar de repetir">
    {!review?<button type="button" className="core-text-button" disabled={locked} onClick={()=>void prepare()}>{reading?"Revisando repeticiones…":"Dejar de repetir y pasar a Inbox…"}</button>:<>
      <strong>Dejar de repetir y pasar a Inbox</strong>
      <p>Esta tarea conserva su identidad, subtareas y marcas. Pasa a Inbox sin repetición; sus subtareas con horario lo mantienen. Se usan los datos guardados de la tarea.</p>
      <p>Desde {review.summary.effectiveDate} no se generan nuevas repeticiones pendientes. Se conservan las pasadas, completadas y el progreso ya registrado.</p>
      {!!review.summary.modifiedCount&&<><p>Hay {review.summary.modifiedCount} repeticiones futuras pendientes con cambios propios.</p><label className="core-check"><input type="checkbox" disabled={locked} checked={preserve} onChange={event=>setPreserve(event.target.checked)}/>Conservarlas como tareas independientes con sus horarios y marcas</label><details><summary>Ver repeticiones</summary>{review.summary.modified.map(row=><p key={row.id}>{row.date} · {row.title}</p>)}{review.summary.modifiedCount>review.summary.modified.length&&<p>Y {review.summary.modifiedCount-review.summary.modified.length} más.</p>}</details>{!preserve&&<p>Se retirarán también esas tareas modificadas y sus subtareas.</p>}</>}
      <p>{localMode()?"Se guardará aquí y se aplicará al pulsar Actualizar.":"El cambio se aplicará al confirmar."}</p>
      <div className="core-row-actions"><button type="button" className="pantry-add-button" disabled={locked} onClick={()=>void mutate({...review.command,preserveModified:preserve},close)}>Confirmar y pasar a Inbox</button><button type="button" className="core-text-button" disabled={locked} onClick={()=>setReview(null)}>Cancelar</button></div>
    </>}
    {(error||feedback.error)&&<p className="pantry-error" role="alert">{error??feedback.error}</p>}
  </section>;
}
