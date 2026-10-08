"use client";

import Link from "./local-link";
import { useWorkspacePath } from "./local-link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function AppNavigation({ children, footer }: { children?: ReactNode; footer?: string }) {
  const pathname = useWorkspacePath().split("?")[0];
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  function show() { panel.current?.showModal(); setOpen(true); }
  function close() { panel.current?.close(); setOpen(false); (trigger.current?.getClientRects().length ? trigger.current : mobileTrigger.current)?.focus(); }
  useEffect(() => { panel.current?.close(); setOpen(false); }, [pathname]);
  function link(href: string, label: string, icon: string) {
    return <Link prefetch={false} href={href} onClick={close} className={`nav-item${pathname === href ? " nav-item-active" : ""}`} aria-current={pathname === href ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}</Link>;
  }
  function upcoming(label: string, icon: string) {
    return <button type="button" disabled className="nav-item nav-item-muted" title="Próximamente"><span aria-hidden="true">{icon}</span>{label}<small className="app-navigation-upcoming">Próximamente</small></button>;
  }
  const bars = <span className="app-navigation-bars" aria-hidden="true"><span /><span /><span /></span>;
  return <>
    <button ref={trigger} type="button" className="app-navigation-trigger" aria-label="Abrir navegación" aria-controls={id} aria-expanded={open} onClick={show}>{bars}</button>
    <nav className="mobile-bottom-nav" aria-label="Navegación móvil">
      {[{href:"/inbox",label:"Inbox",icon:"▱"},{href:"/agenda",label:"Agenda",icon:"▦"}].map(item => {
        const active = pathname === item.href;
        return <Link key={item.href} prefetch={false} href={item.href} aria-current={active ? "page" : undefined} className={active ? "mobile-nav-active" : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>;
      })}
      <button ref={mobileTrigger} type="button" aria-controls={id} aria-expanded={open} onClick={show}>{bars}<span>Menú</span></button>
    </nav>
    <dialog ref={panel} id={id} className="app-navigation-panel" aria-label="Navegación de MiAgenda" onClose={() => setOpen(false)} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
      <div className="app-navigation-heading"><button type="button" className="app-navigation-close" aria-label="Cerrar navegación" onClick={close}>{bars}</button><Link prefetch={false} className="brand" href="/inbox" onClick={close}><span className="brand-mark">m</span><span>miagenda</span></Link></div>
      <nav className="app-navigation-links" aria-label="Navegación principal">
        {upcoming("Dashboard", "▦")}
        {link("/inbox", "Inbox", "▱")}{link("/agenda", "Agenda", "▦")}
        <details className="app-navigation-group" open={pathname.startsWith("/cocina")}><summary><span aria-hidden="true">♨</span>Cocina<span className="app-navigation-chevron" aria-hidden="true">›</span></summary><div className="app-navigation-submenu">
          {link("/cocina", "Alacena", "▱")}{link("/cocina/recetas", "Recetas", "▤")}{link("/cocina/planificar", "Planificar", "▦")}{link("/cocina/compras", "Compras", "▱")}
        </div></details>
        {upcoming("Personal", "○")}
        {upcoming("Ejercicios", "◇")}
        {upcoming("Hogar", "⌂")}
        {upcoming("Finanzas", "$")}
      </nav>
      {children}
      {footer && <div className="app-navigation-footer"><span className="privacy-dot" />{footer}</div>}
    </dialog>
  </>;
}
