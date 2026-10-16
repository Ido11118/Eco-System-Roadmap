"use client";
// קטלוג הסטטוסים והתיעדופים בצד הלקוח: נטען מהשרת עם הדף (ללא הבהוב צבעים) ומתעדכן ברענון התקופתי.
// כל התצוגות (גאנט, טבלה, מקרא, סינון, חלונית תכולה) קוראות ממנו — כך שינוי בהגדרות משפיע מיד על כולן.
import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEFAULT_CATALOG, makeCatalog, type Catalog, type CatalogData } from "@/lib/catalog";

const Ctx = createContext<Catalog | null>(null);
export const CATALOG_KEY = ["catalog"];

export function CatalogProvider({ initial, children }: { initial?: CatalogData; children: React.ReactNode }) {
  const q = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => api<CatalogData>("GET", "/api/catalog"),
    initialData: initial,
    staleTime: 60000,
    refetchInterval: 120000,
  });
  const cat = useMemo(() => makeCatalog(q.data ?? DEFAULT_CATALOG), [q.data]);
  return <Ctx.Provider value={cat}>{children}</Ctx.Provider>;
}

export function useCatalog(): Catalog {
  const c = useContext(Ctx);
  return c ?? makeCatalog(DEFAULT_CATALOG);
}
