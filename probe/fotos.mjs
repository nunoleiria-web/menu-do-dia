// Teste de fotos (temporário): o mesmo prato com vários modelos e pedidos. Grava em probe/fotos/.
import fs from "node:fs";
import sharp from "sharp";
const OUT = process.env.OUT_DIR || "probe/fotos";
fs.mkdirSync(OUT, { recursive: true });
const lib = JSON.parse(fs.readFileSync(process.env.LIB || "scripts/recipes.json", "utf8"));
const DISHES = ["polvo-lagareiro", "bacalhau-bras", "frango-churrasco"].map((id) => lib.find((r) => r.id === id));
const REAL = (d) => `A real, candid smartphone photo of homemade ${d}, just served at home in Portugal. Simple everyday ceramic plate on a kitchen table with a cotton napkin, a fork and a glass of water nearby. Soft natural window light from the side, photographed at a 45-degree angle, shallow depth of field. Honest home-cooked look: real textures, slightly uneven portions, a few drips of sauce and olive oil, no food styling. Photorealistic photograph, no text, no people, not an illustration, not a 3D render.`;
const OLD = (d) => `Professional food photography, overhead shot, natural daylight, rustic wooden table. ${d}. Realistic, appetizing, no text, no people.`;
const { OPENAI_API_KEY: OK, CLOUDFLARE_API_TOKEN: CT, CLOUDFLARE_ACCOUNT_ID: CA } = process.env;
let rep = "# Teste de fotos\n";
async function cf(model, prompt, extra = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CA}/ai/run/${model}`, { method: "POST", headers: { authorization: "Bearer " + CT, "content-type": "application/json" }, body: JSON.stringify({ prompt, ...extra }), signal: AbortSignal.timeout(180000) });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
  if (ct.includes("image/")) return Buffer.from(await r.arrayBuffer());
  const j = await r.json(); const b = j.result?.image; if (!b) throw new Error("sem imagem: " + JSON.stringify(j).slice(0, 200)); return Buffer.from(b, "base64");
}
async function oa(model, quality, prompt) {
  const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { authorization: "Bearer " + OK, "content-type": "application/json" }, body: JSON.stringify({ model, prompt, size: "1024x1024", quality, n: 1 }), signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
  const b = (await r.json()).data?.[0]?.b64_json; if (!b) throw new Error("sem imagem"); return Buffer.from(b, "base64");
}
let IMG_MODELS = [];
if (OK) { try { const j = await (await fetch("https://api.openai.com/v1/models", { headers: { authorization: "Bearer " + OK } })).json(); IMG_MODELS = (j.data || []).map((m) => m.id).filter((id) => /image|dall/i.test(id)).sort(); rep += "\nModelos de imagem disponíveis: " + IMG_MODELS.join(", ") + "\n"; } catch (e) { rep += "\nNão foi possível listar modelos: " + e.message; } }
const best = IMG_MODELS.filter((id) => /^gpt-image/.test(id) && !/mini/.test(id)).sort().reverse()[0];
const VARIANTS = [
  ["A-mini-low-pedido-antigo", (d) => oa("gpt-image-1-mini", "low", OLD(d)), OK],
  ["B-mini-low-realista", (d) => oa("gpt-image-1-mini", "low", REAL(d)), OK],
  ["C-mini-medium-realista", (d) => oa("gpt-image-1-mini", "medium", REAL(d)), OK],
  ...(best ? [["D-" + best + "-medium-realista", (d) => oa(best, "medium", REAL(d)), OK]] : []),
];
for (const r of DISHES) {
  for (const [name, fn, key] of VARIANTS) {
    if (!key) { rep += `\n- ${r.id} ${name}: sem chave`; continue; }
    const t0 = Date.now();
    try { const buf = await fn(r.img); await sharp(buf).resize(600, 600, { fit: "cover" }).jpeg({ quality: 82 }).toFile(`${OUT}/${r.id}__${name}.jpg`); rep += `\n- ${r.id} ${name}: ok (${Math.round((Date.now() - t0) / 1000)} s)`; }
    catch (e) { rep += `\n- ${r.id} ${name}: ERRO ${e.message}`; }
  }
}
fs.writeFileSync(`${OUT}/REPORT.md`, rep); console.log(rep);
