// Lógica pura do menu (sem rede nem IA): escolhe receitas da biblioteca a partir das promoções,
// calcula custos pela quantidade real, monta o plano da semana e compara o mesmo prato entre lojas.
import { createHash } from "node:crypto";

export const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rnd = (s) => createHash("sha1").update(s).digest().readUInt32BE(0) / 2 ** 32;
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
    est: lib.est,
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
