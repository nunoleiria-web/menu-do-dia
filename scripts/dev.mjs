// Abre o site localmente tal como fica no GitHub Pages (index.html + public/ + api/data/menu.json).
// Uso: npm run dev  →  http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PORT = +process.env.PORT || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

// Mesmo mapeamento que o workflow pages.yml
const resolve = (p) => {
  if (p === "/" || p === "/index.html") return path.join(ROOT, "index.html");
  if (p.startsWith("/api/data/")) return path.join(ROOT, p);
  return path.join(ROOT, "public", p);
};

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = resolve(p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Menu do Dia em http://localhost:${PORT}`));
