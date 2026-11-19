import { guard, redis, body, K } from "./_lib.js";

// POST {paused} turns automatic syncing off or on for everyone.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["POST"] })) return;
  try {
    await redis(["SET", K.prefs, JSON.stringify({ paused: !!body(req).paused })], ["INCR", K.ver]);
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Couldn't save that. Try again.", code: "storage" });
  }
}
