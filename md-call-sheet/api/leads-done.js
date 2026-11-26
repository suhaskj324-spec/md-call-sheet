import { guard, redis, body } from "./_lib.js";
import leads from "../data/leads.js";

// POST {id, by} marks a business lead as called. DELETE ?id= puts it back.
// Check-offs live in the "cs:leads:done" hash only — restaurant data is untouched.
const LEAD_ID = /^lead-\d{3}$/;

export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["POST", "DELETE"] })) return;
  try {
    if (req.method === "POST") {
      const b = body(req);
      const id = typeof b.id === "string" ? b.id : "";
      if (!LEAD_ID.test(id) || !leads.some(l => l.id === id)) {
        return res.status(400).json({ error: "Unknown lead", code: "bad" });
      }
      const rec = { id, by: typeof b.by === "string" ? b.by.slice(0, 40) : "", doneAt: Date.now() };
      await redis(["HSET", "cs:leads:done", id, JSON.stringify(rec)], ["INCR", "cs:ver"]);
      return res.status(200).json({ ok: true });
    }
    const id = String(req.query?.id || "");
    if (!LEAD_ID.test(id)) return res.status(400).json({ error: "Unknown lead", code: "bad" });
    await redis(["HDEL", "cs:leads:done", id], ["INCR", "cs:ver"]);
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Couldn't save that. Try again.", code: "storage" });
  }
}
