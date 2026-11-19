import { guard, redis, body, cleanItem, K } from "./_lib.js";

// POST {item, by} marks a restaurant as called. DELETE ?id= puts it back.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["POST", "DELETE"] })) return;
  try {
    if (req.method === "POST") {
      const b = body(req), it = cleanItem(b.item);
      if (!it) return res.status(400).json({ error: "Missing restaurant", code: "bad" });
      const rec = { ...it, by: typeof b.by === "string" ? b.by.slice(0, 40) : "", doneAt: Date.now() };
      await redis(["HSET", K.done, it.i, JSON.stringify(rec)], ["INCR", K.ver]);
      return res.status(200).json({ ok: true });
    }
    const id = String(req.query?.id || "");
    if (!/^[nwr]\d{1,20}$/.test(id)) return res.status(400).json({ error: "Missing restaurant", code: "bad" });
    await redis(["HDEL", K.done, id], ["INCR", K.ver]);
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Couldn't save that. Try again.", code: "storage" });
  }
}
