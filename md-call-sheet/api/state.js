import { guard, redis, ensureSeeded, K, TILES } from "./_lib.js";

// GET ?v=<version the page has>&tv=<restaurant version the page has>
// Answers {same:true} when nothing changed, so polling stays cheap.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["GET"] })) return;
  try {
    await ensureSeeded();
    const [ver] = await redis(["GET", K.ver]);
    const v = String(+ver || 0);
    if (req.query?.v === v) return res.status(200).json({ same: true, ver: +v });
    const [tv, prefsRaw, doneFlat] = await redis(["GET", K.tver], ["GET", K.prefs], ["HGETALL", K.done]);
    const done = [];
    for (let i = 1; i < (doneFlat || []).length; i += 2) { try { done.push(JSON.parse(doneFlat[i])); } catch {} }
    const out = { ver: +v, tv: +tv || 0, prefs: prefsRaw ? JSON.parse(prefsRaw) : { paused: false }, done };
    if (req.query?.tv !== String(out.tv)) {
      const [raws] = await redis(["MGET", ...TILES.map(T => K.tile(T.id))]);
      out.tiles = {};
      TILES.forEach((T, i) => { if (raws[i]) out.tiles[T.id] = JSON.parse(raws[i]); });
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: "Couldn't reach storage. Try again in a moment.", code: "storage" });
  }
}
