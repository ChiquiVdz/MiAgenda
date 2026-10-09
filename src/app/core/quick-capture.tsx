"use client";
import { coreFetch, localMode, refreshLocalCopy, useLocalStatus } from "./local-data";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspacePath } from "./local-link";
import type { CommandResult } from "../../../reconstruction/core/src/views";
import { CoreDialog } from "./schedule-editor";

export const inboxCapturedEvent = "miagenda:inbox-captured";
type CaptureCommand = {
  commandId: string; action: "createTask"; id: string; title: string;
  description: null; parentId: null; expectedParentRevision: null; position: number;
};

/** Keeps the current screen and reuses the native, idempotent Inbox command. */
export function QuickCapture() {
  const local = useLocalStatus();
  const pathname = useWorkspacePath().split("?")[0];
  const enabled = pathname === "/inbox" || pathname === "/agenda" || pathname === "/hoy" || pathname === "/cocina" || pathname.startsWith("/cocina/");
  const [open, setOpen] = useState(false), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const attempt = useRef<CaptureCommand | null>(null), sending = useRef(false), generation = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null), field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Never carry a pending command or draft across logout/login.
    if (!enabled) {
      generation.current++; attempt.current = null; sending.current = false;
      setOpen(false); setText(""); setBusy(false); setRetry(false); setError(null); setNotice(null);
    }
  }, [enabled]);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function close() {
    if (sending.current) return;
    setOpen(false); trigger.current?.focus();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !enabled || !text.trim()) return;
    const command = attempt.current ?? {
      commandId: crypto.randomUUID(), action: "createTask", id: crypto.randomUUID(),
      title: text.trim(), description: null, parentId: null, expectedParentRevision: null, position: 0,
    } satisfies CaptureCommand;
    attempt.current = command; sending.current = true; setBusy(true); setError(null); setNotice(null);
    const version = generation.current;
    try {
      const response = await coreFetch("/api/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json().catch(() => null);
      if (version !== generation.current) return;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) { attempt.current = null; setRetry(false); }
        throw new Error(result?.message ?? "No pudimos confirmar el guardado. Reintenta; no se duplicará el pendiente.");
      }
      if (!Array.isArray(result?.activities) || !Array.isArray(result?.removedIds) || typeof result?.dataRevision !== "string") {
        throw new Error("No pudimos confirmar el guardado. Reintenta; no se duplicará el pendiente.");
      }
      attempt.current = null; setRetry(false); setText(""); setOpen(false); setNotice(localMode() ? "Guardado en este dispositivo · Sin enviar" : "Guardado en Inbox.");
      window.dispatchEvent(new CustomEvent<CommandResult>(inboxCapturedEvent, { detail: result }));
      trigger.current?.focus();
    } catch (cause) {
      if (version === generation.current) {
        setRetry(Boolean(attempt.current)); setError(cause instanceof Error ? cause.message : "No pudimos guardar en Inbox.");
      }
    } finally {
      if (version === generation.current) { sending.current = false; setBusy(false); }
    }
  }
  if (!enabled) return null;
  return <>
    <div className="quick-capture-controls">
      {notice && <p className="quick-capture-notice" role="status">{notice}</p>}
      <button ref={trigger} type="button" className="quick-capture-trigger" aria-label="Captura rápida: agregar a Inbox" disabled={!local.ready || local.busy} onClick={() => { setNotice(null); setOpen(true); }}>
        <span aria-hidden="true">＋</span><span>Anotar</span>
      </button>
    </div>
    {open && <CoreDialog title="Anotar en Inbox" close={close}>
      <form className="core-edit-form" onSubmit={event => void save(event)}>
        <p className="core-muted">Guarda un pendiente y sigue donde estabas. Puedes agendarlo después desde Inbox.</p>
        <label className="form-field">Pendiente<input ref={field} required maxLength={250} placeholder="Examen a las 3 el jueves" value={text} disabled={busy || retry} onChange={event => setText(event.target.value)} /></label>
        {error && <p className="pantry-error" role="alert">{error}</p>}
        {retry && <p className="core-muted">Conservamos este intento. Reintenta el mismo guardado para evitar duplicados.</p>}
        <div className="core-row-actions">
          <button className="pantry-add-button" type="submit" disabled={busy || !text.trim()}>{busy ? "Guardando…" : retry ? "Reintentar guardado" : "Guardar en Inbox"}</button>
          <button className="core-text-button" type="button" disabled={busy} onClick={close}>Cerrar</button>
        </div>
      </form>
    </CoreDialog>}
  </>;
}
