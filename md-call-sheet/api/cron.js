import { redis, storageReady, ensureSeeded, syncRegion, TILES, K } from "./_lib.js";

// Runs once a day (see vercel.json). Refreshes the regions that were updated longest ago.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const fromVercel = secret
    ? req.headers.authorization === `Bearer ${secret}`
    : String(req.headers["user-agent"] || "").startsWith("vercel-cron");
  if (!fromVercel) return res.status(401).json({ error: "Not allowed" });
  if (!process.env.TEAM_PASSWORD || !storageReady()) return res.status(200).json({ skipped: "not set up" });
  await ensureSeeded();
  const [prefsRaw] = await redis(["GET", K.prefs]);
  if (prefsRaw && JSON.parse(prefsRaw).paused) return res.status(200).json({ skipped: "paused" });
  const [raws] = await redis(["MGET", ...TILES.map(T => K.tile(T.id))]);
  const order = TILES.map((T, i) => ({ T, at: raws[i] ? JSON.parse(raws[i]).syncedAt || 0 : 0 })).sort((a, b) => a.at - b.at);
  const started = Date.now();
  let ok = 0, failed = 0, added = 0;
  for (const { T } of order) {
    if (Date.now() - started > 240000) break;
    try { const r = await syncRegion(T); ok++; added += r.added; } catch { failed++; if (failed >= 3 && !ok) break; }
  }
  res.status(200).json({ ok, failed, added });
}
