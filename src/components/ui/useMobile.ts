"use client";
// מסך צר (טלפון): מתחת ל-768px — אותו גבול כמו md: של Tailwind. במחשב שום דבר לא משתנה.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

/** מכשיר מגע בלי עכבר (אין "ריחוף") */
export const isTouchOnly = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
