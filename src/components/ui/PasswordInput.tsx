"use client";
import clsx from "clsx";
import { Eye, EyeOff, CircleCheck } from "lucide-react";

/** שדה סיסמה עם "עין" להצגה/הסתרה, וסימון V כשהאימות תואם */
export function PasswordInput({ id, value, onChange, show, onToggle, status, autoComplete = "new-password", minLength = 8 }: {
  id: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; status?: "match" | "mismatch";
  autoComplete?: string; minLength?: number;
}) {
  return (
    <div className="relative">
      <input id={id} className={clsx("input h-10 pl-16", status === "match" && "border-green-500", status === "mismatch" && "border-red-400")}
        dir="ltr" type={show ? "text" : "password"} minLength={minLength} required autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="absolute inset-y-0 left-1.5 flex items-center gap-1">
        {status === "match" && <CircleCheck size={16} className="text-green-600" aria-label="הסיסמאות תואמות" data-testid={`${id}-match`} />}
        <button type="button" className="icon-btn h-7 w-7" onClick={onToggle} aria-label={show ? "הסתרת הסיסמה" : "הצגת הסיסמה"} title={show ? "הסתרת הסיסמה" : "הצגת הסיסמה"} data-testid={`${id}-eye`}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}
