import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPlan, buildCompare } from "./menu.mjs";
import { recordPrices } from "./history.mjs";

const { MISTRAL_API_KEY: MK, OPENAI_API_KEY: OK } = process.env;
const AI = OK
  ? { name: "OpenAI", url: "https://api.openai.com/v1/chat/completions", key: OK, model: process.env.OPENAI_MODEL || "gpt-4o-mini", delay: 300 }
  : { name: "Mistral", url: "https://api.mistral.ai/v1/chat/completions", key: MK, model: process.env.MISTRAL_MODEL || "mistral-small-latest", delay: 1100 };

const REDO = !!process.env.REDO_PHOTOS;
const PHOTOS_ONLY = !!process.env.PHOTOS_ONLY;
let photoGenFailed = false;
let photoAuthFailed = false;

if (!AI.key && !PHOTOS_ONLY) throw new Error("Falta OPENAI_API_KEY ou MISTRAL_API_KEY");

const MODEL = AI.model;
const imgPart = (u) => ({ type: "image_url", image_url: AI.name === "OpenAI" ? { url: u } : u });
const FILE = "api/data/menu.json";
const IMG = "public/meals";

fs.mkdirSync(IMG, { recursive: true });
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const library = JSON.parse(fs.readFileSync(new URL("./recipes.json", import.meta.url), "utf8"));
const REREAD = !!process.env.REREAD;
data.images ??= {};
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });

const slug = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const imgName = (m, r, buf) => "lib-" + r.id + "-" + createHash("sha1").update(buf).digest("hex").slice(0, 8) + ".webp";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const UA = { "user-agent": "Mozilla/5.0 (compatible; MenuDoDiaBot/1.0)" };

async function ask(content) {
  const body = JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content }] });
  let r;
  for (let t = 0; t < 3; t++) {
    await sleep(+process.env.AI_DELAY_MS || +process.env.MISTRAL_DELAY_MS || AI.delay);
    r = await fetch(AI.url, { method: "POST", headers: { authorization: "Bearer " + AI.key, "content-type": "application/json" }, body });
    if (r.ok || ![429, 500, 502, 503].includes(r.status)) break;
    const wait = +r.headers?.get?.("retry-after") || 5 * (t + 1);
    await sleep(Math.min(wait, 60) * 1000);
  }
  if (!r.ok) throw new Error(AI.name + " " + r.status + ": " + (await r.text()).slice(0, 300));
  const text = (await r.json()).choices?.[0]?.message?.content ?? "";
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Resposta sem JSON");
  return JSON.parse(text.slice(a, b + 1));
}

const BLOG = "https://blog200porcento.com";
const SOURCES = {
  "Continente": { tag: "continente", key: "continente" },
  "Pingo Doce": { tag: "pingo+doce", key: "pingo-doce" },
  "Lidl": { tag: "lidl", key: "lidl" },
  "Aldi": { tag: "aldi", key: "aldi" },
  "Intermarché": { tag: "intermarch%C3%A9", key: "intermarche" }
};
const MONTHS = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

async function getPage(url) {
  let r, err;
  for (let t = 0; t < 3; t++) {
    await sleep(1000 * (t + 1));
    try { r = await fetch(url, { headers: UA }); err = null; if (r.ok || r.status < 500) break; } catch (e) { err = e; }
  }
  if (err) throw err;
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r;
}

function slugDates(slugText) {
  const M = MONTHS.join("|");
  const iso = (y, m, d) => y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const y = +today.slice(0, 4);
  let m = slugText.match(new RegExp("(\\d{1,2})-(" + M + ")-a-(\\d{1,2})-(" + M + ")"));
  if (m) { const m1 = MONTHS.indexOf(m[2]), m2 = MONTHS.indexOf(m[4]); return { from: iso(y, m1, m[1]), to: iso(m2 < m1 ? y + 1 : y, m2, m[3]) }; }
  m = slugText.match(new RegExp("(\\d{1,2})-a-(\\d{1,2})-(" + M + ")"));
  if (m) { const k = MONTHS.indexOf(m[3]); return { from: iso(y, k, m[1]), to: iso(y, k, m[2]) }; }
  return null;
}

const NOT_FOOD = /madeira|acores|bazar|tecnologia|mobilia|jardim|halloween|decoracao|natal|casa|plantas|ferramentas|figuras|colecion|brinquedo|moda|textil|escritorio|livarno|parkside|eletro|electro|bricolage|viagens|animais|bebe/;
const rank = (s) => /frescos/.test(s) ? 0 : /super/.test(s) ? 1 : /contact|mini|aniversario|hiper|folheto-[a-z-]+-promocoes/.test(s) ? 2 : 3;

async function findFlyer(m) {
  const src = SOURCES[m.name];
  if (!src) return null;
  const html = await (await getPage(BLOG + "/tag/" + src.tag)).text();
  const links = [...new Set([...html.matchAll(/href="((?:https:\/\/blog200porcento\.com)?\/antevisao-folheto-[^"#]+)"/g)].map((x) => x[1].startsWith("/") ? BLOG + x[1] : x[1]))];
  const cands = links.map((url) => ({ url, s: url.split("/").pop() }))
    .filter(({ s }) => s.startsWith("antevisao-folheto-" + src.key + "-") && !NOT_FOOD.test(s))
    .map((c) => ({ ...c, ...slugDates(c.s) })).filter((c) => c.from && c.to);
  const inForce = cands.filter((c) => c.from <= today && c.to >= today);
  const future = m.to < today ? cands.filter((c) => c.from > today) : [];
  const all = (inForce.length ? inForce : future).sort((a, b) => rank(a.s) - rank(b.s) || (a.from < b.from ? 1 : -1));
  // Folhetos de fim de semana/complementares (dentro da validade do folheto atual) acrescentam produtos
  const isSupp = (c) => m.to >= today && c.from > m.from && c.to <= m.to;
  const known = new Set((m.sources || []).map((x) => x.url));
  const supp = all.filter((c) => isSupp(c) && !known.has(c.url)).slice(0, 2);
  const pool = all.filter((c) => !isSupp(c));
  console.log("  candidatos " + m.name + ":", all.map((c) => c.s).join(" | ") || "nenhum");
  m.__dbg = "candidatos: " + (all.map((c) => c.s).join(" | ") || "nenhum (de " + links.length + " links, " + cands.length + " alimentares)");
  if (!pool.length && supp.length) {
    const merged = new Map(m.promos.map((p) => [p.id, p])), sources = [...(m.sources || [])];
    for (const c of supp) {
      try { const got = await readFlyer(m, c); got.promos.forEach((p) => merged.set(p.id, p)); sources.push(got.source); console.log("  " + m.name + ": complemento " + c.s + " (+" + got.promos.length + ")"); }
      catch (e) { console.warn("  " + c.s + " ignorado:", e.message.slice(0, 120)); }
    }
    return sources.length > (m.sources || []).length ? { supplement: true, promos: [...merged.values()], sources } : null;
  }
  const force = REREAD || m.readVersion !== 2;
  if (!pool.length || pool[0].from < m.from || (pool[0].from === m.from && !force)) return null;
  const pickFrom = pool[0].from;
  let promos = [], sources = [], pick = null, lastErr = null;
  for (const c of pool.filter((c) => c.from === pickFrom).slice(0, 3)) {
    try {
      const got = await readFlyer(m, c);
      pick = pick || c;
      sources.push(got.source);
      const ids = new Set(promos.map((p) => p.id));
      promos.push(...got.promos.filter((p) => !ids.has(p.id)));
      if (promos.length >= 25) break;
    } catch (e) { lastErr = e; console.warn("  " + c.s + " ignorado:", e.message.slice(0, 120)); }
  }
  if (!pick) throw new Error((m.__dbg ?? "") + " | " + (lastErr?.message ?? "nenhum folheto legível"));
  const dm = (d) => d.slice(8) + "/" + d.slice(5, 7);
  return { found: true, from: pick.from, to: pick.to, flyer: "Folheto " + dm(pick.from) + "–" + dm(pick.to), sources, promos };
}

async function readFlyer(m, pick) {
  const page = await (await getPage(pick.url)).text();
  const title = (page.match(/<title>([^<]+)<\/title>/)?.[1] ?? pick.s).replace(/\s+[-–]\s+Blog 200.*$/, "").trim();
  const og = page.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ?? page.match(/content="([^"]+)"\s+property="og:image"/)?.[1];
  const pages = [...new Set([...page.matchAll(/https:\/\/blog200porcento\.com\/storage\/b200\/[^"')\s]+?-p(\d+)\.jpe?g/g)].map((x) => x[0]))];
  const num = (u) => +u.match(/-p(\d+)\.jpe?g/)?.[1];
  const base = og && /-p\d+\.jpe?g/.test(og) ? og : pages[0];
  if (!base) throw new Error("sem imagens do folheto");
  const seq = [...pages].sort((a, b) => num(a) - num(b));
  const imgs = [...new Set([base, ...seq])].slice(0, 14);
  const parts = [];
  for (const u of imgs) {
    const r = await getPage(u);
    parts.push(imgPart("data:image/jpeg;base64," + Buffer.from(await r.arrayBuffer()).toString("base64")));
  }

  // Blocos de 2 páginas: extrair e confirmar cada bloco com as suas próprias imagens (JSON curto, nunca truncado)
  const seen = new Set();
  const promos = [];
  for (let i = 0; i < parts.length; i += 2) {
    const block = parts.slice(i, i + 2);
    const items = [];
    try {
      const ex = await ask([{ type: "text", text: "Estas imagens são páginas do folheto do " + m.name + ". Extrai TODOS os produtos alimentares visíveis com preço legível (carne, peixe, marisco, legumes, fruta, queijo, massa, arroz, leguminosas, ovos). Ignora flores, plantas, decoração e bazar. per='kg' ou 'un'. JSON: {\"products\":[{\"name\":\"\",\"price\":0.0,\"per\":\"kg|un\",\"label\":\"\"}]}" }, ...block]);
      for (const p of ex.products ?? []) {
        const it = { id: slug(p.name ?? ""), name: String(p.name ?? "").trim(), price: Math.round(parseFloat(String(p.price).replace(",", ".")) * 100) / 100, per: p.per, ...(p.label ? { label: p.label } : {}) };
        if (it.id && !NONFOOD.test(it.id) && !seen.has(it.id) && it.price >= 0.2 && it.price <= (it.per === "kg" ? 45 : 40) && ["kg", "un"].includes(it.per)) { seen.add(it.id); items.push(it); }
      }
    } catch (e) {
      console.warn("  extracção das páginas " + (i + 1) + "-" + (i + 2) + " falhou:", e.message.slice(0, 100));
      continue;
    }
    if (!items.length) continue;
    let keep = items;
    try {
      const ver = await ask([{ type: "text", text: "Confere nestas páginas do folheto do " + m.name + " os produtos e preços desta lista: " + items.map((p) => p.id + ": " + p.name + " " + p.price + " €/" + p.per).join("; ") + ". Indica só os que estão ERRADOS: em 'remove' os que não existem no folheto, em 'fix' os que existem com outro preço (com o preço certo). Se estiver tudo certo, devolve listas vazias. JSON: {\"remove\":[\"id\"],\"fix\":[{\"id\":\"\",\"price\":0.0}]}" }, ...block]);
      const rm = new Set(ver.remove ?? []);
      const fx = new Map((ver.fix ?? []).map((f) => [f.id, Math.round(parseFloat(String(f.price).replace(",", ".")) * 100) / 100]));
      keep = items.filter((p) => !rm.has(p.id)).map((p) => (fx.has(p.id) && fx.get(p.id) >= 0.2 ? { ...p, price: fx.get(p.id) } : p));
    } catch (e) { console.warn("  confirmação falhou (" + e.message.slice(0, 60) + "), a usar leitura sem confirmar"); }
    promos.push(...keep.map((p) => ({ ...p, note: "folheto (lido por IA)" })));
  }
  if (promos.length < 2) throw new Error("só " + promos.length + " produtos legíveis (mínimo 2)");
  console.log("  " + m.name + ": " + promos.length + " produtos lidos de " + imgs.length + " páginas");
  return { promos, source: { title: "Blog 200 — " + title, url: pick.url } };
}

const NONFOOD = /crisantemo|peperomia|ramo-de|flor|planta|vaso|capsula|detergente|papel|vela|decorac/;

const CF = process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID ? { token: process.env.CLOUDFLARE_API_TOKEN, id: process.env.CLOUDFLARE_ACCOUNT_ID } : null;

async function generateCloudflare(m, r) {
  const prompt = "Professional food photography, overhead shot, natural daylight, rustic wooden table. " + (r.imgDesc || r.original || r.name) + ". Realistic, appetizing, no text, no people.";
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF.id + "/ai/run/" + model, {
    method: "POST", headers: { authorization: "Bearer " + CF.token, "content-type": "application/json" },
    body: JSON.stringify({ prompt, steps: 8 }), signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new Error("Cloudflare " + res.status + ": " + (await res.text()).slice(0, 200));
  const b64 = (await res.json()).result?.image;
  if (!b64) throw new Error("sem imagem");
  const buf = Buffer.from(b64, "base64"), name = imgName(m, r, buf);
  const sharp = (await import("sharp")).default;
  await sharp(buf).resize(900, 900, { fit: "cover" }).webp({ quality: 78 }).toFile(path.join(IMG, name));
  console.log("  imagem gerada (Cloudflare):", r.name);
  return { image: "/meals/" + name, credit: { name: "Imagem gerada por IA", url: "" } };
}

async function generateImage(m, r) {
  const prompt = "Professional food photography, overhead shot, natural daylight, rustic wooden table. " + (r.imgDesc || r.original || r.name) + ". Realistic, appetizing, no text, no people.";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: { authorization: "Bearer " + OK, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini", prompt, size: "1024x1024", quality: process.env.OPENAI_IMAGE_QUALITY || "low", n: 1 }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new Error("OpenAI imagens " + res.status + ": " + (await res.text()).slice(0, 200));
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error("sem imagem");
  const buf = Buffer.from(b64, "base64"), name = imgName(m, r, buf);
  const sharp = (await import("sharp")).default;
  await sharp(buf).resize(900, 900, { fit: "cover" }).webp({ quality: 78 }).toFile(path.join(IMG, name));
  console.log("  imagem gerada (OpenAI):", r.name);
  return { image: "/meals/" + name, credit: { name: "Imagem gerada por IA", url: "" } };
}

async function makeImage(m, r) {
  let genErr = null;
  const gens = [CF && generateCloudflare, OK && generateImage].filter(Boolean);
  for (const g of gens) {
    try { return await g(m, r); } catch (e) { genErr = e; console.warn("  geração falhou para " + r.name + ":", e.message.slice(0, 160)); }
  }
  if (!gens.length) { photoAuthFailed = true; console.warn("  sem OPENAI_API_KEY nem CLOUDFLARE_* configurado para gerar imagem"); }
  if (genErr) photoGenFailed = true;
  console.warn("  sem foto para " + r.name);
  return undefined;
}

let tried = 0, failed = 0;
for (let i = 0; i < data.markets.length && !PHOTOS_ONLY; i++) {
  const n = structuredClone(data.markets[i]);
  tried++;
  try {
    const f = await findFlyer(n);
    if (!f && n.__dbg) console.log("  " + n.__dbg);
    if (f && f.supplement) {
      Object.assign(n, { sources: f.sources, promos: f.promos, readVersion: 2, check: { date: today, result: "sem-novo" } });
      console.log(n.name, "-> folheto complementar adicionado; produtos:", n.promos.length);
    } else if (f) {
      const isNew = f.from !== n.from;
      const keepOld = !isNew && f.promos.length <= n.promos.length;
      Object.assign(n, { from: f.from, to: f.to, flyer: f.flyer, sources: f.sources, promos: keepOld ? n.promos : f.promos, readVersion: 2, check: { date: today, result: isNew ? "novo" : "sem-novo" } });
      console.log(n.name, isNew ? "-> folheto novo" : "-> folheto relido" + (keepOld ? " (sem mais produtos)" : ""), f.from, f.to);
    } else if (n.to >= today) {
      n.check = { date: today, result: "sem-novo" };
      console.log(n.name, "-> sem folheto novo");
      if (n.promos.length < 15 && n.__dbg) n.check.note = "poucos produtos (" + n.promos.length + "); " + n.__dbg;
    } else {
      n.check = { date: today, result: "sem-folheto" };
    }
    delete n.__dbg;
    data.markets[i] = n;
  } catch (e) {
    failed++;
    console.warn(n.name, "-> mantido sem alterações:", e.message);
    const prev = data.markets[i];
    delete prev.__dbg;
    prev.check = { date: today, result: prev.to >= today ? "sem-novo" : "sem-folheto", note: String(e.message).slice(0, 300) };
  }
}

// Histórico de preços (api/data/precos/AAAA.json): nunca se apaga
if (!PHOTOS_ONLY) {
  try { const h = recordPrices(data.markets, today); console.log("Histórico de preços:", h.added, "novos,", h.changed, "corrigidos"); }
  catch (e) { console.warn("Histórico de preços não gravado:", e.message); process.exitCode = 1; }
}

// Plano semanal (2 refeições por dia) e comparador do mesmo prato entre lojas
for (const m of data.markets) {
  const hist = (m.hist ?? []).filter((h) => h.date !== today);
  m.plan = buildPlan(m, data.markets, library, today, hist);
  m.recipes = m.plan[0]?.recipes ?? [];
  m.hist = [...hist, ...(m.recipes.length ? [{ date: today, ids: m.recipes.map((r) => r.id) }] : [])].slice(-14);
  delete m.history;
  console.log(m.name, "-> plano de", m.plan.length, "dia(s):", m.recipes.map((r) => r.name).join(" | ") || "sem receitas (folheto expirado)");
}
data.compare = buildCompare(data.markets, library, today);

// Imagens: uma por receita da biblioteca (reutilizada por todas as lojas e dias)
if (REDO) data.images = {};
const byId = new Map();
const todo = [...data.markets.flatMap((m) => m.recipes), ...data.compare.map((c) => c.recipe), ...data.markets.flatMap((m) => m.plan.slice(1).flatMap((d) => d.recipes))];
for (const r of todo) if (!byId.has(r.id)) byId.set(r.id, r);
let made = 0;
const MAX_NEW = REDO ? 999 : +process.env.MAX_IMAGES || 14;
for (const r of byId.values()) {
  const cur = data.images[r.id];
  if (cur && fs.existsSync(path.join("public", cur))) continue;
  if (made >= MAX_NEW) break;
  const img = await makeImage({ name: "" }, r);
  if (img) { data.images[r.id] = img.image; made++; }
  else if (photoAuthFailed) break;
}
const attach = (r) => { if (data.images[r.id]) { r.image = data.images[r.id]; r.imageCredit = { name: "Imagem gerada por IA", url: "" }; } else { delete r.image; delete r.imageCredit; } };
for (const m of data.markets) { m.recipes.forEach(attach); m.plan.forEach((d) => d.recipes.forEach(attach)); }
data.compare.forEach((c) => attach(c.recipe));

const keep = new Set(Object.values(data.images).map((p) => path.basename(p)));
for (const f of fs.readdirSync(IMG)) if ((f.startsWith("foto-") || f.startsWith("lib-")) && !keep.has(f)) fs.unlinkSync(path.join(IMG, f));
if (!(tried > 0 && failed === tried)) data.updatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");

if (tried > 0 && failed === tried) { console.error("ERRO: falhou em todos os supermercados."); process.exitCode = 1; }
else if (failed) { console.error("AVISO: " + failed + " supermercado(s) com erro; os restantes foram atualizados."); process.exitCode = 1; }
if (photoGenFailed) { console.error("ERRO: geração de imagens falhou."); process.exitCode = 1; }
if (photoAuthFailed) { console.error("ERRO: configuração de geração de imagens em falta."); process.exitCode = 1; }
// FIM DO SCRIPT
