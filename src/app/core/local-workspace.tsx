"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CoreInboxView } from "../inbox/core-inbox-view";
import { CoreAgenda } from "./core-agenda";
import { CorePantryView } from "../cocina/core-pantry-view";
import { CoreRecipesView } from "../cocina/recetas/core-recipes-view";
import { CorePlannerView } from "../cocina/planificar/core-planner-view";
import { CoreShoppingView } from "../cocina/compras/core-shopping-view";
import { AppNavigation } from "./app-navigation";
import LocalLink, { useWorkspacePath } from "./local-link";
import { checkLocalChanges, clearLocalCopy, currentCopy, downloadRequestedDates, isLocalPath, localEvent, plannerCopy, refreshLocalCopy, restoreLocalCopy, setLocalOnline, setShellReady, useLocalStatus } from "./local-data";
import type { LocalCopy } from "./local-contract";
import { dateParts, monday } from "./dates";

function KitchenHome() {
  return <main className="app-shell"><AppNavigation /><section className="workspace"><div className="page-content"><h1>Cocina</h1><nav className="kitchen-hub" aria-label="Apartados de Cocina">
    {[["/cocina", "Alacena", "Lo que tienes."], ["/cocina/recetas", "Recetas", "Tus recetas y pasos."], ["/cocina/planificar", "Planificar", "Las comidas de cada día."], ["/cocina/compras", "Compras", "Lo que falta y lo comprado."]].map(([href, title, description]) => <LocalLink href={href} key={href}><strong>{title}</strong><small>{description}</small></LocalLink>)}
  </nav></div></section></main>;
}

/** Public shell + private IndexedDB copy. No private SSR HTML is cached. */
export function LocalWorkspace({ children }: { children: ReactNode }) {
  const location = useWorkspacePath(), path = location.split("?")[0], enabled = isLocalPath(path);
  const status = useLocalStatus();
  const [data, setData] = useState<LocalCopy | null>(null), [generation, setGeneration] = useState(0), [started, setStarted] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const changed = (event: Event) => {
      if (!alive) return;
      setData(currentCopy());
      if ((event as CustomEvent).detail?.remount) setGeneration(value => value + 1);
    };
    window.addEventListener(localEvent, changed);
    void (async () => {
      try {
        const saved = await restoreLocalCopy();
        if (!alive) return;
        setData(saved); setStarted(true);
        if (saved) await checkLocalChanges();
        else if (navigator.onLine) await refreshLocalCopy();
      } catch { if (alive) setStarted(true); }
    })();
    // Reopening the installed app after a substantial pause is a new entry.
    // No focus listener, recurring interval, or automatic reconnect download.
    let hiddenAt = 0;
    const visible = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 300000) { hiddenAt = 0; void checkLocalChanges(); }
    };
    const online = () => setLocalOnline(navigator.onLine);
    online(); window.addEventListener("online", online); window.addEventListener("offline", online);
    document.addEventListener("visibilitychange", visible);
    const logout = (event: StorageEvent) => { if (event.key === "miagenda:logout") { void clearLocalCopy(); window.location.assign("/login"); } };
    window.addEventListener("storage", logout);
    return () => { alive = false; window.removeEventListener(localEvent, changed); window.removeEventListener("online", online); window.removeEventListener("offline", online); window.removeEventListener("storage", logout); document.removeEventListener("visibilitychange", visible); };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !data || !("serviceWorker" in navigator)) return;
    let alive = true;
    const ready = (event: MessageEvent) => { if (event.data?.type === "MIAGENDA_SHELL_READY" && alive) setShellReady(true); };
    navigator.serviceWorker.addEventListener("message", ready);
    // Public files only. Development builds cannot be reliably cached.
    if (process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(async registration => {
      const worker = registration.active ?? registration.installing ?? registration.waiting;
      if (!worker) return;
      const prepare = () => { if (worker.state === "activated") worker.postMessage({ type: "PREPARE_SHELL" }); };
      if (worker.state === "activated") prepare();
      else worker.addEventListener("statechange", prepare);
    }).catch(() => { setShellReady(false); });
    return () => { alive = false; navigator.serviceWorker.removeEventListener("message", ready); };
  }, [enabled, !!data]);

  if (!enabled) return <>{children}</>;
  const update = () => { void refreshLocalCopy().catch(() => {}); };
  if (!data) return <main className="login-shell"><section className="login-card"><h1>MiAgenda</h1><p role="status">{!started || status.busy ? "Preparando tu copia…" : "Necesitas conexión para descargar tu información por primera vez."}</p>{status.message && <p role="alert">{status.message}</p>}<button type="button" className="pantry-add-button" disabled={status.busy || !status.online} onClick={update}>Reintentar descarga</button><a href="/login">Iniciar sesión</a></section></main>;
  const params = new URLSearchParams(location.includes("?") ? location.slice(location.indexOf("?") + 1) : "");
  const mealId = params.get("meal") ?? undefined;
  const today = dateParts(new Date(), data.planners[0].timeZone).date;
  const selectedMeal = mealId ? data.planners.flatMap(item => item.meals).find(item => item.id === mealId) : null;
  const plannerStart = monday(selectedMeal?.date ?? today);
  const initialPlanner = plannerCopy(plannerStart, 7) ?? plannerCopy(data.planners[0].start, 7)!;
  const screen = path === "/agenda" || path === "/hoy" ? <CoreAgenda initialData={data.agenda} initialCalendars={data.calendars} initialToday={today} />
    : path === "/cocina" ? <CorePantryView initial={data.pantry} />
    : path === "/cocina/recetas" ? <CoreRecipesView initial={data.recipes} pantry={data.pantry} />
    : path === "/cocina/planificar" ? <CorePlannerView initial={initialPlanner} initialMealId={mealId} />
    : path === "/cocina/compras" ? <CoreShoppingView initial={data.shopping} pantry={data.pantry} />
    : path === "/cocina/inicio" ? <KitchenHome />
    : <CoreInboxView initialData={data.inbox} calendars={data.calendars} />;
  return <div className="local-workspace">
    <aside className="local-copy-bar" aria-label="Copia en este dispositivo">
      <span>{status.busy ? "Actualizando copia…" : !status.online ? "Sin conexión · solo consulta" : "Copia local"}<small>Guardada {new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(data.savedAt))}</small></span>
      <button type="button" className="core-text-button" disabled={status.busy || !status.online} onClick={update}>Actualizar copia</button>
      <details><summary>Info</summary><p>Agenda y Planificar: {data.start} a {data.end} (fin no incluido). Inbox, Recetas, Alacena y Compras también están descargados. {status.shellReady ? "Pantallas listas para abrir sin conexión." : "Preparando las pantallas para abrir sin conexión; en desarrollo no se guardan."} Editar y completar todavía requiere internet.</p></details>
    </aside>
    {status.newer && <div className="local-copy-notice" role="status">Hay cambios de otro dispositivo. Pulsa «Actualizar copia» para descargarlos. <span>Puedes seguir con la copia actual.</span></div>}
    {status.range && <div className="local-copy-notice">Estas fechas no están descargadas. <button type="button" disabled={status.busy || !status.online} onClick={() => void downloadRequestedDates()}>Descargar estas fechas</button></div>}
    {status.message && <p className="local-copy-notice" role="status">{status.message}</p>}
    <div key={`${location}:${generation}`}>{screen}</div>
  </div>;
}
