import { guard, body, tileById, syncRegion } from "./_lib.js";

// POST {tile}: refreshes one region from OpenStreetMap. The page calls this region by region.
export default async function handler(req, res) {
  if (!guard(req, res, { methods: ["POST"] })) return;
  const T = tileById(body(req).tile);
  if (!T) return res.status(400).json({ error: "Unknown region", code: "bad" });
  try {
    res.status(200).json({ ok: true, ...(await syncRegion(T)) });
  } catch (e) {
    res.status(502).json({ error: "The map server is busy. Try again later.", code: "busy" });
  }
}
