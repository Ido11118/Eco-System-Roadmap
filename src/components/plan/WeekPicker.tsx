"use client";
import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addWeeks, fmtShort, isISODate, weekEndOf, weekNumber, weekStartOf, weekYear, type ISODate } from "@/lib/weeks";

/** בחירת שבוע: בחירת תאריך כלשהו מצמידה אותו ליום ראשון של אותו שבוע */
export function WeekPicker({ value, onChange, disabled, min, id }: {
  value: ISODate; onChange: (v: ISODate) => void; disabled?: boolean; min?: ISODate; id?: string;
}) {
  const label = useMemo(() => `שבוע ${weekNumber(value)} · ${weekYear(value)} (${fmtShort(value)}–${fmtShort(weekEndOf(value))})`, [value]);
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="icon-btn" disabled={disabled || (!!min && addWeeks(value, -1) < min)} onClick={() => onChange(addWeeks(value, -1))} aria-label="שבוע קודם"><ChevronRight size={14} /></button>
      <label className="relative flex-1">
        <span className="input flex items-center truncate whitespace-nowrap text-[12.5px] tabular-nums">{label}</span>
        <input id={id} type="date" disabled={disabled} value={value} min={min}
          onChange={(e) => { if (isISODate(e.target.value)) onChange(weekStartOf(e.target.value)); }}
          className="absolute inset-0 cursor-pointer opacity-0" aria-label={label} />
      </label>
      <button type="button" className="icon-btn" disabled={disabled} onClick={() => onChange(addWeeks(value, 1))} aria-label="שבוע הבא"><ChevronLeft size={14} /></button>
    </div>
  );
}
