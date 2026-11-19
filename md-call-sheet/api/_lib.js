// Shared helpers for the API routes. Files starting with "_" are not routes on Vercel.
import crypto from "node:crypto";

/* ---------------- storage (Upstash Redis over REST) ---------------- */

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// In-memory stand-in, only for local testing (CS_MEMORY=1).
const mem = globalThis.__csMem || (globalThis.__csMem = { kv: new Map(), h: new Map() });
function memCmd([op, ...a]) {
  const { kv, h } = mem;
  switch (op.toUpperCase()) {
    case "GET": return kv.has(a[0]) ? kv.get(a[0]) : null;
    case "SET": {
      const nx = a.slice(2).map(String).map(s => s.toUpperCase()).includes("NX");
      if (nx && kv.has(a[0])) return null;
      kv.set(a[0], String(a[1])); return "OK";
    }
    case "MGET": return a.map(k => (kv.has(k) ? kv.get(k) : null));
    case "INCR": { const v = (+(kv.get(a[0]) || 0)) + 1; kv.set(a[0], String(v)); return v; }
    case "EXPIRE": return 1;
    case "DEL": { let n = 0; for (const k of a) { if (kv.delete(k)) n++; if (h.delete(k)) n++; } return n; }
    case "HSET": { const m = h.get(a[0]) || new Map(); h.set(a[0], m); for (let i = 1; i < a.length; i += 2) m.set(a[i], String(a[i + 1])); return 1; }
    case "HDEL": { const m = h.get(a[0]); let n = 0; if (m) for (const f of a.slice(1)) if (m.delete(f)) n++; return n; }
    case "HGETALL": { const m = h.get(a[0]); return m ? [...m].flat() : []; }
    default: throw new Error("memory store: unsupported " + op);
  }
}

export function storageReady() {
  return process.env.CS_MEMORY === "1" || (REDIS_URL && REDIS_TOKEN);
}

// Run several commands in one round trip; returns their results in order.
export async function redis(...cmds) {
  if (process.env.CS_MEMORY === "1") return cmds.map(memCmd);
  const r = await fetch(REDIS_URL.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error("storage: " + x.error); return x.result; });
}

/* ---------------- keys ---------------- */

export const K = {
  ver: "cs:ver",              // bumps on any change
  tver: "cs:tiles:ver",       // bumps when restaurants change
  prefs: "cs:prefs",
  done: "cs:done",            // hash: restaurant id -> check-off
  seeded: "cs:seeded",
  tile: id => "cs:tile:" + id,
};

/* ---------------- Maryland grid ---------------- */

export const MD_AREA = 3600162112; // OpenStreetMap relation 162112 (Maryland)
export const TILES = [];
{
  const S = 37.88, N = 39.73, W = -79.49, E = -75.04, R = 6, C = 8;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const s = S + (N - S) * r / R, n = S + (N - S) * (r + 1) / R, w = W + (E - W) * c / C, e = W + (E - W) * (c + 1) / C;
    TILES.push({ id: `tile-${r}-${c}`, bb: [s, w, n, e].map(x => +x.toFixed(4)) });
  }
}
export const tileById = id => TILES.find(t => t.id === id);

/* ---------------- first-run seeding ---------------- */

export async function ensureSeeded() {
  const [seeded] = await redis(["GET", K.seeded]);
  if (seeded) return;
  const [lock] = await redis(["SET", "cs:seeding", "1", "NX", "EX", "60"]);
  if (!lock) return; // another request is seeding right now
  const { default: seed } = await import("../data/seed.js");
  const cmds = [];
  for (const T of TILES) {
    const t = seed.tiles[T.id];
    if (t) cmds.push(["SET", K.tile(T.id), JSON.stringify({ bb: T.bb, syncedAt: t.syncedAt || 0, items: t.items || [] })]);
  }
  for (const d of seed.done || []) cmds.push(["HSET", K.done, d.i, JSON.stringify(d)]);
  cmds.push(["SET", K.prefs, JSON.stringify(seed.prefs || { paused: false })]);
  // keep each request small
  for (let i = 0; i < cmds.length; i += 8) await redis(...cmds.slice(i, i + 8));
  await redis(["INCR", K.tver], ["INCR", K.ver], ["SET", K.seeded, "1"]);
}

/* ---------------- team-password sessions ---------------- */

function secretKey() {
  const p = process.env.TEAM_PASSWORD;
  if (!p) return null;
  return crypto.createHash("sha256").update("cs-v1:" + p + ":" + (process.env.SESSION_SECRET || "")).digest();
}
export function sessionToken() {
  return crypto.createHmac("sha256", secretKey()).update("session").digest("hex");
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function samePassword(given) {
  const want = process.env.TEAM_PASSWORD || "";
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return want.length > 0 && crypto.timingSafeEqual(a, b);
}
export function isSignedIn(req) {
  if (!secretKey()) return false;
  const got = cookies(req).cs_auth || "";
  const want = sessionToken();
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export function setSession(res, on) {
  const secure = process.env.CS_INSECURE_COOKIE === "1" ? "" : " Secure;";
  res.setHeader("Set-Cookie", on
    ? `cs_auth=${sessionToken()}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    : `cs_auth=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`);
}

// Common checks for every data route. Returns false (and answers) when the request can't go on.
export function guard(req, res, { methods }) {
  res.setHeader("Cache-Control", "no-store");
  if (!methods.includes(req.method)) { res.status(405).json({ error: "Not allowed", code: "method" }); return false; }
  if (!process.env.TEAM_PASSWORD) { res.status(500).json({ error: "The team password isn't set up yet. Add TEAM_PASSWORD in the Vercel project's settings.", code: "setup" }); return false; }
  if (!storageReady()) { res.status(500).json({ error: "Storage isn't connected yet. Add an Upstash Redis store in the Vercel project's Storage tab.", code: "setup" }); return false; }
  if (!isSignedIn(req)) { res.status(401).json({ error: "Sign in", code: "auth" }); return false; }
  if (req.method === "POST" && !String(req.headers["content-type"] || "").includes("application/json")) {
    res.status(415).json({ error: "Expected JSON", code: "type" }); return false;
  }
  return true;
}

export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

/* ---------------- restaurant records ---------------- */

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = v => (typeof v === "number" && isFinite(v) ? +v.toFixed(5) : null);

// Keep only the fields the page uses, with sane sizes.
export function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  const i = str(it.i, 40), n = str(it.n, 200);
  if (!/^[nwr]\d{1,20}$/.test(i) || !n) return null;
  return { i, n, a: str(it.a, 200), c: str(it.c, 100), p: str(it.p, 60), k: str(it.k, 80), la: num(it.la), lo: num(it.lo), f: typeof it.f === "number" ? it.f : 0 };
}

export function keepTags(t) {
  return t && t.name && (!t.amenity || t.amenity === "restaurant") && !t.website && !t["contact:website"] && !t.url && !t.brand && !t["brand:wikidata"];
}

export function toItem(el) {
  const t = el.tags || {};
  if (t["addr:state"] && !/^(MD|Maryland)$/i.test(t["addr:state"])) return null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return cleanItem({
    i: `${String(el.type)[0]}${el.id}`, n: t.name, a: street, c: t["addr:city"] || "",
    p: t.phone || t["contact:phone"] || t["contact:mobile"] || "", k: t.cuisine || "",
    la: el.lat ?? el.center?.lat, lo: el.lon ?? el.center?.lon, f: 0,
  });
}

// "New this week" marks: a restaurant is new if its region was already loaded and it wasn't there before.
export function stampNew(items, prevItems, regionExisted) {
  const prev = new Map((prevItems || []).map(i => [i.i, i]));
  const now = Date.now();
  let added = 0;
  for (const it of items) {
    const p = prev.get(it.i);
    if (p) it.f = p.f || 0;
    else { it.f = regionExisted ? now : 0; if (regionExisted) added++; }
  }
  return added;
}

export async function readTile(id) {
  const [raw] = await redis(["GET", K.tile(id)]);
  return raw ? JSON.parse(raw) : null;
}
export async function writeTile(T, items) {
  await redis(["SET", K.tile(T.id), JSON.stringify({ bb: T.bb, syncedAt: Date.now(), items })], ["INCR", K.tver], ["INCR", K.ver]);
}

/* ---------------- OpenStreetMap (Overpass) ---------------- */

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function fetchRegion(T) {
  const [s, w, n, e] = T.bb;
  const q = `[out:json][timeout:60];nwr["amenity"="restaurant"]["name"][!"website"][!"contact:website"][!"url"][!"brand"][!"brand:wikidata"](${s},${w},${n},${e})(area:${MD_AREA});out center tags;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MarylandCallSheet/1.0 (small private tool)" },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) { lastErr = new Error("map server " + r.status); continue; }
      const j = await r.json();
      if (!Array.isArray(j.elements)) { lastErr = new Error("map server answer"); continue; }
      return j.elements;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("map servers");
}

export async function syncRegion(T) {
  const elements = await fetchRegion(T);
  const prev = await readTile(T.id);
  const seen = new Set(), items = [];
  for (const el of elements) {
    if (!keepTags(el.tags)) continue;
    const it = toItem(el);
    if (it && !seen.has(it.i)) { seen.add(it.i); items.push(it); }
  }
  const added = stampNew(items, prev?.items, !!prev);
  await writeTile(T, items);
  return { added, count: items.length };
}
