// אימות לקוח OAuth בחתימה (private_key_jwt, RFC 7523 §2.2): הלקוח (למשל ChatGPT) שולח בבקשת המפתחות
// JWT קצר-מועד שחתום במפתח הפרטי שלו, והשרת מאמת אותו מול המפתח הציבורי שהלקוח מפרסם (jwks_uri במסמך הזיהוי).
// לוגיקה טהורה — המפתחות והזמן מוזרקים, כדי שאפשר לבדוק בלי רשת.
import crypto from "crypto";

export const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
export type Jwk = crypto.JsonWebKey & { kid?: string; alg?: string; use?: string };

const SKEW_SEC = 60; // סטיית שעונים מותרת
const MAX_LIFETIME_SEC = 3600; // לא מקבלים חתימה שתקפה לזמן ארוך מדי

export class AssertionError extends Error {}

function decode(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length !== 3 || jwt.length > 8192) throw new AssertionError("malformed client assertion");
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
  } catch { throw new AssertionError("malformed client assertion"); }
}

/** מי חתם (iss) — לפני האימות, רק כדי לדעת איזה לקוח לטעון כשלא נשלח client_id */
export function assertionIssuer(jwt: string): string | null {
  try { const iss = decode(jwt).payload.iss; return typeof iss === "string" ? iss : null; } catch { return null; }
}

/** המפתח המתאים: לפי kid אם צוין, אחרת כל מפתח חתימה מאותו סוג */
function candidates(keys: Jwk[], kid: unknown, kty: string) {
  const sig = keys.filter((k) => k.kty === kty && (!k.use || k.use === "sig"));
  return typeof kid === "string" ? sig.filter((k) => k.kid === kid) : sig;
}

function verifySignature(alg: string, input: string, sig: Buffer, key: Jwk): boolean {
  try {
    const pub = crypto.createPublicKey({ key, format: "jwk" });
    if (alg === "RS256") return crypto.verify("sha256", Buffer.from(input), pub, sig);
    if (alg === "PS256") return crypto.verify("sha256", Buffer.from(input), { key: pub, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sig);
    if (alg === "ES256") return crypto.verify("sha256", Buffer.from(input), { key: pub, dsaEncoding: "ieee-p1363" }, sig);
    return false;
  } catch { return false; }
}

/**
 * אימות מלא: חתימה (RS256 / PS256 / ES256 בלבד — לא "none" ולא HMAC), iss = sub = client_id,
 * aud = כתובת נקודת המפתחות / ה-issuer, תוקף (exp קיים, לא פג, לא ארוך מדי; nbf אם קיים).
 * מחזיר מפתח לזיהוי שימוש חוזר (jti, או טביעת אצבע של החתימה כולה).
 */
export function verifyClientAssertion(jwt: string, o: { clientId: string; audiences: string[]; keys: Jwk[]; now?: number }): { replayKey: string; expiresAt: number } {
  const { header, payload, signingInput, signature } = decode(jwt);
  const alg = String(header.alg ?? "");
  const kty = alg === "ES256" ? "EC" : alg === "RS256" || alg === "PS256" ? "RSA" : "";
  if (!kty) throw new AssertionError(`unsupported client assertion algorithm: ${alg || "none"}`);
  const keys = candidates(o.keys, header.kid, kty);
  if (!keys.length) throw new AssertionError("no matching key for the client assertion");
  if (!keys.some((k) => verifySignature(alg, signingInput, signature, k))) throw new AssertionError("invalid client assertion signature");
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  if (payload.iss !== o.clientId || payload.sub !== o.clientId) throw new AssertionError("client assertion iss/sub must equal the client_id");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const norm = (s: unknown) => String(s ?? "").replace(/\/+$/, "");
  if (!aud.some((a) => o.audiences.map(norm).includes(norm(a)))) throw new AssertionError("client assertion audience does not match this server");
  const exp = payload.exp;
  if (typeof exp !== "number" || exp < now - SKEW_SEC) throw new AssertionError("client assertion expired");
  if (exp > now + MAX_LIFETIME_SEC) throw new AssertionError("client assertion lifetime too long");
  if (typeof payload.nbf === "number" && payload.nbf > now + SKEW_SEC) throw new AssertionError("client assertion not yet valid");
  const jti = typeof payload.jti === "string" && payload.jti ? payload.jti : null;
  const replayKey = `${o.clientId}|${jti ?? crypto.createHash("sha256").update(jwt).digest("hex")}`;
  return { replayKey, expiresAt: (exp + SKEW_SEC) * 1000 };
}
