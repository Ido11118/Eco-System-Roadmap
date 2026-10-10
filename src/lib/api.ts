// לקוח API קטן ואחיד לכל הקריאות מהדפדפן
export class ApiErr extends Error {
  constructor(public status: number, message: string, public data?: { conflict?: string; [k: string]: unknown }) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiErr(0, "אין חיבור לשרת. בדוק את חיבור הרשת ונסה שוב.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
      window.location.href = "/login";
    }
    throw new ApiErr(res.status, json.error ?? "שגיאה לא צפויה", json.data);
  }
  return json as T;
}
