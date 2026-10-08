"use client";
import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import { isLocalPath } from "./local-data";

const event = "miagenda:navigate";
export function useWorkspacePath() {
  return useSyncExternalStore(fn => {
    window.addEventListener(event, fn); window.addEventListener("popstate", fn);
    return () => { window.removeEventListener(event, fn); window.removeEventListener("popstate", fn); };
  }, () => window.location.pathname + window.location.search, () => "/local");
}
export default function LocalLink({ href, prefetch: _prefetch, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a {...props} href={href} onClick={e => {
    onClick?.(e);
    const url = new URL(href, window.location.origin);
    if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !props.target && url.origin === window.location.origin && isLocalPath(url.pathname)) {
      e.preventDefault(); window.history.pushState(null, "", url.pathname + url.search + url.hash);
      window.dispatchEvent(new Event(event)); window.scrollTo(0, 0);
    }
  }} />;
}
