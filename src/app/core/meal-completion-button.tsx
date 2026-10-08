"use client";
import { useContext, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { Mutate } from "./use-core-feed";
import { CoreDialog, CoreFeedback } from "./schedule-editor";
export function MealCompletionButton({item,disabled,mutate,label}:{item:ActivityView;disabled:boolean;mutate:Mutate;label?:string}){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const feedback=useContext(CoreFeedback);
  const allOptional=item.children.filter(child=>child.mealRole==="preparation"&&child.mealOptional);
  const optional=allOptional.filter(child=>child.mealIngredient?.tracksQuantity);
  // Hidden optionals keep only their actual step marks; never infer that they were used.
  const send=(ids:string[])=>void mutate({action:"setCompleted",id:item.id,expectedRevision:item.revision,completed:true,optionalStepIds:[...new Set([...ids,...allOptional.filter(child=>!child.mealIngredient?.tracksQuantity&&child.completedAt).map(child=>child.id)])]},()=>setOpen(false));
  return <><button type="button" className="today-completion" disabled={disabled} aria-pressed={!!item.completedAt} aria-label={`${item.completedAt?"Deshacer":"Completar"} ${label??item.title}`} onClick={()=>{
    if(item.completedAt)void mutate({action:"setCompleted",id:item.id,expectedRevision:item.revision,completed:false});
    else if(!optional.length)send([]);
    else{setSelected(optional.filter(child=>child.completedAt||item.lastMealOptionals?.includes(child.id)).map(child=>child.id));setOpen(true);}
  }}>{item.completedAt?"✓":""}</button>{open&&<CoreDialog title="¿Qué opcionales utilizaste?" close={()=>{if(!feedback.busy)setOpen(false);}}><div className="core-edit-form"><p>Se completarán los pasos obligatorios. Marca únicamente los opcionales que usaste; sus ingredientes también se descontarán.</p>{optional.map(child=><label className="core-check" key={child.id}><input type="checkbox" checked={selected.includes(child.id)} disabled={disabled} onChange={event=>setSelected(current=>event.target.checked?[...current,child.id]:current.filter(id=>id!==child.id))}/><span>{child.mealIngredient ? <><strong>{child.mealIngredient.name} · {child.mealIngredient.quantity} {child.mealIngredient.unit === "piece" ? "piezas" : child.mealIngredient.unit}{child.mealIngredient.equivalent ? ` · Equivalencia base: ${child.mealIngredient.equivalent}` : ""}</strong><small className="meal-optional-details">{child.title}{child.description ? ` · ${child.description}` : ""} · Para {child.mealIngredient.cookedServings} porciones a cocinar</small></> : <>{child.description?`${child.description}: `:""}{child.title}</>}</span></label>)}{feedback.error&&<p className="pantry-error" role="alert">{feedback.error}</p>}{feedback.retry&&<button className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar el mismo cambio</button>}<button className="pantry-add-button" disabled={disabled} onClick={()=>send(selected)}>Completar comida</button><button className="core-text-button" disabled={feedback.busy} onClick={()=>setOpen(false)}>Cancelar</button></div></CoreDialog>}</>;
}
