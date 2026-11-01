import "server-only";
// שרת ההרשאות (OAuth 2.1) של המערכת — עבור עוזרי AI שמתחברים לשרת ה-MCP.
// רישום לקוח אוטומטי (RFC 7591), Authorization Code + PKCE (S256 בלבד), מפתחות חידוש מתחלפים.
// המפתחות נשמרים כ-Hash בלבד. הרשאות התוכן נקבעות תמיד לפי המשתמש — ה-scope רק מצמצם (קריאה / קריאה ועריכה).
import crypto from "crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { oauthClients, oauthCodes, oauthGrants, oauthTokens, users } from "@/db/schema";
import type { Me } from "@/lib/types";
import {
  ACCESS_TTL_SEC, CODE_TTL_SEC, REFRESH_TTL_DAYS, SCOPES, accessOf, hashToken, newToken, parseScope, scopeFor,
  validRedirectUri, validResource, validScope, verifyPkce, type Access,
} from "@/lib/oauth";
import { CIMD_MAX_BYTES, isCimdClientId, loadCimd } from "@/lib/cimd";
import { loadMe } from "./auth";
import { appUrl } from "./google";
import { audit } from "./plan";

export const mcpUrl = () => `${appUrl()}/api/mcp`;

/** שגיאת OAuth בפורמט התקני ({ error, error_description }) */
export class OAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ---------------------------------------------------------------------------
// מסמכי הגדרות (/.well-known)
// ---------------------------------------------------------------------------

export function protectedResourceMetadata() {
  return {
    resource: mcpUrl(),
    authorization_servers: [appUrl()],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "תוכנית עבודה",
  };
}

export function authorizationServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    // לקוחות יכולים להזדהות בכתובת מסמך זיהוי במקום רישום (Claude: "Use Claude's published identity")
    client_id_metadata_document_supported: true,
  };
}

// ---------------------------------------------------------------------------
// רישום לקוח (Dynamic Client Registration)
// ---------------------------------------------------------------------------

export async function registerClient(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10) throw new OAuthError(400, "invalid_redirect_uri", "redirect_uris is required (1-10 URIs)");
  const bad = uris.find((u) => !validRedirectUri(u));
  if (bad) throw new OAuthError(400, "invalid_redirect_uri", `redirect URI not allowed: ${bad} (https, or http on localhost only)`);
  const method = typeof b.token_endpoint_auth_method === "string" ? b.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError(400, "invalid_client_metadata", `unsupported token_endpoint_auth_method: ${method}`);
  }
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types : ["authorization_code", "refresh_token"];
  if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError(400, "invalid_client_metadata", "only authorization_code and refresh_token grants are supported");
  }
  if (b.scope !== undefined && (typeof b.scope !== "string" || !validScope(b.scope))) {
    throw new OAuthError(400, "invalid_client_metadata", `unsupported scope (supported: ${SCOPES.join(" ")})`);
  }
  const name = (typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim() : "עוזר AI").slice(0, 80);
  const id = `wpc_${crypto.randomBytes(16).toString("base64url")}`;
  const secret = method === "none" ? null : newToken("wps");
  await db.insert(oauthClients).values({ id, name, redirectUris: uris, authMethod: method, secretHash: secret ? hashToken(secret) : null });
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPES.join(" "),
  };
}

export async function getClient(id: string | null | undefined) {
  if (!id) return null;
  if (isCimdClientId(id)) return cimdClient(id);
  if (id.length > 64) return null;
  const [c] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return c ?? null;
}

const CIMD_REFRESH_MS = 24 * 3600000;

/** לקוח שמזדהה בכתובת מסמך (CIMD): נקרא מהרשת ונשמר; מתרענן פעם ביום (אם הרענון נכשל — נשאר המידע השמור) */
async function cimdClient(url: string) {
  const [cached] = await db.select().from(oauthClients).where(eq(oauthClients.id, url));
  if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt.getTime() < CIMD_REFRESH_MS) return cached;
  try {
    const c = await loadCimd(url, { lookup: lookupAll, fetchText: fetchDoc });
    const row = { id: url, name: c.name, redirectUris: c.redirectUris, authMethod: "none", secretHash: null, fetchedAt: new Date() };
    const [saved] = await db.insert(oauthClients).values(row)
      .onConflictDoUpdate({ target: oauthClients.id, set: { name: row.name, redirectUris: row.redirectUris, fetchedAt: row.fetchedAt } }).returning();
    return saved;
  } catch (e) {
    console.warn(`CIMD client ${url}: ${(e as Error).message}`);
    return cached ?? null;
  }
}

async function lookupAll(host: string) {
  const { lookup } = await import("dns/promises");
  return (await lookup(host, { all: true })).map((a) => a.address);
}

async function fetchDoc(url: string) {
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > CIMD_MAX_BYTES) return { status: r.status, type: "", text: "x".repeat(CIMD_MAX_BYTES + 1) };
  return { status: r.status, type: r.headers.get("content-type") ?? "", text: (await r.text()).slice(0, CIMD_MAX_BYTES + 1) };
}

// ---------------------------------------------------------------------------
// מסך האישור
// ---------------------------------------------------------------------------

export type AuthorizeRequest = {
  clientId: string; clientName: string; redirectUri: string; codeChallenge: string;
  state: string | null; scope: string; canWrite: boolean;
};

/**
 * בדיקת בקשת אישור. שגיאה בלקוח או בכתובת החזרה — מוצגת למשתמש (לא מפנים לכתובת לא מאומתת);
 * שאר השגיאות — לפי התקן, חוזרות ללקוח בכתובת החזרה.
 */
export async function validateAuthorize(p: Record<string, string | undefined>):
  Promise<{ ok: true; req: AuthorizeRequest } | { ok: false; message: string } | { ok: false; redirect: string }> {
  const client = await getClient(p.client_id);
  if (!client) return { ok: false, message: "הלקוח שביקש את החיבור אינו מוכר. נסה להוסיף את החיבור מחדש בעוזר ה-AI." };
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, message: "כתובת החזרה של הלקוח אינה תואמת לרישום שלו." };
  const back = (error: string, description: string) => ({ ok: false as const, redirect: redirectWith(redirectUri, { error, error_description: description, state: p.state ?? null }) });
  if (p.response_type !== "code") return back("unsupported_response_type", "only response_type=code is supported");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  if (!validScope(p.scope)) return back("invalid_scope", `supported scopes: ${SCOPES.join(" ")}`);
  if (!validResource(p.resource, mcpUrl())) return back("invalid_target", "unknown resource");
  const requested = parseScope(p.scope);
  return {
    ok: true,
    req: {
      clientId: client.id, clientName: client.name, redirectUri, codeChallenge: p.code_challenge,
      state: p.state ?? null, scope: [...requested].join(" "), canWrite: requested.has("plan:write"),
    },
  };
}

export function redirectWith(uri: string, params: Record<string, string | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", appUrl());
  return u.toString();
}

/** המשתמש אישר: קוד חד-פעמי לכתובת החזרה של הלקוח */
export async function approve(me: Me, req: AuthorizeRequest, access: Access): Promise<string> {
  const code = newToken("wpk");
  await db.insert(oauthCodes).values({
    id: hashToken(code), clientId: req.clientId, userId: me.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge,
    scope: scopeFor(req.canWrite ? access : "read"), expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
  });
  return redirectWith(req.redirectUri, { code, state: req.state });
}

// ---------------------------------------------------------------------------
// הנפקת מפתחות
// ---------------------------------------------------------------------------

type TokenParams = Record<string, string | undefined>;

/** זיהוי הלקוח בנקודת המפתחות: לקוח ציבורי — לפי client_id; לקוח עם סוד — חובה להציג אותו */
async function authenticateClient(p: TokenParams, basic: { id: string; secret: string } | null) {
  const client = await getClient(basic?.id ?? p.client_id);
  if (!client) throw new OAuthError(401, "invalid_client", "unknown client");
  if (client.authMethod !== "none") {
    const secret = basic?.secret ?? p.client_secret;
    const ok = !!secret && !!client.secretHash && crypto.timingSafeEqual(Buffer.from(hashToken(secret)), Buffer.from(client.secretHash));
    if (!ok) throw new OAuthError(401, "invalid_client", "client authentication failed");
  }
  return client;
}

export async function tokenRequest(p: TokenParams, basic: { id: string; secret: string } | null) {
  const client = await authenticateClient(p, basic);
  if (p.grant_type === "authorization_code") return exchangeCode(client.id, p);
  if (p.grant_type === "refresh_token") return refresh(client.id, p);
  throw new OAuthError(400, "unsupported_grant_type", "supported: authorization_code, refresh_token");
}

async function exchangeCode(clientId: string, p: TokenParams) {
  if (!p.code || !p.code_verifier) throw new OAuthError(400, "invalid_request", "code and code_verifier are required");
  if (!validResource(p.resource, mcpUrl())) throw new OAuthError(400, "invalid_target", "unknown resource");
  return db.transaction(async (tx) => {
    // סימון הקוד כמשומש באותה פעולה — קוד לא יכול לשמש פעמיים גם בבקשות מקבילות
    const [code] = await tx.update(oauthCodes).set({ usedAt: new Date() })
      .where(and(eq(oauthCodes.id, hashToken(p.code!)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, new Date()))).returning();
    if (!code || code.clientId !== clientId) throw new OAuthError(400, "invalid_grant", "invalid, expired or already used code");
    if (p.redirect_uri !== undefined && p.redirect_uri !== code.redirectUri) throw new OAuthError(400, "invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(p.code_verifier!, code.codeChallenge)) throw new OAuthError(400, "invalid_grant", "PKCE verification failed");
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, code.userId));
    if (u?.status !== "APPROVED") throw new OAuthError(400, "invalid_grant", "user is not active");
    // חיבור אחד לכל משתמש + לקוח: חיבור מחדש מעדכן את החיבור הקיים (במקום לצבור חיבורים כפולים)
    const [existing] = await tx.select().from(oauthGrants)
      .where(and(eq(oauthGrants.userId, code.userId), eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)));
    let grantId: number;
    if (existing) {
      await tx.update(oauthGrants).set({ scope: code.scope }).where(eq(oauthGrants.id, existing.id));
      grantId = existing.id;
    } else {
      const [g] = await tx.insert(oauthGrants).values({ userId: code.userId, clientId, scope: code.scope }).returning();
      grantId = g.id;
      const [c] = await tx.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.id, clientId));
      await audit(tx, code.userId, "ai_connection", g.id, "create", { client: c?.name, access: accessOf(code.scope) },
        `חובר עוזר AI: ${c?.name ?? clientId} (${accessOf(code.scope) === "write" ? "קריאה ועריכה" : "קריאה בלבד"})`);
    }
    return issue(tx, grantId, code.scope);
  });
}

async function refresh(clientId: string, p: TokenParams) {
  if (!p.refresh_token) throw new OAuthError(400, "invalid_request", "refresh_token is required");
  return db.transaction(async (tx) => {
    // מפתח חידוש חד-פעמי: נמחק עם השימוש ומוחלף בחדש (Rotation)
    const [t] = await tx.delete(oauthTokens)
      .where(and(eq(oauthTokens.id, hashToken(p.refresh_token!)), eq(oauthTokens.kind, "refresh"), gt(oauthTokens.expiresAt, new Date()))).returning();
    if (!t) throw new OAuthError(400, "invalid_grant", "invalid or expired refresh token");
    const [g] = await tx.select({ grant: oauthGrants, status: users.status }).from(oauthGrants)
      .innerJoin(users, eq(users.id, oauthGrants.userId)).where(eq(oauthGrants.id, t.grantId));
    if (!g || g.grant.revokedAt || g.grant.clientId !== clientId || g.status !== "APPROVED") throw new OAuthError(400, "invalid_grant", "connection was revoked");
    // ה-scope נקבע לפי החיבור (המשתמש יכול לשנות אותו ב"חיבורי AI"); בקשה לצמצם — מכובדת
    const scope = p.scope && accessOf(p.scope) === "read" ? scopeFor("read") : g.grant.scope;
    return issue(tx, g.grant.id, scope);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function issue(tx: Tx, grantId: number, scope: string) {
  const access = newToken("wpa"), refreshTok = newToken("wpr");
  const now = Date.now();
  await tx.insert(oauthTokens).values([
    { id: hashToken(access), grantId, kind: "access", expiresAt: new Date(now + ACCESS_TTL_SEC * 1000) },
    { id: hashToken(refreshTok), grantId, kind: "refresh", expiresAt: new Date(now + REFRESH_TTL_DAYS * 86400000) },
  ]);
  // ניקוי שוטף של מה שפג תוקפו
  await tx.delete(oauthTokens).where(lt(oauthTokens.expiresAt, new Date(now)));
  await tx.delete(oauthCodes).where(or(lt(oauthCodes.expiresAt, new Date(now - 3600000)), lt(oauthCodes.usedAt, new Date(now - 3600000))));
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SEC, refresh_token: refreshTok, scope };
}

/** ביטול מפתח (RFC 7009) — מבטל את החיבור כולו */
export async function revokeToken(p: TokenParams, basic: { id: string; secret: string } | null) {
  const client = await authenticateClient(p, basic);
  if (!p.token) return;
  const [t] = await db.select().from(oauthTokens).where(eq(oauthTokens.id, hashToken(p.token)));
  if (!t) return;
  const [g] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, t.grantId));
  if (g && g.clientId === client.id) await revokeGrant(g.id);
}

// ---------------------------------------------------------------------------
// זיהוי בקריאות ל-MCP
// ---------------------------------------------------------------------------

export type McpAuth = { me: Me; access: Access; grantId: number; clientName: string; token: string; expiresAt: number };

export async function authenticateBearer(header: string | null): Promise<McpAuth | null> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const [row] = await db.select({ t: oauthTokens, g: oauthGrants, clientName: oauthClients.name }).from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthTokens.id, hashToken(token)), eq(oauthTokens.kind, "access"), gt(oauthTokens.expiresAt, new Date()), isNull(oauthGrants.revokedAt)));
  if (!row) return null;
  // המשתמש נבדק בכל קריאה: השעיה / שינוי הרשאות חלים מיד גם על עוזר ה-AI
  const me = await loadMe(row.g.userId);
  if (!me || me.status !== "APPROVED") return null;
  if (!row.g.lastUsedAt || Date.now() - row.g.lastUsedAt.getTime() > 5 * 60000) {
    await db.update(oauthGrants).set({ lastUsedAt: new Date() }).where(eq(oauthGrants.id, row.g.id));
  }
  // ה-scope העדכני של החיבור (ייתכן שהמשתמש שינה אותו לקריאה בלבד אחרי שהמפתח הונפק)
  return { me, access: accessOf(row.g.scope), grantId: row.g.id, clientName: row.clientName, token, expiresAt: Math.floor(row.t.expiresAt.getTime() / 1000) };
}

// ---------------------------------------------------------------------------
// "חיבורי AI" בהגדרות המשתמש
// ---------------------------------------------------------------------------

export type ConnectionDTO = { id: number; client: string; access: Access; createdAt: string; lastUsedAt: string | null };

export async function listConnections(me: Me): Promise<ConnectionDTO[]> {
  const rows = await db.select({ g: oauthGrants, name: oauthClients.name }).from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthGrants.userId, me.id), isNull(oauthGrants.revokedAt)));
  return rows.sort((a, b) => b.g.createdAt.getTime() - a.g.createdAt.getTime()).map(({ g, name }) => ({
    id: g.id, client: name, access: accessOf(g.scope), createdAt: g.createdAt.toISOString(), lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));
}

async function ownGrant(me: Me, id: number) {
  const [g] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.id, id), eq(oauthGrants.userId, me.id), isNull(oauthGrants.revokedAt)));
  return g ?? null;
}

export async function setConnectionAccess(me: Me, id: number, access: Access) {
  const g = await ownGrant(me, id);
  if (!g) return false;
  await db.update(oauthGrants).set({ scope: scopeFor(access) }).where(eq(oauthGrants.id, id));
  await audit(db, me.id, "ai_connection", id, "update", { access }, `הרשאת עוזר AI שונתה ל${access === "write" ? "קריאה ועריכה" : "קריאה בלבד"}`);
  return true;
}

export async function revokeConnection(me: Me, id: number) {
  const g = await ownGrant(me, id);
  if (!g) return false;
  await revokeGrant(id);
  await audit(db, me.id, "ai_connection", id, "revoke", null, "עוזר AI נותק");
  return true;
}

async function revokeGrant(id: number) {
  await db.transaction(async (tx) => {
    await tx.update(oauthGrants).set({ revokedAt: new Date() }).where(eq(oauthGrants.id, id));
    await tx.delete(oauthTokens).where(eq(oauthTokens.grantId, id));
  });
}
