"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ActivityPopover({ anchor, close, busy, children, title = "Detalle de actividad", dismissOutside = true, className = "" }: { anchor: HTMLElement; close: () => void; busy: boolean; children: ReactNode; title?: string; dismissOutside?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 80 });
  const latest = useRef({ close, busy });
  latest.current = { close, busy };
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    closeButton.current?.focus();
    const modalOpen = () => !!document.querySelector("dialog[open]");
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !modalOpen() && !latest.current.busy) { event.preventDefault(); latest.current.close(); anchor.isConnected && anchor.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (dismissOutside && !modalOpen() && !latest.current.busy && event.target instanceof Node && !box.current?.contains(event.target) && !anchor.contains(event.target)) latest.current.close();
    };
    window.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [mounted, anchor, dismissOutside]);
  useLayoutEffect(() => {
    if (!mounted || !box.current) return;
    const rect = anchor.getBoundingClientRect();
    function place() {
      const target = anchor.isConnected ? anchor.getBoundingClientRect() : rect;
      const size = box.current!.getBoundingClientRect();
      const left = target.right + size.width + 12 <= window.innerWidth - 12 ? target.right + 12 : target.left - size.width - 12;
      setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - size.width - 12)), top: Math.max(12, Math.min(target.top, window.innerHeight - size.height - 12)) });
    }
    place();
    const observer = new ResizeObserver(place); observer.observe(box.current);
    document.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { observer.disconnect(); document.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchor, mounted]);
  if (!mounted) return null;
  return createPortal(<div ref={box} className={`core-activity-popover ${className}`} role="dialog" aria-modal="false" aria-label={title} style={position}>
    <div className="core-dialog-heading"><h2>{title}</h2><button ref={closeButton} type="button" className="core-text-button" aria-label="Cerrar" disabled={busy} onClick={() => { close(); anchor.isConnected && anchor.focus(); }}>×</button></div>
    {children}
  </div>, document.body);
}
