// חלוקת תקופת האנליטיקות לדליים: עד חודשיים — לפי יום; עד שנה — לפי שבוע (מיום ראשון); מעבר — לפי חודש.
import { addDays, daysDiff, weekStartOf } from "./weeks";

export type Granularity = "day" | "week" | "month";

export function granularityFor(from: string, to: string): Granularity {
  const span = daysDiff(from, to) + 1;
  return span <= 62 ? "day" : span <= 400 ? "week" : "month";
}
export function bucketOf(day: string, g: Granularity) {
  return g === "day" ? day : g === "week" ? weekStartOf(day) : `${day.slice(0, 7)}-01`;
}
/** כל הדליים בטווח (גם ריקים — כדי שהגרף לא "ידלג" על ימים בלי פעילות) */
export function bucketsBetween(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const b = bucketOf(d, g); if (out[out.length - 1] !== b) out.push(b); }
  return out;
}

