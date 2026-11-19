import { redis, samePassword, setSession, storageReady, body } from "./_lib.js";

// POST {password} -> sets the session cookie. Slows down repeated wrong guesses.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Not allowed" });
  if (!process.env.TEAM_PASSWORD) return res.status(500).json({ error: "The team password isn't set up yet. Add TEAM_PASSWORD in the Vercel project's settings.", code: "setup" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const key = "cs:login:" + ip;
  if (storageReady()) {
    const [tries] = await redis(["INCR", key], ["EXPIRE", key, "900"]);
    if (tries > 15) return res.status(429).json({ error: "Too many tries. Wait 15 minutes and try again.", code: "slow" });
  }
  if (!samePassword(body(req).password)) return res.status(401).json({ error: "That password isn't right.", code: "wrong" });
  if (storageReady()) await redis(["DEL", key]);
  setSession(res, true);
  res.status(200).json({ ok: true });
}
