"use client";
// איתור תכולה במסך (מתוך החיפוש): מוודא שהיא מוצגת (מבטל סינון שמסתיר אותה), גולל אליה ומהבהב.
import type { PlanData, ViewConfig } from "@/lib/types";
import { itemMatches, timeWindow, visibleTeamIds } from "./filters";

export function locateItem(id: number, data: PlanData, view: ViewConfig, setView: (v: ViewConfig) => void, mode: "gantt" | "table" | "compare"): string | null {
  const item = data.items.find((i) => i.id === id);
  if (!item) return "התכולה לא נמצאה";
  let next = view;
  const notes: string[] = [];
  // צוות מוסתר בסינון תחום/צוות
  if (item.teamId !== null && !visibleTeamIds(data, view).has(item.teamId)) {
    next = { ...next, domainIds: [], teamIds: [] }; notes.push("סינון התחום/צוות");
  }
  // מחוץ לחלון הזמן המוצג
  const [w0, w1] = timeWindow(view.time, data);
  if (item.endWeek < w0 || item.startWeek > w1) { next = { ...next, time: { kind: "all" } }; notes.push("טווח הזמן"); }
  // בטבלה סינון סטטוס/תיעדוף מסתיר שורות (בגאנט רק מעמעם)
  if (mode === "table" && !itemMatches(item, { ...next, search: "" })) { next = { ...next, statuses: [], priorities: [] }; notes.push("סינון הסטטוס/תיעדוף"); }
  if (mode === "gantt" && next.showItems === false) { next = { ...next, showItems: true }; notes.push("הסתרת התכולות"); }
  if (next !== view) setView(next);
  // מאפשר לתצוגות לחשוף את התכולה (למשל לפתוח מקטע מכווץ בטבלה) לפני הגלילה
  window.dispatchEvent(new CustomEvent("wp:locate", { detail: { id, teamId: item.teamId } }));
  // ממתינים לרינדור לפני הגלילה
  let tries = 0;
  const tick = () => {
    const el = document.querySelector<HTMLElement>(`[data-bar="${id}"], [data-item-row="${id}"], [data-unit="${id}"] [data-actual], [data-unit="${id}"] [data-plan]`);
    if (!el) { if (tries++ < 20) setTimeout(tick, 50); return; }
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    el.classList.remove("locate-flash");
    void el.offsetWidth; // הפעלה מחדש של האנימציה
    el.classList.add("locate-flash");
    setTimeout(() => el.classList.remove("locate-flash"), 2400);
  };
  requestAnimationFrame(tick);
  return notes.length ? `הוצג לאחר ביטול ${notes.join(" ו")}` : null;
}
