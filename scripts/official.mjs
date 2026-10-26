// Leitura dos folhetos nos sites OFICIAIS dos supermercados (só páginas que o robots.txt de cada site permite).
//   Continente  → folheto oficial em folhetos.continente.pt (iPaper): produtos e preços já em texto
//   Pingo Doce  → folheto oficial em folhetos.pingodoce.pt (iPaper): produtos e preços já em texto
//   Aldi        → página "Oportunidades da semana" em aldi.pt: produtos, preços, €/kg e datas em texto
//   Lidl        → folheto oficial (leaflets.schwarz): imagens das páginas, lidas pela IA como antes
//   Intermarché → bloqueia leituras automáticas: continua no Blog 200 (update.mjs)
// Cada leitor devolve { found, from, to, flyer, sources, promos, officialId } ou lança um erro;
// em caso de erro, update.mjs volta ao Blog 200.

const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const pad = (n) => String(n).padStart(2, "0");
const dm = (d) => d.slice(8) + "/" + d.slice(5, 7);

// "De 20 a 26 de Outubro", "De 20 de Outubro até 26 de Outubro", "De 28 de Outubro a 3 de Novembro"
export function parseRange(text, today) {
  const t = String(text).toLowerCase().normalize("NFC");
  const m = t.match(/de\s+(\d{1,2})(?:\s+de\s+([a-zç]+))?\s+(?:a|até)\s+(\d{1,2})\s+de\s+([a-zç]+)/);
  if (!m) return null;
  const m2 = MONTHS[m[4]], m1 = m[2] ? MONTHS[m[2]] : m2;
  if (!m1 || !m2) return null;
  let y = +today.slice(0, 4);
  const tm = +today.slice(5, 7);
  if (m1 === 12 && tm === 1) y--; // folheto de dezembro lido em janeiro
  if (m1 === 1 && tm === 12) y++; // folheto de janeiro lido em dezembro
  const from = `${y}-${pad(m1)}-${pad(+m[1])}`, to = `${m2 < m1 ? y + 1 : y}-${pad(m2)}-${pad(+m[3])}`;
  return { from, to };
}

// Peso no nome ("450G", "1,2KG", "4X100G") → kg; "EMB. KG" ou "(1,5 a 3 kg)" → preço já é ao kg
export function weightOf(name) {
  const s = String(name).toUpperCase().replace(/,/g, ".");
  if (/\d\s*A\s*\d+(\.\d+)?\s*KG/.test(s) || /(EMB\.?|AO|POR|\/)\s*KG\b/.test(s) || /\bKG\s*$/.test(s)) return { perKg: true };
  const multi = s.match(/(\d+)\s*X\s*(\d+(?:\.\d+)?)\s*(KG|G)\b/);
  if (multi) return { kg: +multi[1] * +multi[2] / (multi[3] === "KG" ? 1 : 1000) };
  const one = s.match(/(\d+(?:\.\d+)?)\s*(KG|G)\b/);
  if (one) return { kg: +one[1] / (one[2] === "KG" ? 1 : 1000) };
  return null;
}

// Converte um produto do folheto no formato do Menu do Dia: o preço fica ao kg sempre que se sabe o peso
function toPromo(ctx, name, price, per, extraLabel) {
  const id = ctx.slug(name);
  if (!id || ctx.NONFOOD.test(id) || !(price > 0.19)) return null;
  const round = (n) => Math.round(n * 100) / 100;
  const nice = name.replace(/\s+/g, " ").trim();
  if (per === "kg") return { id, name: nice, price: round(price), per: "kg", ...(extraLabel ? { label: extraLabel } : {}), note: "folheto oficial" };
  const w = weightOf(nice);
  if (w?.perKg) return { id, name: nice, price: round(price), per: "kg", note: "folheto oficial" };
  if (w?.kg && w.kg >= 0.05 && w.kg <= 10) {
    const g = w.kg >= 1 ? String(w.kg).replace(".", ",") + " kg" : Math.round(w.kg * 1000) + " g";
    return { id, name: nice, price: round(price / w.kg), per: "kg", label: `${price.toFixed(2).replace(".", ",")} € a embalagem de ${g}`, note: "folheto oficial" };
  }
  return { id, name: nice, price: round(price), per: "un", ...(extraLabel ? { label: extraLabel } : {}), note: "folheto oficial" };
}

const dedupe = (promos) => { const by = new Map(); for (const p of promos) if (p && (!by.has(p.id) || p.price < by.get(p.id).price)) by.set(p.id, p); return [...by.values()]; };
const text = async (ctx, url) => (await ctx.getPage(url)).text();
const ENT = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", aacute: "á", agrave: "à", acirc: "â", atilde: "ã", eacute: "é", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú", ccedil: "ç", Aacute: "Á", Eacute: "É", Oacute: "Ó", Uacute: "Ú", Ccedil: "Ç", Atilde: "Ã", Otilde: "Õ", ordf: "ª", ordm: "º" };
const decode = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
const strip = (h) => decode(h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/^[^<]*>/, " ")).replace(/\s+/g, " ");

// ---------- iPaper (Continente e Pingo Doce) ----------
async function ipaperProducts(ctx, flyerUrl) {
  const page = await text(ctx, flyerUrl);
  const urls = [...new Set([...page.matchAll(/https:\/\/cdn\.ipaper\.io\/iPaper\/Papers\/[^"'\s]+?\/Enrichments\/[^"'\s]+?Page\d+-\d+\.json\?token=[^"'\s\\]+(?:\\u0026[^"'\s\\]+)*/g)].map((x) => x[0].replace(/\\u0026/g, "&")))];
  if (!urls.length) throw new Error("folheto sem lista de produtos: " + flyerUrl);
  const items = [];
  for (const u of urls) {
    const j = JSON.parse(await text(ctx, u));
    for (const e of j.enrichments ?? []) if (e.type === 13 && e.name && e.price > 0) items.push({ name: String(e.name), price: +e.price, pid: e.productId });
  }
  return items;
}

// Pede à IA (só texto, barato) para dizer se o preço de cada produto é ao kg ou por unidade/embalagem.
// Usado no Continente, cujos nomes não trazem o peso. Se falhar, usa uma regra simples.
const KG_HINT = /fresc|novilho|bovino|vitela|porco|frango|peru|borrego|cabrito|entrecosto|costeleta|bifana|febra|lombo|pernil|cachaço|rojões|fraldinha|vazia|acém|chambão|dourada|robalo|pescada|carapau|sardinha|cavala|salmão|bacalhau.*seco|polvo|lula|choco|batata|cebola|cenoura|tomate|laranja|maçã|pera|banana|uva|kiwi|abacaxi|ananás|melão|meloa|clementina|tangerina|limão|cogumelo|courgette|curgete|pimento|abóbora|alho/i;
const UN_HINT = /congelad|ultracongelad|pack|emb\.|lata|frasco|garrafa|pacote|cozid|panad|hambúrguer|hamburguer|salsicha|nuggets|almôndega|porç(ão|ões)|fatiad[oa].*\d|queijo|iogurte|leite|natas|manteiga|pão|bolo|bolacha|cereais|massa|arroz|azeite|óleo|vinho|cerveja|sumo|água|café|chá|chocolate/i;
async function classifyUnits(ctx, items) {
  const out = new Map();
  const rule = (n) => (/\d\s*a\s*\d+([.,]\d+)?\s*kg/i.test(n) ? "kg" : UN_HINT.test(n) ? "un" : KG_HINT.test(n) ? "kg" : "un");
  const todo = items.filter((it) => !weightOf(it.name));
  for (let i = 0; i < todo.length; i += 120) {
    const chunk = todo.slice(i, i + 120);
    try {
      if (!ctx.ask) throw new Error("sem IA");
      const r = await ctx.ask([{ type: "text", text: "Produtos de um folheto de supermercado português, com o preço anunciado. Para cada um, diz se esse preço é ao quilo (\"kg\": carne, peixe e fruta/legumes a granel, bacalhau seco, polvo congelado vendido ao kg) ou por unidade/embalagem (\"un\"). Responde só JSON: {\"u\":{\"<n>\":\"kg|un\"}} usando o número de cada linha.\n" + chunk.map((it, k) => `${k}: ${it.name} — ${it.price} €`).join("\n") }]);
      chunk.forEach((it, k) => out.set(it.name, ["kg", "un"].includes(r.u?.[k] ?? r.u?.[String(k)]) ? (r.u[k] ?? r.u[String(k)]) : rule(it.name)));
    } catch { chunk.forEach((it) => out.set(it.name, rule(it.name))); }
  }
  return out;
}

// Encontra os folhetos listados numa página de folhetos: [{ url, title, from, to }]
// O título e as datas estão perto da ligação: antes dela no Continente ("before"), depois no Pingo Doce ("after").
function listFlyers(html, host, today, side) {
  const out = [], seen = new Set(), re = new RegExp(`href=["']?(https://${host.replace(/\./g, "\\.")}/[^"'\\s>]+)`, "g");
  const SEP = /Ver Produtos|Ver folheto/i;
  // Cada folheto tem duas ligações (imagem e "Ver Produtos"): conta a primeira (depois) ou a última (antes)
  const at = new Map();
  for (const m of html.matchAll(re)) { const url = m[1].replace(/\/?$/, "/"); if (side === "before" || !at.has(url)) at.set(url, m.index); }
  for (const [url, index] of at) {
    const m = { index };
    if (seen.has(url)) continue;
    const chunks = side === "before"
      ? strip(html.slice(Math.max(0, m.index - 2500), m.index)).split(SEP).filter((c) => parseRange(c, today))
      : [strip(html.slice(m.index, m.index + 1500)).split(SEP)[0]].filter((c) => parseRange(c, today));
    const pick = side === "before" ? chunks[chunks.length - 1] : chunks[0];
    if (!pick) continue;
    seen.add(url);
    out.push({ url, title: pick.replace(/\s*De\s+\d[\s\S]*$/i, "").replace(/.*>/, "").replace(/Últimos dias/i, "").trim().slice(-80), ...parseRange(pick, today) });
  }
  return out;
}
const inForce = (f, today) => f.from <= today && f.to >= today;
const choose = (list, today) => list.filter((f) => inForce(f, today)).sort((a, b) => (a.from < b.from ? 1 : -1))[0] || list.filter((f) => f.from > today).sort((a, b) => (a.from < b.from ? -1 : 1))[0];

async function readContinente(ctx) {
  const { today } = ctx;
  const list = listFlyers(await text(ctx, "https://www.continente.pt/folhetos/"), "folhetos.continente.pt", today, "before");
  const regional = /madeira|açores|acores|bom dia|-mad-|-cbd-|acores-/i;
  const main = choose(list.filter((f) => (/semanal/i.test(f.title) || /\/semanal-\d+/.test(f.url)) && !regional.test(f.title + f.url)), today);
  if (!main) throw new Error("folheto semanal não encontrado (" + list.length + " folhetos na página)");
  const weekend = list.filter((f) => /fim de semana|fim-de-semana/i.test(f.title + f.url) && !regional.test(f.title + f.url) && inForce(f, today));
  const flyers = [main, ...weekend];
  const items = [];
  for (const f of flyers) items.push(...(await ipaperProducts(ctx, f.url)));
  const units = await classifyUnits(ctx, items);
  const promos = dedupe(items.map((it) => toPromo(ctx, it.name, it.price, units.get(it.name) ?? "un")));
  return { found: true, from: main.from, to: main.to, flyer: "Folheto " + dm(main.from) + "–" + dm(main.to), officialId: main.url,
    sources: flyers.map((f) => ({ title: "Continente — " + (f.title || "Folheto"), url: f.url })), promos };
}

async function readPingoDoce(ctx) {
  const { today } = ctx;
  const list = listFlyers(await text(ctx, "https://www.pingodoce.pt/folhetos/"), "folhetos.pingodoce.pt", today, "after");
  const weekly = list.filter((f) => /poupe-esta-semana\/continental/.test(f.url)).sort((a, b) => (/lojas-grandes/.test(b.url) ? 1 : 0) - (/lojas-grandes/.test(a.url) ? 1 : 0));
  const main = choose(weekly, today);
  if (!main) throw new Error("folheto Poupe Esta Semana não encontrado (" + list.length + " folhetos na página)");
  const weekend = list.filter((f) => /poupe-este-fim-de-semana\/continental/.test(f.url) && inForce(f, today));
  const flyers = [main, ...weekend];
  const items = [];
  for (const f of flyers) items.push(...(await ipaperProducts(ctx, f.url)));
  // Os nomes do Pingo Doce trazem o peso ("450G", "EMB. KG"); sem peso, o preço é por unidade
  const promos = dedupe(items.map((it) => toPromo(ctx, it.name.charAt(0) + it.name.slice(1).toLowerCase(), it.price, "un")));
  return { found: true, from: main.from, to: main.to, flyer: "Folheto " + dm(main.from) + "–" + dm(main.to), officialId: main.url,
    sources: flyers.map((f) => ({ title: "Pingo Doce — " + (f.title || "Folheto"), url: f.url })), promos };
}

async function readAldi(ctx) {
  const { today } = ctx;
  const html = await text(ctx, "https://www.aldi.pt/oportunidades-da-semana.html");
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) throw new Error("página sem dados de produtos");
  const found = [];
  const walk = (o) => {
    if (typeof o === "string") { if (o.includes("currentPrice") && /^[\[{]/.test(o.trim())) { try { walk(JSON.parse(o)); } catch {} } }
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") { if (o.currentPrice && o.name) found.push(o); Object.values(o).forEach(walk); }
  };
  walk(JSON.parse(nd[1]));
  const FOOD = /\/dam\/products\/(02_bakery|03_breakfast|04_|05_|06_fresh-meat-fish|07_|08_fruits-vegetables|09_pantry|10_|11_snacking|12_)/;
  const rows = [];
  for (const p of found) {
    if (!FOOD.test(JSON.stringify(p.assets ?? ""))) continue;
    const promo = (p.promotionPrices ?? []).find((x) => x.validUntilLocalDate >= today) ?? null;
    const pr = promo ?? p.currentPrice; if (!promo) continue; // só o que está em promoção
    const base = (pr.basePrice ?? [])[0];
    const pack = String(p.salesUnit ?? "").split(" - ")[0];
    const label = `${(+pr.priceValue).toFixed(2).replace(".", ",")} € ${pack ? "(" + pack + ")" : ""}`.trim();
    const item = base?.basePriceScale === "kg" ? toPromo(ctx, p.name, +base.basePriceValue, "kg", label) : toPromo(ctx, p.name, +pr.priceValue, "un", pack || undefined);
    if (item) rows.push({ item, from: promo.validFromLocalDate, to: promo.validUntilLocalDate });
  }
  const current = rows.filter((r) => r.from <= today && r.to >= today);
  const use = current.length >= 5 ? current : rows; // à terça/quarta pode só haver as da semana seguinte
  if (!use.length) throw new Error("sem produtos alimentares em promoção");
  const mode = (arr) => Object.entries(arr.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0][0];
  const from = use.map((r) => r.from).sort()[0], to = mode(use.map((r) => r.to));
  return { found: true, from, to, flyer: "Promoções " + dm(from) + "–" + dm(to), officialId: "aldi|" + from + "|" + to,
    sources: [{ title: "Aldi — Oportunidades da semana", url: "https://www.aldi.pt/oportunidades-da-semana.html" }], promos: dedupe(use.map((r) => r.item)) };
}

async function readLidl(ctx, m) {
  const { today } = ctx;
  const page = await text(ctx, "https://www.lidl.pt/c/folhetos/s10020672");
  const ids = [...new Set([...page.matchAll(/\/l\/pt\/folhetos\/(promocoes-(?:semanais|fim-de-semana)-a-partir-de-\d{2}-\d{2})\//g)].map((x) => x[1]))];
  if (!ids.length) throw new Error("folhetos de promoções não encontrados");
  const flyers = [];
  for (const id of ids) {
    const j = JSON.parse(await text(ctx, `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${id}&region_id=0&region_code=0`)).flyer;
    if (j) flyers.push({ id, j, from: (j.offerStartDate || j.startDate).slice(0, 10), to: (j.offerEndDate || j.endDate).slice(0, 10), weekly: /semanais/.test(id) });
  }
  const main = choose(flyers.filter((f) => f.weekly), today);
  if (!main) throw new Error("folheto semanal não encontrado");
  const weekend = flyers.filter((f) => !f.weekly && inForce(f, today));
  const officialId = [main, ...weekend].map((f) => f.id).join("+");
  // As páginas lêem-se com IA: só se o folheto mudou (ou se pedirem para reler)
  if (officialId === m.officialId && !ctx.reread && m.promos?.length) return { found: true, unchanged: true, from: main.from, to: main.to, flyer: m.flyer, sources: m.sources, promos: m.promos, officialId };
  const FOOD_PAGE = /aliment|carne|peixe|fruta|legume|frango|porco|novilho|bovino|salmão|bacalhau|queijo|iogurte|padaria|talho|peixaria|charcutaria|congelad|mercearia|massa|arroz/i;
  const pages = [main, ...weekend].flatMap((f) => f.j.pages.filter((p) => p.image && FOOD_PAGE.test((p.altText || "") + " " + (p.keyWords || "").slice(0, 400))).map((p) => p.image));
  if (!pages.length) throw new Error("sem páginas de alimentação no folheto");
  const promos = (await ctx.extractFromImages(m, pages.slice(0, 16))).map((p) => ({ ...p, note: "folheto oficial (lido por IA)" }));
  return { found: true, from: main.from, to: main.to, flyer: "Folheto " + dm(main.from) + "–" + dm(main.to), officialId,
    sources: [main, ...weekend].map((f) => ({ title: "Lidl — " + f.j.name + " " + (f.j.title || ""), url: `https://www.lidl.pt/l/pt/folhetos/${f.id}/ar/0` })), promos: dedupe(promos) };
}

const READERS = { "Continente": readContinente, "Pingo Doce": readPingoDoce, "Aldi": readAldi, "Lidl": readLidl };
export const hasOfficial = (name) => !!READERS[name];
export async function readOfficial(m, ctx) {
  const r = await READERS[m.name](ctx, m);
  if (!r.unchanged && r.promos.length < 5) throw new Error("só " + r.promos.length + " produtos no folheto oficial");
  return r;
}
