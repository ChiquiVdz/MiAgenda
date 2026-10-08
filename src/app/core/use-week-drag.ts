"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { ScheduleInput } from "../../../reconstruction/core/src/contracts";
import { atTime, dateParts, plusDays } from "./dates";
import type { Mutate } from "./use-core-feed";

type Timed = Extract<ScheduleInput, { mode: "timed" }>;
export type WeekDragItem = Pick<ActivityView, "id" | "title" | "revision" | "schedule">;
type Preview = { id: string; title: string; schedule: Timed };
type Gesture = {
  item: WeekDragItem; mode: "move" | "start" | "end"; pointerId: number; x: number; y: number;
  start: number; end: number; active: boolean; target: HTMLElement; preview: Preview | null;
};

/** Pointer preview is local. Only releasing a changed gesture sends a command. */
export function useWeekDrag(scroll: RefObject<HTMLDivElement | null>, weekStart: string, disabled: boolean, mutate: Mutate) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const gesture = useRef<Gesture | null>(null), suppressClickUntil = useRef(0);
  const latest = useRef({ weekStart, disabled, mutate }); latest.current = { weekStart, disabled, mutate };
  function cancel() {
    const current = gesture.current; gesture.current = null; setPreview(null);
    if (current?.active) suppressClickUntil.current = Date.now() + 500;
    if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); cancel(); } };
    const blur = () => cancel();
    window.addEventListener("keydown", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => { cancel(); }, [weekStart, disabled]);

  function down(event: ReactPointerEvent<HTMLDivElement>, item: WeekDragItem) {
    if (latest.current.disabled || !event.isPrimary || event.button !== 0 || item.schedule?.mode !== "timed" || gesture.current) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-resize]")?.dataset.resize;
    gesture.current = { item, mode: edge === "start" || edge === "end" ? edge : "move", pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, start: Date.parse(item.schedule.startsAt!), end: Date.parse(item.schedule.endsAt!), active: false, target: event.currentTarget, preview: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current, container = scroll.current;
    if (!current || current.pointerId !== event.pointerId || !container) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.active = true; event.preventDefault();
    const viewport = container.getBoundingClientRect();
    if (event.clientY < viewport.top + 95) container.scrollTop -= 18;
    else if (event.clientY > viewport.bottom - 35) container.scrollTop += 18;
    if (event.clientX < viewport.left + 25) container.scrollLeft -= 18;
    else if (event.clientX > viewport.right - 25) container.scrollLeft += 18;
    const columns = [...container.querySelectorAll<HTMLElement>(".core-day-column")];
    if (!columns.length) return;
    const rects = columns.map(column => column.getBoundingClientRect());
    if (event.clientX < rects[0].left || event.clientX > rects[rects.length - 1].right || event.clientY < viewport.top + 76 || event.clientY > viewport.bottom) {
      current.preview = null; setPreview(null); return;
    }
    const index = rects.findIndex(rect => event.clientX >= rect.left && event.clientX <= rect.right);
    if (index < 0) return;
    const minutes = Math.round((event.clientY - rects[index].top) / 15) * 15;
    let start = current.start, end = current.end;
    if (current.mode === "move") {
      const origin = dateParts(new Date(current.start));
      // Anchor the pointer's original position, including scrolling since pointerdown.
      const originalRectTop = Number(current.target.dataset.dragOriginTop);
      const initialMinute = Math.round((current.y - originalRectTop) / 15) * 15;
      const originTime = +origin.time.slice(0, 2) * 60 + +origin.time.slice(3);
      const nextMinute = Math.max(0, Math.min(1425, Math.round((originTime + minutes - initialMinute) / 15) * 15));
      const date = plusDays(origin.date, index - Number(current.target.dataset.dragOriginDay));
      start = Date.parse(atTime(date, `${String(Math.floor(nextMinute / 60)).padStart(2, "0")}:${String(nextMinute % 60).padStart(2, "0")}`));
      end = start + current.end - current.start;
    } else {
      const original = dateParts(new Date(current.mode === "start" ? current.start : current.end));
      const initialMinute = Math.round((current.y - Number(current.target.dataset.dragOriginTop)) / 15) * 15;
      const boundaryMinute = +original.time.slice(0, 2) * 60 + +original.time.slice(3);
      const shifted = boundaryMinute + minutes - initialMinute;
      const dayDelta = Math.floor(shifted / 1440), minute = ((shifted % 1440) + 1440) % 1440;
      const date = plusDays(original.date, index - Number(current.target.dataset.dragOriginDay) + dayDelta);
      const instant = Date.parse(atTime(date, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`));
      if (current.mode === "start") start = Math.min(instant, end - 900000);
      else end = Math.max(instant, start + 900000);
    }
    current.preview = { id: current.item.id, title: current.item.title, schedule: { mode: "timed", calendarId: current.item.schedule!.calendarId, timeZone: current.item.schedule!.timeZone, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() } };
    setPreview(current.preview);
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const viewport = scroll.current?.getBoundingClientRect();
    const columns = scroll.current?.querySelectorAll<HTMLElement>(".core-day-column");
    const first = columns?.[0]?.getBoundingClientRect(), last = columns?.[6]?.getBoundingClientRect();
    const inside = viewport && first && last && event.clientY >= viewport.top + 76 && event.clientY <= viewport.bottom && event.clientX >= first.left && event.clientX <= last.right;
    const changed = inside && current.active && current.preview && (current.preview.schedule.startsAt !== current.item.schedule!.startsAt || current.preview.schedule.endsAt !== current.item.schedule!.endsAt);
    cancel();
    if (changed && !latest.current.disabled) void latest.current.mutate({ action: "scheduleTask", id: current.item.id, expectedRevision: current.item.revision, schedule: current.preview!.schedule });
  }
  function begin(event: ReactPointerEvent<HTMLDivElement>, item: WeekDragItem, dayIndex: number) {
    const column = event.currentTarget.closest<HTMLElement>(".core-day-column");
    if (column) { event.currentTarget.dataset.dragOriginTop = String(column.getBoundingClientRect().top); event.currentTarget.dataset.dragOriginDay = String(dayIndex); }
    down(event, item);
  }
  return { preview, begin, move, up, cancel, suppressClick: () => Date.now() < suppressClickUntil.current };
}
