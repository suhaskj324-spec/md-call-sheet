import { guard, redis, body, cleanItem, readTile, writeTile, tileById, TILES, K } from "./_lib.js";

// POST {tile, items}: adds one region's restaurants from an imported file (never removes any).
// POST {finish:true}: marks regions the file had nothing for as loaded.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["POST"] })) return;
  const b = body(req);
  try {
    if (b.finish) {
      const [raws] = await redis(["MGET", ...TILES.map(T => K.tile(T.id))]);
      const missing = TILES.filter((T, i) => !raws[i]);
      if (missing.length) await redis(...missing.map(T => ["SET", K.tile(T.id), JSON.stringify({ bb: T.bb, syncedAt: Date.now(), items: [] })]), ["INCR", K.tver], ["INCR", K.ver]);
      return res.status(200).json({ ok: true });
    }
    const T = tileById(b.tile);
    if (!T || !Array.isArray(b.items) || b.items.length > 5000) return res.status(400).json({ error: "Bad import", code: "bad" });
    const prev = await readTile(T.id);
    const merged = new Map((prev?.items || []).map(i => [i.i, i]));
    const now = Date.now();
    let added = 0;
    for (const it of b.items.map(cleanItem).filter(Boolean)) {
      const old = merged.get(it.i);
      if (old) it.f = old.f || 0;
      else { it.f = prev ? now : 0; if (prev) added++; }
      merged.set(it.i, it);
    }
    await writeTile(T, [...merged.values()]);
    res.status(200).json({ ok: true, added });
  } catch {
    res.status(502).json({ error: "Couldn't save that region. Import again to retry.", code: "storage" });
  }
}
