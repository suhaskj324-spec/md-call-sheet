import { setSession } from "./_lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Not allowed" });
  setSession(res, false);
  res.status(200).json({ ok: true });
}
