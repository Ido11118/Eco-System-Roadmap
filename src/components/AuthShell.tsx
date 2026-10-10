import { CalendarRange } from "lucide-react";
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "radial-gradient(1200px 500px at 80% -10%, #dbeafe 0%, transparent 60%), #f4f6f9" }}>
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2.5 justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"><CalendarRange size={20} /></span>
          <span className="text-[18px] font-bold text-ink-900">תוכנית עבודה</span>
        </div>
        <div className="card shadow-pop p-7">
          <h1 className="text-[20px] font-bold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FormError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{msg}</div>;
}
