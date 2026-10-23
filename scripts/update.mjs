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

const NOT_FOOD = /fim-de-semana|madeira|acores|bazar|tecnologia|mobilia|jardim|halloween|decoracao|natal|casa|plantas|ferramentas|figuras|colecion|brinquedo|moda|textil|escritorio|livarno|parkside|eletro|electro|bricolage|viagens|animais|bebe/;
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
  const pool = (inForce.length ? inForce : future).sort((a, b) => rank(a.s) - rank(b.s) || (a.from < b.from ? 1 : -1));
  console.log("  candidatos " + m.name + ":", pool.map((c) => c.s).join(" | ") || "nenhum");
  m.__dbg = "candidatos: " + (pool.map((c) => c.s).join(" | ") || "nenhum (de " + links.length + " links, " + cands.length + " alimentares)");
  if (!pool.length || pool[0].from <= m.from) return null;
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
  return { promos, source: { title: "Blog 200 — " + title, url: pick.url } };
}

const DISHES = "Bacalhau à Brás; Bacalhau à Gomes de Sá; Bacalhau com Natas; Arroz de Pato; Polvo à Lagareiro; Caldo Verde; Sopa do Pedreiro; Feijoada; Cozido à Portuguesa; Carne de Porco à Alentejana; Bifanas; Sardinha Assada; Carapau Frito com Batatas; Espetada; Frango de Caril; Frango Assado com Batatas; Arroz de Marisco; Massada de Peixe; Açorda de Marisco; Salada de Polvo; Choco Frito; Lulas à Algarvia; Trinchado; Rojões; Migas; Almôndegas; Estufado de Novilho; Jardineira; Peito de Frango Grelhado; Costeletas de Novilho Grelhadas; Caldeirada; Febras Grelhadas com Arroz; Sopa de Peixe; Grão Estufado com Couve";

const STAR = /bacalhau|polvo|lula|choco|sepia|camarao|gamba|mexilh|ameijoa|amêijoa|salmao|dourada|robalo|pescada|carapau|sardinha|cavala|atum|peixe|filete|tamboril|raia|lingueirao|frango|peru|pato|coelho|porco|suino|vitela|novilho|vaca|boi|borrego|cordeiro|cabrito|entrecosto|costeleta|febra|lombo|bife|perna|pernil|alcatra|acem|carne|salsicha|chourico|linguica|farinheira|morcela|presunto|bacon|toucinho|grao|feijao|lentilha|queijo|cogumelo|arroz|massa/i;
const STAPLE = /cebola|alho|batata|cenoura|tomate|alface|pepino|couve|abobora|pimento|salsa|coentro|limao|laranja|maca|banana|pera|uva|sal\b|azeite|oleo|vinagre|farinha|acucar|leite|natas|manteiga|ovo|agua|sumo|refrigerante|cerveja|vinho|bolacha|chocolate|cafe|iogurte|pao\b|snack|gelado|detergente|papel/i;
const words = (t) => slug(t).split("-").filter((w) => w.length >= 4);
const near = (a, b) => a.slice(0, 5) === b.slice(0, 5);

async function makeRecipes(m) {
  const sl = (p) => slug(p.name);
  let stars = m.promos.filter((p) => STAR.test(sl(p)) && !(STAPLE.test(sl(p)) && !STAR.test(sl(p))));
  if (stars.length < 2) stars = m.promos.filter((p) => !STAPLE.test(sl(p)));
  if (stars.length < 2) stars = m.promos;
  const fmt = (p) => p.id + ": " + p.name + " " + p.price + "€/" + p.per;
  const hist = (m.history || []).join(", ") || "nenhuma";
  const byId = Object.fromEntries(m.promos.map((p) => [p.id, p]));
  let feedback = "", lastReject = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = await ask(
      `És um chef português com estrela, autor de livros de cozinha tradicional. Cria 2 receitas para clientes do ${m.name}.\n\n` +
      `PRODUTOS-ESTRELA DISPONÍVEIS NO FOLHETO (único sítio onde pode haver preço):\n${stars.map(fmt).join("; ")}\n\n` +
      `REGRAS:\n` +
      `1) Cada receita nasce de 1 (no máximo 2) produto(s) da lista acima, que são a razão de ser do prato e têm de aparecer no nome (ex.: "Bacalhau com Natas" -> bacalhau). Só esses ingredientes levam "promo" (id exato) e "amount" para 4 pessoas (kg se per=kg; unidades se per=un).\n` +
      `2) O prato é uma receita REAL e reconhecível da cozinha portuguesa (ou internacional clássica), com nome tradicional — sugestões: ${DISHES}. Nada de misturas inventadas.\n` +
      `3) TODOS os restantes ingredientes (batata, cebola, alho, azeite, ervas, molhos, acompanhamentos, temperos) levam "promo": null e ficam SEM preço. Entre 7 e 12 ingredientes no total, com doses realistas para 4 pessoas (ex.: "800 g", "2 dentes").\n` +
      `4) 6 a 9 passos em português europeu, com técnica, tempos e temperaturas concretos (ex.: "Forno a 200 ºC durante 25 min"). Inclui a ordem correta e pontos de cozedura. Termina com uma "dica" do chef.\n` +
      `5) "time" realista (ex.: "45 min"), "difficulty" = Fácil | Média | Difícil.\n` +
      `6) slot 1 e slot 2 usam estrelas diferentes. Não repitas: ${hist}.\n` +
      (feedback ? `CORRIGE: ${feedback}\n` : "") +
      `\nJSON: {"recipes":[{"name":"","slot":1,"description":"1-2 frases apetitosas","servings":"4 pessoas","time":"","difficulty":"","tip":"","imageQuery":"english food keywords","ingredients":[{"item":"","qty":"","promo":"id ou null","amount":1}],"steps":[""]}]}`
    );
    try {
      const out = [];
      for (const r of (j?.recipes ?? []).slice(0, 2)) {
        const ings = [];
        for (const x of r.ingredients ?? []) {
          const pid = typeof x.promo === "string" && x.promo.trim() && !["null", "nenhum", "none", "n/a"].includes(x.promo.trim().toLowerCase()) ? x.promo.trim() : null;
          const item = String(x.item ?? "").trim();
          if (!item) continue;
          if (!pid) { ings.push({ item, qty: String(x.qty ?? "") }); continue; }
          const p = byId[pid] || byId[slug(pid)];
          if (!p) throw new Error("promo inválida: " + pid);
          const amount = Math.min(5, Math.max(0.1, parseFloat(String(x.amount ?? 1).replace(",", ".")) || 1));
          ings.push({ item: item || p.name, qty: String(x.qty ?? ""), price: p.price, per: p.per, amount, ...(p.label ? { label: p.label } : {}), note: p.note ?? "folheto", _p: p });
        }
        const priced = ings.filter((x) => x.price);
        const name = String(r.name ?? "").trim();
        if (!name) throw new Error("receita sem nome");
        if (priced.length < 1 || priced.length > 2) throw new Error(`"${name}" deve ter 1 ou 2 ingredientes com preço (tem ${priced.length})`);
        const bad = priced.find((x) => STAPLE.test(slug(x._p.name)) && !STAR.test(slug(x._p.name)));
        if (bad) throw new Error(`"${bad.item}" é um ingrediente de apoio: deve ficar sem preço (promo null)`);
        const nw = words(name);
        if (!priced.some((x) => words(x._p.name + " " + x.item).some((w) => nw.some((v) => near(v, w)))))
          throw new Error(`o produto com preço de "${name}" tem de ser o ingrediente principal e aparecer no nome do prato`);
        if (ings.length < 6) throw new Error(`"${name}" tem poucos ingredientes`);
        if ((r.steps ?? []).length < 5) throw new Error(`"${name}" tem poucos passos`);
        const steps = r.steps.map((t) => String(t).trim()).filter(Boolean);
        const tip = String(r.tip ?? "").trim();
        if (tip) steps.push("Dica do chef: " + tip.replace(/^dica( do chef)?:\s*/i, ""));
        out.push({ name, description: String(r.description ?? "").trim(), servings: String(r.servings ?? "4 pessoas"), time: String(r.time ?? ""), ...(r.difficulty ? { difficulty: String(r.difficulty) } : {}), imageQuery: String(r.imageQuery ?? ""), ingredients: ings.map(({ _p, ...x }) => x), steps, slot: out.length + 1 });
      }
      if (out.length !== 2) throw new Error("foram pedidas 2 receitas");
      if (out[0].name === out[1].name) throw new Error("receitas repetidas");
      return out;
    } catch (e) {
      feedback = e.message; lastReject = e.message;
      console.warn("  receitas rejeitadas (tentativa " + (attempt + 1) + "): " + e.message);
    }
  }
  throw new Error("receitas rejeitadas 3x: " + lastReject);
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
    if (!f && n.__dbg) console.log("  " + n.__dbg);
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
    delete n.__dbg;
    const recipes = await makeRecipes(n);
    if (!recipes) throw new Error("não foi possível criar receitas válidas");
    n.recipes = recipes;
    n.history = [...n.history, ...recipes.map((r) => r.name)].slice(-12);
    data.markets[i] = n;
  } catch (e) {
    failed++;
    console.warn(n.name, "-> mantido sem alterações:", e.message);
    const prev = data.markets[i];
    delete prev.__dbg;
    prev.check = { date: today, result: prev.to >= today ? "sem-novo" : "sem-folheto", note: String(e.message).slice(0, 300) };
  }
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
