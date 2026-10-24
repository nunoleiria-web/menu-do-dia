// Vigia o site e as publicações. Corre no GitHub Actions duas vezes por dia (monitor.yml).
// Se algo precisar de atenção, a execução fica a vermelho e o GitHub envia-te um email.
// O relatório completo aparece no resumo da execução (Actions → Vigiar o site → a execução).
import fs from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY || "nunoleiria-web/menu-do-dia";
const [OWNER, NAME] = REPO.split("/");
const SITE = (process.env.SITE_URL || `https://${OWNER}.github.io/${NAME}/`).replace(/\/?$/, "/");
const { IG_TOKEN, GITHUB_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
const IGRAPH = "https://graph.instagram.com/v21.0";

const lisbon = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
};
const { date: TODAY, hour: HOUR } = lisbon();
const EVENING = HOUR >= 19; // depois da janela de publicação
const hoursAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
const days = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);

const results = []; // { area, level: ok|aviso|erro, text }
const add = (area, level, text) => { results.push({ area, level, text }); console.log(`${{ ok: "✅", aviso: "⚠️ ", erro: "❌" }[level]} ${area}: ${text}`); };

async function req(url, opt = {}, tries = 3) {
  for (let i = 1; ; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(20000), headers: { "user-agent": "menu-do-dia-monitor", ...(opt.headers || {}) } });
      r.ms = Date.now() - t0;
      if (r.status >= 500 && i < tries) throw new Error("HTTP " + r.status);
      return r;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((s) => setTimeout(s, 3000 * i));
    }
  }
}

// ---------- 1. Site ----------
async function checkSite() {
  try {
    const r = await req(SITE);
    const html = await r.text();
    if (r.status !== 200) return add("Site", "erro", `a página inicial respondeu ${r.status} (${SITE})`);
    if (!/Menu do Dia/i.test(html)) return add("Site", "erro", "a página abriu mas não parece o Menu do Dia");
    add("Site", r.ms > 5000 ? "aviso" : "ok", `online, respondeu em ${(r.ms / 1000).toFixed(1)} s`);
  } catch (e) { add("Site", "erro", `não abre (${e.message})`); }
}

// ---------- 2. Menu publicado ----------
async function checkMenu() {
  let live;
  try {
    const r = await req(SITE + "api/data/menu.json", { cache: "no-store" });
    if (r.status !== 200) { add("Menu", "erro", `menu.json respondeu ${r.status}`); return null; }
    live = await r.json();
  } catch (e) { add("Menu", "erro", `não consegui ler o menu do site (${e.message})`); return null; }

  const age = hoursAgo(live.updatedAt);
  add("Atualização diária", age > 30 ? "erro" : "ok", age > 30
    ? `o menu do site não é atualizado há ${Math.round(age)} h — a atualização das 05:00 falhou ou não correu`
    : `menu atualizado há ${Math.round(age)} h`);

  // O site tem a mesma versão que o repositório? (o deploy do Pages não falha a vermelho sozinho)
  try {
    const repo = JSON.parse(fs.readFileSync(new URL("../api/data/menu.json", import.meta.url), "utf8"));
    if (repo.updatedAt !== live.updatedAt && hoursAgo(repo.updatedAt) > 1)
      add("Publicação do site", "erro", `o repositório tem o menu de ${repo.updatedAt.slice(0, 16)} mas o site ainda mostra o de ${live.updatedAt.slice(0, 16)} — a publicação no GitHub Pages falhou`);
    else add("Publicação do site", "ok", "o site mostra a versão mais recente do menu");
  } catch {}

  // Lojas: folheto em vigor e plano com receitas para hoje
  const markets = live.markets || [];
  if (!markets.length) add("Lojas", "erro", "o menu não tem nenhuma loja");
  for (const m of markets) {
    const today = (m.plan || []).find((d) => d.date === TODAY);
    if (!m.to || m.to < TODAY) add(`Loja ${m.name}`, m.to && days(m.to, TODAY) >= 2 ? "erro" : "aviso", `folheto terminou a ${m.to || "?"} e ainda não há folheto novo`);
    else if (!today?.recipes?.length) add(`Loja ${m.name}`, "aviso", "folheto em vigor mas sem receitas para hoje");
    else add(`Loja ${m.name}`, "ok", `${today.recipes.length} receitas hoje · folheto até ${m.to.slice(8)}/${m.to.slice(5, 7)}`);
  }
  return live;
}

// ---------- 3. Fotos ----------
async function checkImages(live) {
  const imgs = new Set();
  for (const m of live.markets || []) for (const d of m.plan || []) if (d.date >= TODAY) for (const r of d.recipes || []) if (r.image) imgs.add(r.image);
  for (const c of live.compare || []) if (c.recipe?.image) imgs.add(c.recipe.image);
  const list = [...imgs].filter((u) => !/^data:/.test(u));
  const bad = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < list.length) {
      const u = list[i++], url = /^https?:/.test(u) ? u : SITE + u.replace(/^\//, "");
      try { const r = await req(url, { method: "HEAD" }, 2); if (r.status !== 200) bad.push(`${u} (${r.status})`); }
      catch (e) { bad.push(`${u} (${e.message})`); }
    }
  }));
  const noImg = (live.markets || []).flatMap((m) => (m.plan || []).find((d) => d.date === TODAY)?.recipes || []).filter((r) => !r.image).map((r) => r.name);
  if (bad.length) add("Fotos", "erro", `${bad.length} de ${list.length} fotos não abrem: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}`);
  else add("Fotos", "ok", `as ${list.length} fotos das receitas abrem`);
  if (noImg.length) add("Fotos", "aviso", `receitas de hoje sem foto: ${[...new Set(noImg)].join(", ")}`);
}

// ---------- 4. Instagram ----------
async function checkInstagram() {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(new URL("../api/data/published.json", import.meta.url), "utf8")); } catch {}

  if (state.token?.since) {
    const age = days(state.token.since, TODAY);
    add("Token do Instagram", age >= 57 ? "erro" : age >= 50 ? "aviso" : "ok", age >= 50
      ? `tem ${age} dias e expira aos 60 — gera um novo e substitui o segredo IG_TOKEN`
      : `${age} dias de 60 (renovar a partir do dia 50, por volta de ${new Date(new Date(state.token.since).getTime() + 50 * 864e5).toISOString().slice(0, 10)})`);
  }

  if (IG_TOKEN) {
    try {
      const r = await req(`${IGRAPH}/me?fields=username,media_count,followers_count&access_token=${IG_TOKEN}`);
      const me = await r.json();
      if (me.error) throw new Error(me.error.message);
      add("Conta do Instagram", "ok", `@${me.username} · ${me.media_count} publicações${me.followers_count != null ? ` · ${me.followers_count} seguidores` : ""}`);
      const mr = await req(`${IGRAPH}/me/media?fields=timestamp,media_type,permalink&limit=15&access_token=${IG_TOKEN}`);
      const media = (await mr.json()).data || [];
      const todays = media.filter((p) => lisbon(new Date(p.timestamp)).date === TODAY);
      const kinds = todays.map((p) => ({ IMAGE: "foto", CAROUSEL_ALBUM: "carrossel", VIDEO: "reel" }[p.media_type] || p.media_type));
      if (EVENING && !todays.length) add("Publicações de hoje", "erro", "nenhuma publicação hoje no Instagram");
      else add("Publicações de hoje", "ok", todays.length ? `${todays.length} no Instagram (${kinds.join(", ")})` : "ainda nenhuma (a janela é das 10h às 19h)");
    } catch (e) {
      add("Conta do Instagram", "erro", `o token não funciona (${e.message}) — gera um novo e substitui o segredo IG_TOKEN`);
    }
  }

  const log = (state.date === TODAY ? state.log || [] : []);
  const errs = log.filter((l) => /:erro/.test(l));
  if (errs.length) add("Erros de publicação", "aviso", `${errs.length} tentativa(s) falharam hoje (repetidas depois): ${errs.map((l) => l.replace(/^\S+ /, "")).slice(-3).join(" | ")}`);
  if (EVENING && state.date !== TODAY && !IG_TOKEN) add("Publicações de hoje", "erro", "o publicador não correu hoje");
}

// ---------- 5. Workflows ----------
async function checkWorkflows() {
  if (!GITHUB_TOKEN) return;
  const names = { "update.yml": "Atualizar menu", "publish.yml": "Publicar receitas", "pages.yml": "Publicar o site" };
  for (const [file, label] of Object.entries(names)) {
    try {
      const r = await req(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/runs?per_page=10&status=completed`, { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json" } });
      const runs = ((await r.json()).workflow_runs || []).filter((x) => x.conclusion !== "skipped" && x.conclusion !== "cancelled");
      const last = runs[0];
      if (!last) continue;
      const failed = runs.slice(0, 5).filter((x) => x.conclusion === "failure").length;
      if (last.conclusion === "failure") add(`Workflow "${label}"`, "erro", `a última execução falhou (${last.created_at.slice(0, 16).replace("T", " ")} UTC) → ${last.html_url}`);
      else add(`Workflow "${label}"`, failed ? "aviso" : "ok", failed ? `última OK, mas ${failed} das últimas 5 falharam` : "últimas execuções OK");
    } catch (e) { add(`Workflow "${label}"`, "aviso", `não consegui consultar (${e.message})`); }
  }
}

// ---------- Relatório ----------
await checkSite();
const live = await checkMenu();
if (live) await checkImages(live);
await checkInstagram();
await checkWorkflows();

const n = (l) => results.filter((r) => r.level === l).length;
const head = n("erro") ? `❌ ${n("erro")} problema(s) a resolver` : n("aviso") ? `⚠️ Tudo a funcionar, com ${n("aviso")} aviso(s)` : "✅ Tudo a funcionar";
const md = [`## ${head}`, `Verificado a ${TODAY} às ${String(HOUR).padStart(2, "0")}h (Lisboa) · [abrir o site](${SITE})`, "",
  "| | Área | Estado |", "|---|---|---|",
  ...[...results].sort((a, b) => ["erro", "aviso", "ok"].indexOf(a.level) - ["erro", "aviso", "ok"].indexOf(b.level))
    .map((r) => `| ${{ ok: "✅", aviso: "⚠️", erro: "❌" }[r.level]} | ${r.area} | ${r.text.replace(/\|/g, "/")} |`)].join("\n");
if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, md + "\n");
console.log("\n" + head);
if (n("erro")) process.exitCode = 1;
