// Local test server: serves public/ and runs api/*.js like Vercel does.
// Usage: CS_MEMORY=1 TEAM_PASSWORD=test node scripts/dev-server.js
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
process.env.CS_INSECURE_COOKIE = "1";

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
    let raw = ""; for await (const c of req) raw += c;
    req.query = Object.fromEntries(url.searchParams);
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    try {
      const mod = await import(pathToFileURL(path.join(root, "api", name + ".js")).href);
      await mod.default(req, res);
    } catch (e) { console.error(e); res.statusCode = 404; res.end("{}"); }
    return;
  }
  const file = path.join(root, "public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
  if (!file.startsWith(path.join(root, "public"))) { res.statusCode = 403; return res.end(); }
  try { res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end("not found"); }
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
