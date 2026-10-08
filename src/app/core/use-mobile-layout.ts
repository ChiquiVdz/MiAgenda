"use client";
import { useEffect, useSyncExternalStore } from "react";

const query = "(max-width: 680px)";
function subscribe(change: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Follow the visible area when Safari's keyboard or address bar changes it. */
export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--visible-height", `${viewport.height}px`);
      root.style.setProperty("--visible-top", `${viewport.offsetTop}px`);
      const editing = document.activeElement?.matches("input, textarea, [contenteditable=true]");
      root.dataset.keyboard = editing && window.innerHeight - viewport.height > 150 ? "open" : "closed";
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.style.removeProperty("--visible-height");
      root.style.removeProperty("--visible-top");
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
