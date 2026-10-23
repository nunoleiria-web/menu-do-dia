import { MARKETS, type Ing } from "../flyer-data";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Data de hoje em Lisboa (AAAA-MM-DD), não em UTC. */
export function lisbonToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
}

function cost(i: Ing): number | null {
  return i.price != null && i.amount != null ? i.price * i.amount : null;
}

function priceText(i: Ing): string {
  const c = cost(i);
  if (c === null) return "despensa";
  const unit = i.label ?? `${eur(i.price!)}/${i.per}`;
  return `${unit} → ${eur(c)}`;
}

export function getTodaySuggestions(today = lisbonToday()) {
  const meals = MARKETS.flatMap((m, mi) => {
    const status = today < m.from ? "upcoming" : today > m.to ? "expired" : "active";
    return m.recipes.map((r) => {
      const total = r.ingredients.reduce((s, i) => s + (cost(i) ?? 0), 0);
      return {
        id: mi * 10 + r.slot, // estável: a lista de compras não fica órfã
        supermarket: m.name,
        slot: r.slot,
        name: r.name,
        description: r.description,
        servings: r.servings,
        time: r.time,
        ingredients: r.ingredients.map((i) => ({
          item: i.item,
          qty: i.qty,
          price: priceText(i),
          note: i.note,
        })),
        steps: r.steps,
        image: r.image ?? null,
        imageCredit: r.imageCredit ?? null,
        totalCost: `≈ ${eur(total)}`,
        source: m.flyer,
        validFrom: m.from,
        validTo: m.to,
        status,
        sources: m.sources,
        check: m.check ?? null,
      };
    });
  });
  return { day: today, meals };
}
