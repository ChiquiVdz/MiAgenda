"use client";
import { useEffect, useState } from "react";

export type CreateCalendarInline = (name: string, color: string, selected: (id: string) => void) => void;
export function CalendarPicker({ calendars, value, change, disabled, create, onAddingChange }: { calendars: { id: string; name: string }[]; value: string; change: (id: string) => void; disabled: boolean; create?: CreateCalendarInline; onAddingChange?: (adding: boolean) => void }) {
  const [adding, setAdding] = useState(false), [name, setName] = useState(""), [color, setColor] = useState("#527860");
  useEffect(() => { onAddingChange?.(adding); return () => onAddingChange?.(false); }, [adding, onAddingChange]);
  function add() { if (!disabled && name.trim()) create?.(name.trim(), color, id => { change(id); setAdding(false); setName(""); }); }
  return <div className="core-calendar-picker"><label className="form-field">Calendario<select required value={adding ? "new-calendar" : value} disabled={disabled} onChange={event => {
    if (event.target.value === "new-calendar") setAdding(true); else { setAdding(false); change(event.target.value); }
  }}>{calendars.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{create && <option value="new-calendar">＋ Nuevo calendario</option>}</select></label>
    {adding && create && <div className="core-inline-calendar"><label className="form-field">Nombre del calendario<input autoFocus maxLength={120} placeholder="Hogar, Personal…" value={name} disabled={disabled} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /></label>
      <div className="core-row-actions"><label className="form-field">Color<input type="color" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} /></label><button type="button" className="core-text-button" disabled={disabled || !name.trim()} onClick={add}>Crear calendario</button><button type="button" className="core-text-button" disabled={disabled} onClick={() => setAdding(false)}>Cancelar</button></div>
    </div>}
  </div>;
}
