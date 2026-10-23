async function findFlyer(m) {
  const src = SOURCES[m.name];
  if (!src) return null;
  const html = await (await getPage(`${BLOG}/tag/${src.tag}`)).text();
  const links = [...new Set([...html.matchAll(/href="((?:https:\/\/blog200porcento\.com)?\/antevisao-folheto-[^"#]+)"/g)].map((x) => (x[1].startsWith("/") ? BLOG + x[1] : x[1])))];
  const cands = links
    .map((url) => ({ url, s: url.split("/").pop() }))
    .filter(({ s }) => s.startsWith(`antevisao-folheto-${src.key}-frescos-`) && !s.includes("fim-de-semana") && !s.includes("madeira") && !s.includes("acores") && !s.includes("bazar"))
    .map((c) => ({ ...c, ...slugDates(c.s) }))
    .filter((c) => c.from && c.to)
    .sort((a, b) => (a.from < b.from ? 1 : -1));

  const pick = cands.find((c) => c.from <= today && c.to >= today) ?? (m.to < today ? [...cands].reverse().find((c) => c.from > today) : undefined);
  if (!pick || pick.from <= m.from) return null;

  const page = await (await getPage(pick.url)).text();
  const title = (page.match(/<title>([^<]+)<\/title>/)?.[1] ?? pick.s).replace(/\s+[-–]\s+Blog 200.*$/, "").trim();
  const og = page.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ?? page.match(/content="([^"]+)"\s+property="og:image"/)?.[1];
  const pages = [...new Set([...page.matchAll(/https:\/\/blog200porcento\.com\/storage\/b200\/[^"')\s]+?-p(\d+)\.jpe?g/g)].map((x) => x[0]))];
  const num = (u) => +u.match(/-p(\d+)\.jpe?g/)?.[1];
  const base = og && /-p\d+\.jpe?g/.test(og) ? og : pages[0];
  if (!base) throw new Error("sem imagens do folheto na página");
  const imgs = [base, ...pages.filter((u) => Math.abs(num(u) - num(base)) === 1)].slice(0, 3);
  const parts = [];
  for (const u of imgs) {
    const r = await getPage(u);
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`
      }
    });
  }

  // 1.ª passagem: ler produtos e preços das imagens
  const ex = await askOpenAI([
    { type: "text", text: `Estas imagens são páginas do folheto de promoções do ${m.name} (Portugal). Extrai os PRODUTOS ALIMENTARES (carne, peixe, legumes, fruta, laticínios, mercearia) com o preço escrito ao lado. Regras: usa só preços claramente legíveis; NUNCA estimes nem inventes; se tiveres dúvida, não incluas. "per" é "kg" quando o preço é por quilo, ou "un" para preço por unidade/embalagem (em "label" escreve a embalagem, ex.: "1,29 €/emb. 300 g"). Responde APENAS com JSON: {"products":[{"name":"","price":0.0,"per":"kg|un","label":""}]}` },
    ...parts
  ]);
  const seen = new Set();
  const items = (ex.products ?? []).map((p) => ({ id: slug(p.name ?? ""), name: String(p.name ?? "").trim(), price: Math.round(parseFloat(String(p.price).replace(",", ".")) * 100) / 100, per: p.per, ...(p.label ? { label: p.label } : {}) }))
    .filter((p) => p.id && !seen.has(p.id) && seen.add(p.id) && p.price >= 0.2 && p.price <= (p.per === "kg" ? 45 : 40) && ["kg", "un"].includes(p.per));
  if (items.length < 6) throw new Error(`só ${items.length} produtos legíveis nas imagens (mínimo 6)`);

  // 2.ª passagem: confirmar cada preço olhando novamente para as imagens
  const ver = await askOpenAI([
    { type: "text", text: `Verifica esta lista contra as imagens do folheto do ${m.name}. Para cada item, confirma SÓ se o produto aparece nas imagens com exatamente esse preço (e a unidade certa). Lista: ${items.map((p) => `${p.id}: ${p.name} ${p.price} €/${p.per}`).join("; ")}. Responde APENAS com JSON: {"confirmed":["id", ...]}` },
    ...parts
  ]);
  const ok = new Set(ver.confirmed ?? []);
  const promos = items.filter((p) => ok.has(p.id)).map((p) => ({ ...p, note: "folheto (lido por IA)" }));
  if (promos.length < 6) throw new Error(`só ${promos.length} preços confirmados (mínimo 6)`);
  const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
  return { found: true, from: pick.from, to: pick.to, flyer: `Folheto ${dm(pick.from)}–${dm(pick.to)}`, sources: [{ title: `Blog 200 — ${title}`, url: pick.url }], promos };
}
