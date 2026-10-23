import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";

const SUPERMARKETS = [
  { name: "Continente", accent: "#c8102e", note: "Folheto semanal + cupões na app" },
  { name: "Pingo Doce", accent: "#00793a", note: "Saldo em cartão acumula com o folheto" },
  { name: "Lidl", accent: "#0050aa", note: "Sem loja online — preços do folheto" },
  { name: "Aldi", accent: "#0b1e64", note: "Sem cartão: o preço anunciado é o que pagas" },
  { name: "Intermarché", accent: "#d40000", note: "Descontos em cartão acumuláveis" },
] as const;

const MEAL_TAG = ["Prato principal", "Alternativa"];
type Ingredient = { item: string; qty: string; price: string; note?: string };
type Meal = {
  id: number;
  supermarket: string;
  slot: number;
  name: string;
  description: string | null;
  servings: string | null;
  time: string | null;
  ingredients: Ingredient[];
  steps: string[];
  totalCost: string;
  image: string | null;
  imageCredit: { name: string; url: string } | null;
  source: string | null;
  validFrom: string;
  validTo: string;
  status: "active" | "upcoming" | "expired";
  sources: { title: string; url: string }[];
  check: { date: string; result: "novo" | "sem-novo" | "sem-folheto" } | null;
};

const dm = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
function checkInfo(m: Meal): { text: string; tone: "ok" | "info" | "warn" } | null {
  if (!m.check) return null;
  const when = `verificado a ${dm(m.check.date)}`;
  if (m.check.result === "novo") return { tone: "ok", text: `Folheto novo carregado (${dm(m.validFrom)}–${dm(m.validTo)}) · ${when}` };
  if (m.check.result === "sem-novo") return { tone: "info", text: `Sem folheto novo · receitas novas com as promoções em vigor (${dm(m.validFrom)}–${dm(m.validTo)}) · ${when}` };
  return { tone: "warn", text: `Sem folheto nem promoções válidas hoje · a mostrar o último folheto, expirado a ${dm(m.validTo)} · ${when}` };
}

function validity(m: Meal) {
  if (m.status === "upcoming") return `Preços válidos a partir de ${dm(m.validFrom)} (até ${dm(m.validTo)})`;
  if (m.status === "expired") return `Folheto expirado em ${dm(m.validTo)} — preços podem ter mudado`;
  return `Preços válidos até ${dm(m.validTo)}`;
}

function parseCost(price: string): number | null {
  const afterArrow = price.split("→").pop() ?? price;
  const m = afterArrow.match(/([\d]+[.,][\d]{2})\s*€/);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

function formatDay(day: string) {
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 19) return "Boa tarde";
  return "Boa noite";
}

export default function Home() {
  const { data, isLoading, isError } = trpc.suggestions.today.useQuery();
  const [active, setActive] = useState<string>("Continente");
  const [basket, setBasket] = useState<Set<number>>(() => {
    try {
      return new Set<number>(JSON.parse(localStorage.getItem("menudia-basket") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("menudia-checked") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [listOpen, setListOpen] = useState(false);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);

  useEffect(() => {
    localStorage.setItem("menudia-basket", JSON.stringify([...basket]));
  }, [basket]);
  useEffect(() => {
    localStorage.setItem("menudia-checked", JSON.stringify([...checked]));
  }, [checked]);

  const meals = useMemo(
    () => ((data?.meals ?? []) as Meal[]).filter((m) => m.supermarket === active),
    [data, active]
  );
  const market = SUPERMARKETS.find((s) => s.name === active)!;

  const toggleBasket = (id: number) =>
    setBasket((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleChecked = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const basketMeals = useMemo(
    () => ((data?.meals ?? []) as Meal[]).filter((m) => basket.has(m.id)),
    [data, basket]
  );
  useEffect(() => {
    if (!data?.meals) return;
    const ids = new Set((data.meals as Meal[]).map((m) => m.id));
    setBasket((prev) => (prev.size && [...prev].some((id) => !ids.has(id)) ? new Set([...prev].filter((id) => ids.has(id))) : prev));
  }, [data]);

  const basketTotal = useMemo(
    () =>
      basketMeals.reduce(
        (sum, m) => sum + m.ingredients.reduce((s, ing) => s + (parseCost(ing.price) ?? 0), 0),
        0
      ),
    [basketMeals]
  );
  const basketByMarket = useMemo(() => {
    const map = new Map<string, Meal[]>();
    for (const m of basketMeals) {
      const arr = map.get(m.supermarket) ?? [];
      arr.push(m);
      map.set(m.supermarket, arr);
    }
    return [...map.entries()];
  }, [basketMeals]);

  useEffect(() => {
    document.body.style.overflow = openMeal || listOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [openMeal, listOpen]);


  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMeal(null);
        setListOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = (m: Meal) => m.ingredients.reduce((s, i) => s + (parseCost(i.price) ?? 0), 0);
  const status = meals[0] ? checkInfo(meals[0]) : null;
  const tone = { ok: "bg-emerald-50 text-emerald-900", info: "bg-[#E9EEEA] text-[#3E4D45]", warn: "bg-rose-50 text-rose-900" };
  const keys = basketMeals.flatMap((m) => m.ingredients.map((_, j) => `${m.id}-${j}`));
  const done = keys.filter((k) => checked.has(k)).length;
  const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D5C3F]";
  const copyList = async () => {
    const text = basketByMarket
      .map(([mk, ms]) => `${mk}\n` + ms.flatMap((m) => m.ingredients.filter((i) => parseCost(i.price) !== null).map((i) => `- ${i.item} (${i.qty})`)).join("\n"))
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão para copiar */
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F5F2] text-[#14211B]">
      <header className="sticky top-0 z-30 border-b border-[#E2E7E3] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1D5C3F] text-lg font-bold text-white">M</span>
            <span className="text-[17px] font-semibold tracking-tight">Menu do Dia</span>
          </div>
          <button
            onClick={() => setListOpen(true)}
            aria-label={`Abrir lista de compras (${basketMeals.length} receitas)`}
            className={`flex items-center gap-2 rounded-full bg-[#14211B] px-4 py-2 text-sm font-medium text-white ${focus}`}
          >
            <Icon n="cart" />
            Lista
            {basketMeals.length > 0 && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-[#14211B]">
                {basketMeals.length} · {eur(basketTotal)}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
        <h1 className="max-w-xl text-[28px] font-semibold leading-tight tracking-tight md:text-4xl">{greeting()}, o que vais cozinhar hoje?</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#5C6B63]">
          {data ? `${formatDay(data.day)}. ` : ""}Receitas feitas com os produtos em promoção de cada supermercado, com o preço de cada ingrediente.
        </p>

        <div role="tablist" aria-label="Supermercado" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1">
          {SUPERMARKETS.map((s) => {
            const on = s.name === active;
            return (
              <button
                key={s.name}
                role="tab"
                aria-selected={on}
                onClick={() => setActive(s.name)}
                style={on ? { background: s.accent } : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${focus} ${
                  on ? "border-transparent text-white" : "border-[#D5DCD7] bg-white hover:bg-[#EAEFEB]"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: on ? "#fff" : s.accent }} />
                {s.name}
              </button>
            );
          })}
        </div>

        {status && <p className={`mt-4 rounded-2xl px-4 py-3 text-[13px] leading-snug ${tone[status.tone]}`}>{status.text}</p>}

        {isLoading && (
          <div className="mt-6 grid gap-5 md:grid-cols-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-[#E4EAE6]" />
            ))}
          </div>
        )}
        {isError && <p className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-900">Não foi possível carregar o menu. Atualiza a página dentro de instantes.</p>}
        {!isLoading && !isError && meals.length === 0 && <p className="mt-6 rounded-2xl bg-white p-4 text-[#5C6B63]">Ainda não há receitas para este supermercado.</p>}

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {meals.map((m, idx) => {
            const added = basket.has(m.id);
            return (
              <article key={m.id} className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(20,33,27,.06),0_12px_28px_-14px_rgba(20,33,27,.22)]">
                {m.image ? <img src={m.image} alt={m.name} loading="lazy" className="aspect-[16/10] w-full object-cover" /> : <div className="h-1.5 w-full" style={{ background: market.accent }} />}
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#5C6B63]">{MEAL_TAG[idx] ?? "Receita"}</p>
                      <h2 className="mt-0.5 text-lg font-semibold leading-snug">
                        <button onClick={() => setOpenMeal(m)} className={`text-left hover:underline ${focus}`}>{m.name}</button>
                      </h2>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="block text-2xl font-bold tabular-nums leading-none">{eur(total(m))}</span>
                      <span className="mt-1 block text-xs text-[#5C6B63]">{m.servings}</span>
                    </p>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#5C6B63]">{m.description}</p>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-[#5C6B63]">
                    <Icon n="clock" />
                    {m.time}
                  </p>
                  <div className="mt-auto flex gap-2 pt-4">
                    <button onClick={() => setOpenMeal(m)} className={`flex-1 rounded-full bg-[#14211B] py-3 text-sm font-medium text-white ${focus}`}>Ver receita</button>
                    <button
                      onClick={() => toggleBasket(m.id)}
                      aria-pressed={added}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border py-3 text-sm font-medium ${focus} ${
                        added ? "border-[#1D5C3F] bg-[#1D5C3F]/10 text-[#1D5C3F]" : "border-[#D5DCD7] hover:bg-[#EAEFEB]"
                      }`}
                    >
                      {added && <Icon n="check" />}
                      {added ? "Na lista" : "Adicionar à lista"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-[#5C6B63]">
          {meals[0] ? `${meals[0].source} · ${validity(meals[0])}` : "Folhetos semanais"} · Confirma os preços na loja · Fotos: Pexels
        </p>
      </main>

      {openMeal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={openMeal.name}>
          <button aria-label="Fechar receita" className="absolute inset-0 bg-[#14211B]/55" onClick={() => setOpenMeal(null)} />
          <div className="sheet-up relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white md:max-w-xl md:rounded-3xl">
            <div className="overflow-y-auto">
              {openMeal.image ? <img src={openMeal.image} alt={openMeal.name} className="h-56 w-full object-cover" /> : <div className="h-1.5" style={{ background: SUPERMARKETS.find((s) => s.name === openMeal.supermarket)?.accent }} />}
              <div className="p-5 md:p-6">
                <p className="text-xs font-medium text-[#5C6B63]">{openMeal.supermarket}</p>
                <h2 className="mt-1 text-2xl font-semibold leading-tight">{openMeal.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#5C6B63]">{openMeal.description}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    [openMeal.time, "Tempo"],
                    [openMeal.servings, "Para"],
                    [eur(total(openMeal)), "Custo"],
                  ].map(([v, l]) => (
                    <div key={l} className="rounded-2xl bg-[#F3F5F2] px-2 py-3">
                      <p className="text-[15px] font-semibold tabular-nums">{v}</p>
                      <p className="text-xs text-[#5C6B63]">{l}</p>
                    </div>
                  ))}
                </div>

                <h3 className="mt-6 text-base font-semibold">Ingredientes</h3>
                <ul className="mt-2 divide-y divide-[#E2E7E3]">
                  {openMeal.ingredients.map((ing, j) => {
                    const c = parseCost(ing.price);
                    return (
                      <li key={j} className="flex items-baseline justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[15px]">{ing.item}</p>
                          <p className="text-xs text-[#5C6B63]">{c === null ? ing.qty : `${ing.qty} · ${ing.price.split("→")[0].trim()}`}</p>
                        </div>
                        <p className={`shrink-0 text-sm tabular-nums ${c === null ? "text-[#5C6B63]" : "font-semibold"}`}>{c === null ? "em casa" : eur(c)}</p>
                      </li>
                    );
                  })}
                </ul>

                <h3 className="mt-6 text-base font-semibold">Preparação</h3>
                <ol className="mt-3 space-y-4">
                  {openMeal.steps.map((s, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1D5C3F] text-xs font-semibold text-white">{j + 1}</span>
                      <p className="text-[15px] leading-relaxed">{s}</p>
                    </li>
                  ))}
                </ol>

                <p className="mt-6 text-xs leading-relaxed text-[#5C6B63]">
                  {openMeal.source} · {validity(openMeal)}
                  {openMeal.imageCredit && (
                    <a href={openMeal.imageCredit.url} target="_blank" rel="noreferrer" className="mt-1 block underline">Foto: {openMeal.imageCredit.name} / Pexels</a>
                  )}
                  {openMeal.sources.map((x) => (
                    <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="mt-1 block underline">{x.title}</a>
                  ))}
                </p>
              </div>
            </div>
            <div className="flex gap-2 border-t border-[#E2E7E3] bg-white p-4">
              <button onClick={() => setOpenMeal(null)} className={`rounded-full border border-[#D5DCD7] px-5 py-3 text-sm font-medium ${focus}`}>Fechar</button>
              <button
                onClick={() => toggleBasket(openMeal.id)}
                className={`flex-1 rounded-full py-3 text-sm font-medium ${focus} ${basket.has(openMeal.id) ? "bg-[#1D5C3F]/10 text-[#1D5C3F]" : "bg-[#1D5C3F] text-white"}`}
              >
                {basket.has(openMeal.id) ? "Na lista · retirar" : `Adicionar à lista · ${eur(total(openMeal))}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {listOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Lista de compras">
          <button aria-label="Fechar lista" className="absolute inset-0 bg-[#14211B]/55" onClick={() => setListOpen(false)} />
          <div className="sheet-up relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white md:max-w-xl md:rounded-3xl">
            <div className="flex items-start justify-between gap-4 p-5 pb-3">
              <div>
                <h2 className="text-xl font-semibold">Lista de compras</h2>
                <p className="mt-0.5 text-sm text-[#5C6B63]">{keys.length > 0 ? `${done} de ${keys.length} ingredientes marcados` : "Ainda sem receitas"}</p>
              </div>
              <button onClick={() => setListOpen(false)} aria-label="Fechar" className={`rounded-full border border-[#D5DCD7] px-4 py-2 text-sm font-medium ${focus}`}>Fechar</button>
            </div>
            <div className="overflow-y-auto px-5 pb-4">
              {basketMeals.length === 0 && <p className="rounded-2xl bg-[#F3F5F2] p-4 text-sm leading-relaxed text-[#5C6B63]">A lista está vazia. Abre uma receita e carrega em «Adicionar à lista» para veres aqui os ingredientes e o total.</p>}
              {basketByMarket.map(([mk, ms]) => (
                <section key={mk} className="mt-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <span className="h-2 w-2 rounded-full" style={{ background: SUPERMARKETS.find((s) => s.name === mk)?.accent }} />
                    {mk}
                  </h3>
                  {ms.map((m) => (
                    <div key={m.id} className="mt-2">
                      <p className="text-xs font-medium text-[#5C6B63]">{m.name}</p>
                      <ul className="divide-y divide-[#E2E7E3]">
                        {m.ingredients.map((ing, j) => {
                          const k = `${m.id}-${j}`;
                          const c = parseCost(ing.price);
                          return (
                            <li key={k}>
                              <label className="flex cursor-pointer items-center gap-3 py-2.5">
                                <input type="checkbox" checked={checked.has(k)} onChange={() => toggleChecked(k)} className="h-5 w-5 accent-[#1D5C3F]" />
                                <span className={`flex-1 text-[15px] ${checked.has(k) ? "text-[#5C6B63] line-through" : ""}`}>
                                  {ing.item} <span className="text-xs text-[#5C6B63]">{ing.qty}</span>
                                </span>
                                <span className="text-sm tabular-nums text-[#5C6B63]">{c === null ? "em casa" : eur(c)}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            {basketMeals.length > 0 && (
              <div className="border-t border-[#E2E7E3] p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[#5C6B63]">Total estimado (custo das quantidades)</span>
                  <span className="text-2xl font-bold tabular-nums">{eur(basketTotal)}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setBasket(new Set());
                      setChecked(new Set());
                    }}
                    className={`rounded-full border border-[#D5DCD7] px-5 py-3 text-sm font-medium ${focus}`}
                  >
                    Limpar
                  </button>
                  <button onClick={copyList} className={`flex-1 rounded-full bg-[#1D5C3F] py-3 text-sm font-medium text-white ${focus}`}>
                    {copied ? "Lista copiada" : "Copiar lista"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ICONS = {
  cart: "M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20 8H6.2M9 20.5h.01M17 20.5h.01",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  check: "m5 12.5 4.5 4.5L19 7.5",
} as const;

function Icon({ n }: { n: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[n]} />
    </svg>
  );
}
