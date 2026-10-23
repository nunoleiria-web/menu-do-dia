// Lógica pura do menu (sem rede nem IA): escolhe receitas da biblioteca a partir das promoções,
// calcula custos pela quantidade real, monta o plano da semana e compara o mesmo prato entre lojas.
import { createHash } from "node:crypto";
import fs from "node:fs";

export const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rnd = (s) => createHash("sha1").update(s).digest().readUInt32BE(0) / 2 ** 32;

// ---- Estimativa dos restantes ingredientes, a partir de preços médios (scripts/prices.json) ----
const PRICES = JSON.parse(fs.readFileSync(new URL("./prices.json", import.meta.url), "utf8")).map(([re, v]) => ({ re: new RegExp(re), ...v }));
const num = (t) => { const f = String(t).match(/^(\d+)\/(\d+)$/); return f ? +f[1] / +f[2] : parseFloat(String(t).replace(",", ".")); };

// Converte "800 g", "2 c. sopa", "3 dentes", "1/2 copo"… numa quantidade: { kg } | { l } | { n (unidades) } | { flat }
export function parseQty(q) {
  const t = String(q ?? "").toLowerCase();
  if (!t.trim() || /a gosto|q\.?b|pitada/.test(t)) return { flat: 0.05 };
  const m = t.match(/(\d+(?:[.,]\d+)?(?:\/\d+)?|\d+\/\d+)\s*(kg|g|ml|l\b|c\. ?sopa|c\. ?chá|c\. ?cha|copo|chávena|chavena|dentes?|molhos?|ramos?|folhas?|fatias?|prato|latas?)?(?![a-zà-ú])/);
  if (!m) return /algumas/.test(t) ? { herb: 0.3 } : { flat: 0.3 };
  const v = num(m[1]), u = m[2] ?? "";
  if (u === "kg") return { kg: v };
  if (u === "g") return { kg: v / 1000 };
  if (u === "l") return { l: v };
  if (u === "ml") return { l: v / 1000 };
  if (/c\. ?sopa/.test(u)) return { tbsp: v };
  if (/c\. ?ch/.test(u)) return { tsp: v };
  if (u === "copo") return { l: v * 0.2 };
  if (/ch[aá]vena/.test(u)) return { l: v * 0.25 };
  if (/^dente/.test(u)) return { n: v, unit: "dente" };
  if (/^molho/.test(u)) return { herb: v };
  if (/^ramo/.test(u)) return { herb: v * 0.2 };
  if (/^folha/.test(u)) return { herb: v * 0.1, leaves: v };
  if (/^fatia/.test(u)) return { n: v };
  if (u === "prato") return { n: v };
  return { n: v };
}

export function priceItem(item, qty) {
  const sl = slug(item), pr = PRICES.find((p) => p.re.test(sl)), q = parseQty(qty);
  if (q.flat != null) return { cost: pr?.herb || pr?.kg >= 20 ? 0.1 : q.flat, known: !!pr };
  if (!pr) return { cost: 0.4, known: false };
  if (pr.herb) return { cost: pr.herb * (q.herb ?? (q.tbsp ? 0.3 : q.n ? Math.min(q.n, 1) : 0.3)), known: true };
  let cost;
  if (q.kg != null) cost = pr.kg ? q.kg * pr.kg : pr.l ? q.kg * pr.l : pr.un ? (q.kg / (pr.w || 0.15)) * pr.un : 0.4;
  else if (q.l != null) cost = pr.l ? q.l * pr.l : pr.kg ? q.l * pr.kg : 0.4;
  else if (q.tbsp != null) cost = (pr.l ?? pr.kg ?? 3) * 0.015 * q.tbsp;
  else if (q.tsp != null) cost = (pr.l ?? pr.kg ?? 3) * 0.005 * q.tsp;
  else if (q.leaves != null && pr.un) cost = pr.un * (q.leaves / 10);
  else if (q.n != null) cost = pr.un ? q.n * pr.un : pr.kg ? q.n * (q.unit === "dente" ? 0.004 : pr.w ?? (pr.kg >= 15 ? 0.003 : 0.15)) * pr.kg : pr.l ? q.n * 0.1 * pr.l : 0.4;
  else cost = 0.4;
  return { cost, known: true };
}

// Custo estimado (para 4 pessoas) dos ingredientes sem preço de folheto, arredondado a 0,05 €
export function estimateRest(ing) {
  const total = ing.reduce((s, [item, qty]) => s + priceItem(item, qty).cost, 0);
  return Math.max(0.5, Math.round(total * 20) / 20);
}

const round2 = (n) => Math.round(n * 100) / 100;

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Melhor promoção (a mais barata por unidade de medida) que serve o ingrediente principal.
export function matchMain(main, promos) {
  const re = new RegExp(main.re), not = main.not ? new RegExp(main.not) : null;
  const ok = promos.filter((p) => { const s = slug(p.name); return re.test(s) && !(not && not.test(s)); });
  if (!ok.length) return null;
  return ok.sort((a, b) => a.price - b.price)[0];
}

const mainAmount = (main, promo) => (promo.per === "kg" ? main.kg : main.u ?? 1);

export function matchRecipe(lib, promos) {
  const picks = [];
  for (const m of lib.main) {
    const p = matchMain(m, promos);
    if (!p) return null;
    picks.push({ main: m, promo: p });
  }
  return picks;
}

export function costOf(picks) {
  return round2(picks.reduce((s, x) => s + x.promo.price * mainAmount(x.main, x.promo), 0));
}

export function buildRecipe(lib, market, picks, meal, compare) {
  const priced = picks.map(({ main, promo }) => ({
    item: main.item,
    qty: main.qty,
    price: promo.price,
    per: promo.per,
    amount: mainAmount(main, promo),
    ...(promo.label ? { label: promo.label } : {}),
    note: "folheto: " + promo.name,
    promoId: promo.id
  }));
  const rest = lib.ing.map(([item, qty]) => ({ item, qty }));
  const steps = [...lib.steps];
  if (lib.tip) steps.push("Dica do chef: " + lib.tip);
  const mainCost = costOf(picks);
  return {
    id: lib.id,
    slot: meal === "Almoço" ? 1 : 2,
    meal,
    name: lib.name,
    original: lib.orig,
    cuisine: lib.c,
    description: lib.desc,
    servings: "4 pessoas",
    time: lib.t,
    difficulty: lib.d,
    veg: !!lib.veg,
    allergens: lib.al ?? [],
    est: lib.ing?.length ? estimateRest(lib.ing) : lib.est,
    imgDesc: lib.img,
    mainCost,
    ingredients: [...priced, ...rest],
    steps,
    imageQuery: lib.orig + " " + lib.c,
    ...(compare ? { compare } : {})
  };
}

export function compareRows(lib, markets, today) {
  const rows = [];
  for (const mk of markets) {
    const picks = matchRecipe(lib, mk.promos ?? []);
    if (!picks || (today && mk.to < today)) continue;
    rows.push({ market: mk.name, product: picks[0].promo.name, price: picks[0].promo.price, per: picks[0].promo.per, total: costOf(picks) });
  }
  return rows.sort((a, b) => a.total - b.total);
}

// Plano de até 7 dias (enquanto o folheto durar), 2 refeições por dia, sem repetir pratos.
export function buildPlan(market, markets, library, today, histEntries = []) {
  if (!market.to || market.to < today) return [];
  const last = market.to < addDays(today, 6) ? market.to : addDays(today, 6);
  const dates = [];
  for (let d = today; d <= last; d = addDays(d, 1)) dates.push(d);

  const recent = new Set(histEntries.filter((h) => h.date < today).slice(-5).flatMap((h) => h.ids));
  const cands = library.map((lib) => ({ lib, picks: matchRecipe(lib, market.promos ?? []) })).filter((c) => c.picks);
  if (!cands.length) return [];

  const used = new Map(); // id -> vezes
  const cuis = new Map();
  const plan = [];
  for (const date of dates) {
    const day = { date, recipes: [] };
    for (const meal of ["Almoço", "Jantar"]) {
      const taken = day.recipes;
      const scored = cands.map((c) => {
        let s = rnd(date + "|" + market.name + "|" + meal + "|" + c.lib.id);
        s += (used.get(c.lib.id) ?? 0) * 3;
        if (recent.has(c.lib.id)) s += 1.5;
        s += (cuis.get(c.lib.c) ?? 0) * 0.35;
        if (taken.some((t) => t.cuisine === c.lib.c)) s += 1;
        if (taken.some((t) => t.ingredients[0].promoId === c.picks[0].promo.id)) s += 2;
        if (meal === "Almoço" && !/min|^1h( |$)/.test(c.lib.t)) s += 0.2;
        return { c, s };
      }).sort((a, b) => a.s - b.s);
      const { c } = scored[0];
      used.set(c.lib.id, (used.get(c.lib.id) ?? 0) + 1);
      cuis.set(c.lib.c, (cuis.get(c.lib.c) ?? 0) + 1);
      const cmp = compareRows(c.lib, markets, today);
      day.recipes.push(buildRecipe(c.lib, market, c.picks, meal, cmp.length > 1 ? cmp : undefined));
    }
    plan.push(day);
  }
  return plan;
}

// Pratos que se podem comparar em várias lojas (o mesmo prato, preço do produto principal em cada uma).
export function buildCompare(markets, library, today, max = 4) {
  const items = [];
  for (const lib of library) {
    const rows = compareRows(lib, markets, today);
    if (rows.length < 2) continue;
    const best = markets.find((m) => m.name === rows[0].market);
    const picks = matchRecipe(lib, best.promos);
    const spread = rows[rows.length - 1].total - rows[0].total;
    items.push({ lib, rows, best, picks, spread, score: rows.length * 2 + Math.min(spread, 6) + rnd(today + lib.id) });
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, max).map(({ lib, rows, best, picks }) => ({
    id: lib.id,
    name: lib.name,
    cuisine: lib.c,
    original: lib.orig,
    rows,
    market: best.name,
    recipe: buildRecipe(lib, best, picks, "Jantar", rows)
  }));
}
