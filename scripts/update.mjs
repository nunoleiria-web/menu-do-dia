import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });

const slug = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const imgName = (m, r, buf) => "foto-" + slug(m.name) + "-" + slug(r.name) + "-" + createHash("sha1").update(buf).digest("hex").slice(0, 8) + ".webp";
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
  await sleep(1000);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r;
}

function slugDates(slugText) {
  const M = MONTHS.join("|");
  const iso = (y, m, d) => y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const y = +today.slice(0, 4);
  let m = slugText.match(new RegExp("de-(\\d{1,2})-(" + M + ")-a-(\\d{1,2})-(" + M + ")"));
  if (m) { const m1 = MONTHS.indexOf(m[2]), m2 = MONTHS.indexOf(m[4]); return { from: iso(y, m1, m[1]), to: iso(m2 < m1 ? y + 1 : y, m2, m[3]) }; }
  m = slugText.match(new RegExp("de-(\\d{1,2})-a-(\\d{1,2})-(" + M + ")"));
  if (m) { const k = MONTHS.indexOf(m[3]); return { from: iso(y, k, m[1]), to: iso(y, k, m[2]) }; }
  return null;
}

async function findFlyer(m) {
  const src = SOURCES[m.name];
  if (!src) return null;
  const html = await (await getPage(BLOG + "/tag/" + src.tag)).text();
  const links = [...new Set([...html.matchAll(/href="((?:https:\/\/blog200porcento\.com)?\/antevisao-folheto-[^"#]+)"/g)].map((x) => x[1].startsWith("/") ? BLOG + x[1] : x[1]))];
  const cands = links.map((url) => ({ url, s: url.split("/").pop() }))
    .filter(({ s }) => s.startsWith("antevisao-folheto-" + src.key + "-frescos-") && !/fim-de-semana|madeira|acores|bazar/.test(s))
    .map((c) => ({ ...c, ...slugDates(c.s) })).filter((c) => c.from && c.to).sort((a, b) => (a.from < b.from ? 1 : -1));
  const pick = cands.find((c) => c.from <= today && c.to >= today) ?? (m.to < today ? [...cands].reverse().find((c) => c.from > today) : undefined);
  if (!pick || pick.from <= m.from) return null;

  const page = await (await getPage(pick.url)).text();
  const title = (page.match(/<title>([^<]+)<\/title>/)?.[1] ?? pick.s).replace(/\s+[-–]\s+Blog 200.*$/, "").trim();
  const og = page.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ?? page.match(/content="([^"]+)"\s+property="og:image"/)?.[1];
  const pages = [...new Set([...page.matchAll(/https:\/\/blog200porcento\.com\/storage\/b200\/[^"')\s]+?-p(\d+)\.jpe?g/g)].map((x) => x[0]))];
  const num = (u) => +u.match(/-p(\d+)\.jpe?g/)?.[1];
  const base = og && /-p\d+\.jpe?g/.test(og) ? og : pages[0];
  if (!base) throw new Error("sem imagens do folheto");
  const seq = [...pages].sort((a, b) => num(a) - num(b));
  const imgs = [...new Set([base, ...seq])].slice(0, 8);
  const parts = [];
  for (const u of imgs) {
    const r = await getPage(u);
    parts.push(imgPart("data:image/jpeg;base64," + Buffer.from(await r.arrayBuffer()).toString("base64")));
  }

  // Extrair produtos em blocos de 2 páginas (resposta curta = JSON nunca truncado)
  const seen = new Set();
  const items = [];
  for (let i = 0; i < parts.length; i += 2) {
    let ex;
    try {
      ex = await ask([{ type: "text", text: "Estas imagens são páginas do folheto do " + m.name + ". Extrai TODOS os produtos alimentares visíveis com preço legível. per='kg' ou 'un'. JSON: {\"products\":[{\"name\":\"\",\"price\":0.0,\"per\":\"kg|un\",\"label\":\"\"}]}" }, ...parts.slice(i, i + 2)]);
    } catch (e) {
      console.warn("  extracção da página " + (i / 2 + 1) + " falhou:", e.message.slice(0, 100));
      continue;
    }
    for (const p of ex.products ?? []) {
      const it = { id: slug(p.name ?? ""), name: String(p.name ?? "").trim(), price: Math.round(parseFloat(String(p.price).replace(",", ".")) * 100) / 100, per: p.per, ...(p.label ? { label: p.label } : {}) };
      if (it.id && !seen.has(it.id) && seen.add(it.id) && it.price >= 0.2 && it.price <= (it.per === "kg" ? 45 : 40) && ["kg", "un"].includes(it.per)) items.push(it);
    }
  }
  if (items.length < 6) throw new Error("só " + items.length + " produtos legíveis (mínimo 6)");

  // Confirmar preços em blocos de 25; se a confirmação falhar ou rejeitar tudo, usar a extracção sem confirmar
  let promos;
  try {
    const ok = new Set();
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      const ver = await ask([{ type: "text", text: "Confirma nas imagens do folheto do " + m.name + " se o preço está exato. Lista: " + chunk.map((p) => p.id + ": " + p.name + " " + p.price + " €/" + p.per).join("; ") + ". JSON: {\"confirmed\":[\"id\"]}" }, ...parts]);
      for (const id of ver.confirmed ?? []) ok.add(id);
    }
    promos = items.filter((p) => ok.has(p.id)).map((p) => ({ ...p, note: "folheto (lido por IA)" }));
    if (promos.length < 6) throw new Error("só " + promos.length + " preços confirmados (mínimo 6)");
  } catch (e) {
    console.warn("  confirmação de preços falhou (" + e.message.slice(0, 80) + ") — a usar extracção sem confirmação");
    promos = items.map((p) => ({ ...p, note: "folheto (lido por IA)" }));
  }
  const dm = (d) => d.slice(8) + "/" + d.slice(5, 7);
  return { found: true, from: pick.from, to: pick.to, flyer: "Folheto " + dm(pick.from) + "–" + dm(pick.to), sources: [{ title: "Blog 200 — " + title, url: pick.url }], promos };
}

const DISHES = "Bacalhau à Brás, Bacalhau à Gomes de Sá, Bacalhau com Natas, Arroz de Pato, Polvo à Lagareiro, Arroz de Polvo, Caldo Verde, Sopa do Pedreiro, Feijoada, Cozido à Portuguesa, Carne de Porco à Alentejana, Bifanas, Sardinha Assada, Carapau Frito, Espetada, Frango de Caril, Frango Assado com Batatas, Arroz de Marisco, Massada de Peixe, Açorda de Marisco, Salada de Polvo, Choco Frito, Lulas à Algarvia, Trinchado, Rojões, Migas, Almôndegas, Estufado de Novilho, Jardineira, Peito de Frango Grelhado, Costeleta de Novilho Grelhada, Sopa de Peixe";

async function makeRecipes(m) {
  const list = m.promos.map((p) => p.id + ": " + p.name + " " + p.price + "€/" + p.per).join("; ");
  const j = await ask("Cria 2 receitas para " + m.name + ". REGRAS: 1) Cada receita deve ser um prato REAL e tradicional português (ex.: " + DISHES + "). O campo name deve ser o nome tradicional do prato — NÃO inventes nomes novos. 2) Ingredientes principais: usa APENAS produtos desta lista, com o id exato no campo promo: " + list + ". 3) Podes usar até 3 ingredientes de despensa básica com promo:null (ex.: azeite, sal, alho, cebola, ovos, arroz, massa). 4) Não repitas: " + (m.history.join(", ") || "nenhuma") + ". JSON: {\"recipes\":[{\"name\":\"\",\"description\":\"\",\"servings\":\"4 pessoas\",\"time\":\"45 min\",\"imageQuery\":\"english food keywords\",\"ingredients\":[{\"item\":\"\",\"qty\":\"\",\"promo\":\"id ou null\",\"amount\":1}],\"steps\":[\"\"]}]}");
  if (!(j.recipes?.length >= 2)) throw new Error("menos de 2 receitas");
  const byId = Object.fromEntries(m.promos.map((p) => [p.id, p]));
  return j.recipes.slice(0, 2).map((r, i) => {
    const ingredients = (r.ingredients ?? []).map((x) => {
      const pid = typeof x.promo === "string" && x.promo.trim() && x.promo.trim().toLowerCase() !== "null" && x.promo.trim().toLowerCase() !== "nenhum" ? x.promo.trim() : null;
      if (!pid) return { item: x.item, qty: x.qty };
      const p = byId[pid] || byId[slug(pid)];
      if (!p) throw new Error("promo inválida: " + pid);
      const amount = Math.min(5, Math.max(0.1, parseFloat(String(x.amount ?? 1).replace(",", ".")) || 1));
      return { item: x.item || p.name, qty: x.qty, price: p.price, per: p.per, amount, ...(p.label && { label: p.label }), note: p.note ?? "folheto" };
    });
    if (ingredients.filter((x) => x.price).length < 2 || !(r.steps?.length >= 3)) throw new Error("receita fraca");
    return { slot: i + 1, name: r.name, description: r.description, servings: r.servings, time: r.time, ingredients, steps: r.steps, imageQuery: String(r.imageQuery ?? r.name) };
  });
}

const CF = process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID ? { token: process.env.CLOUDFLARE_API_TOKEN, id: process.env.CLOUDFLARE_ACCOUNT_ID } : null;

async function generateCloudflare(m, r) {
  const prompt = "Professional food photography, overhead 45-degree view, natural light, ceramic plate on wooden table. Portuguese dish: " + r.name + ". Ingredients: " + r.ingredients.map((i) => i.item).join(", ") + ". No text, no people, no hands.";
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF.id + "/ai/run/" + model, {
    method: "POST", headers: { authorization: "Bearer " + CF.token, "content-type": "application/json" },
    body: JSON.stringify({ prompt, steps: 6 }), signal: AbortSignal.timeout(120000)
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
  const prompt = "Professional food photography, 45-degree overhead view, natural light, ceramic plate on wooden table. Portuguese dish: " + r.name + ". Keywords: " + (r.imageQuery || "") + ". Ingredients: " + r.ingredients.map((i) => i.item).join(", ") + ". No text, no people, no hands.";
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
    if (f) {
      Object.assign(n, { from: f.from, to: f.to, flyer: f.flyer, sources: f.sources, promos: f.promos, check: { date: today, result: "novo" } });
      console.log(n.name, "-> folheto novo", f.from, f.to);
    } else if (n.to >= today) {
      n.check = { date: today, result: "sem-novo" };
      console.log(n.name, "-> sem folheto novo; receitas novas com promoções em vigor");
    } else {
      n.check = { date: today, result: "sem-folheto" };
      data.markets[i] = n;
      continue;
    }
    const recipes = await makeRecipes(n);
    n.recipes = recipes;
    n.history = [...n.history, ...recipes.map((r) => r.name)].slice(-12);
    data.markets[i] = n;
  } catch (e) { failed++; console.warn(n.name, "-> mantido sem alterações:", e.message); }
}

for (const m of data.markets) for (const r of m.recipes) {
  if (r.image && !REDO) continue;
  const img = await makeImage(m, r);
  if (img) { r.image = img.image; r.imageCredit = img.credit; }
  else if (REDO && !photoAuthFailed) { delete r.image; delete r.imageCredit; }
}

const used = new Set(data.markets.flatMap((m) => m.recipes.map((r) => r.image && path.basename(r.image))));
for (const f of fs.readdirSync(IMG)) if (f.startsWith("foto-") && !used.has(f)) fs.unlinkSync(path.join(IMG, f));
if (!(tried > 0 && failed === tried)) data.updatedAt = today;
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");

if (tried > 0 && failed === tried) { console.error("ERRO: IA falhou em todos os supermercados."); process.exitCode = 1; }
if (photoGenFailed) { console.error("ERRO: geração de imagens falhou."); process.exitCode = 1; }
if (photoAuthFailed) { console.error("ERRO: configuração de geração de imagens em falta."); process.exitCode = 1; }
// FIM DO SCRIPT
