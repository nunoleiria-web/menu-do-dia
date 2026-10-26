// Teste ao vivo dos leitores oficiais (sem IA): grava um resumo em probe/live/
import fs from "node:fs";
import { readOfficial } from "../scripts/official.mjs";
fs.mkdirSync("probe/live", { recursive: true });
const UA = { "user-agent": "Mozilla/5.0 (compatible; MenuDoDiaBot/1.0)" };
const getPage = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error(url + " -> " + r.status); return r; };
const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const src = fs.readFileSync("scripts/update.mjs", "utf8"); const NONFOOD = new RegExp(src.match(/const NONFOOD = \/(.+)\/;/)[1]);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
const out = {};
for (const name of ["Continente", "Pingo Doce", "Aldi", "Lidl"]) {
  const t0 = Date.now();
  try {
    const r = await readOfficial({ name, promos: [] }, { today, getPage, slug, NONFOOD, ask: null, extractFromImages: async (m, imgs) => { out[name + "_imgs"] = imgs.length; return Array(6).fill(0).map((_, i) => ({ id: "teste-" + i, name: "Teste " + i, price: 1, per: "un" })); } });
    out[name] = { ok: true, from: r.from, to: r.to, flyer: r.flyer, n: r.promos.length, kg: r.promos.filter((p) => p.per === "kg").length, sources: r.sources, secs: Math.round((Date.now() - t0) / 1000), sample: r.promos.filter((p) => /salm|frango|porco|bacalhau|camar|lula|novilho|bovino|batata|peru|pescada|dourada/i.test(p.name)).slice(0, 25) };
  } catch (e) { out[name] = { ok: false, error: e.message }; }
  console.log(name, JSON.stringify(out[name]).slice(0, 300));
}
fs.writeFileSync("probe/live/result.json", JSON.stringify(out, null, 1));
