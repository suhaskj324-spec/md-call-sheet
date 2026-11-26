import { guard, redis } from "./_lib.js";
import leads from "../data/leads.js";

// GET — the static business-lead list plus check-offs from Redis.
// No seeding, no writes to any restaurant key. Check-offs live in
// the "cs:leads:done" hash only.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["GET"] })) return;
  try {
    const [doneFlat] = await redis(["HGETALL", "cs:leads:done"]);
    const done = [];
    for (let i = 1; i < (doneFlat || []).length; i += 2) { try { done.push(JSON.parse(doneFlat[i])); } catch {} }
    res.status(200).json({ leads, done });
  } catch {
    res.status(502).json({ error: "Couldn't reach storage. Try again in a moment.", code: "storage" });
  }
}
