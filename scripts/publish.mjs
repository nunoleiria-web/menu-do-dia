// Publica as receitas do dia nas redes, de forma faseada entre as 10h e as 19h (hora de Lisboa).
// Corre de 30 em 30 minutos (publish.yml); cada execução publica, no máximo, a próxima receita cujo horário já chegou.
// Sem credenciais (segredos) faz "ensaio": mostra o que publicaria, sem publicar nem gravar estado.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const REPO = process.env.GITHUB_REPOSITORY || "nunoleiria-web/menu-do-dia";
const [OWNER, NAME] = REPO.split("/");
const SITE = process.env.SITE_URL || `https://${OWNER}.github.io/${NAME}/`;   // site publicado no GitHub Pages
const { FB_PAGE_ID, FB_PAGE_TOKEN, IG_USER_ID, IG_TOKEN } = process.env;   // IG_TOKEN = só Instagram (sem Página de Facebook)
const GRAPH = "https://graph.facebook.com/v21.0";
const IGRAPH = "https://graph.instagram.com/v21.0";
const FROM = 10 * 60, TO = 19 * 60;   // janela em minutos desde as 00:00
const TOKEN_DAYS = 60, TOKEN_WARN = 50;   // o token do Instagram dura 60 dias; avisar a partir do dia 50
const KEEP_POSTS_DAYS = 7;                // imagens de publicação guardadas no repositório

const lisbon = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
};
const money = (n) => n.toFixed(2).replace(".", ",") + " €";
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const EMOJI = { Almoço: "🍽️", Jantar: "🌙" };

// Fila do dia: uma publicação por receita e loja, alternando lojas e espalhada de 10h a 19h
export function buildQueue(menu, date) {
  const byMarket = menu.markets.map((m) => ({ m, rs: (m.plan?.find((d) => d.date === date)?.recipes || []).filter((r) => r.image) }));
  const items = [], seen = new Set();   // cada prato só uma vez por dia (fica na primeira loja onde aparece)
  for (let i = 0; i < 4; i++) for (const { m, rs } of byMarket) if (rs[i] && !seen.has(rs[i].id)) { seen.add(rs[i].id); items.push({ m, r: rs[i] }); }
  const n = items.length;
  return items.map((x, i) => ({ ...x, key: `${x.m.name}|${x.r.id}`, slot: n > 1 ? Math.round(FROM + (i * (TO - FROM)) / (n - 1)) : FROM }));
}

export function caption({ m, r }) {
  const serv = parseInt(r.servings) || 4, per = ((+r.mainCost || 0) + (+r.est || 0)) / serv;
  const main = (r.ingredients || []).find((i) => i.price);
  const tags = ["#receitas", "#menudodia", "#supermercado", "#poupar", "#" + plain(m.name), ...(r.cuisine ? ["#cozinha" + plain(r.cuisine)] : [])];
  return [
    `${EMOJI[r.meal] || "🍴"} ${r.meal} · ${r.name}`,
    [r.cuisine, r.time, `${serv} pessoas`].filter(Boolean).join(" · "),
    ...(r.description ? ["", r.description] : []),
    "",
    `🛒 ${m.name}${main ? `: ${main.item} a ${money(main.price)}${main.per === "kg" ? "/kg" : ""} no folheto` : ""}`,
    `💶 Cerca de ${money(per)} por pessoa (produto do folheto + despensa, valor aproximado)`,
    "",
    `Receita completa e lista de compras: ${SITE}`,
    "Preços lidos dos folhetos; confirma na loja. Imagem gerada por IA.",
    "",
    tags.join(" "),
  ].join("\n");
}

const git = (c) => execSync(c, { cwd: ROOT, stdio: "pipe" }).toString();

// Gera a imagem 1080x1350, envia-a para o repositório e devolve o endereço público (confirmado acessível)
async function jpg(item, date) {
  const { default: sharp } = await import("sharp");
  const dir = path.join(ROOT, "public/posts");
  fs.mkdirSync(dir, { recursive: true });
  // Limpeza: apaga imagens de publicações com mais de KEEP_POSTS_DAYS dias (e as antigas sem data no nome)
  for (const f of fs.readdirSync(dir)) {
    const d = f.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    if (!d || daysBetween(d, date) > KEEP_POSTS_DAYS) git(`git rm -q --ignore-unmatch "public/posts/${f}"`), fs.rmSync(path.join(dir, f), { force: true });
  }
  const src = path.join(ROOT, "public", item.r.image.replace(/^\//, ""));
  const name = `${date}-${plain(item.m.name)}-${plain(item.r.id)}.jpg`;
  await sharp(src).resize(1080, 1350, { fit: "cover" }).jpeg({ quality: 88 }).toFile(path.join(dir, name));
  git("git config user.name 'Menu do Dia bot' && git config user.email 'noreply@users.noreply.github.com'");
  git(`git add -A public/posts`);
  if (git("git status --porcelain public/posts").trim()) {
    git(`git commit -q -m 'Imagem de publicação ${name}'`);
    let pushed = false;
    for (let t = 0; t < 3 && !pushed; t++) {
      try { git("git pull --rebase -q origin main && git push -q origin HEAD:main"); pushed = true; } catch (e) { await sleep(3000 * (t + 1)); }
    }
    if (!pushed) throw new Error("não foi possível enviar a imagem para o GitHub");
  }
  const url = `https://raw.githubusercontent.com/${REPO}/main/public/posts/${name}`;
  for (let t = 0; t < 12; t++) {          // espera até a imagem estar acessível na internet (até ~1 min)
    const r = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (r?.ok) return url;
    await sleep(5000);
  }
  throw new Error("a imagem não ficou acessível em " + url);
}

const apiError = (j, r) => {
  const e = j?.error;
  if (!e) return r.statusText || "erro " + r.status;
  return `${e.message || e.type} (código ${e.code ?? "?"}${e.error_subcode ? "/" + e.error_subcode : ""})`;
};
const post = async (url, body) => {
  const r = await fetch(url, { method: "POST", body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(apiError(j, r));
  return j;
};
const get = async (url) => {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(apiError(j, r));
  return j;
};

// Espera que o Instagram acabe de processar a imagem (até ~2 min)
async function waitReady(base, id, token) {
  for (let i = 0; i < 30; i++) {
    const s = await get(`${base}/${id}?fields=status_code,status&access_token=${token}`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("Instagram não aceitou a imagem: " + (s.status || s.status_code));
    await sleep(4000);
  }
  throw new Error("Instagram demorou demasiado a processar a imagem");
}

async function sendFacebook(img, text) { return post(`${GRAPH}/${FB_PAGE_ID}/photos`, { url: img, caption: text, access_token: FB_PAGE_TOKEN }); }
async function sendInstagramDirect(img, text) {
  const c = await post(`${IGRAPH}/me/media`, { image_url: img, caption: text, access_token: IG_TOKEN });
  await waitReady(IGRAPH, c.id, IG_TOKEN);
  return post(`${IGRAPH}/me/media_publish`, { creation_id: c.id, access_token: IG_TOKEN });
}
async function sendInstagram(img, text) {
  const c = await post(`${GRAPH}/${IG_USER_ID}/media`, { image_url: img, caption: text, access_token: FB_PAGE_TOKEN });
  await waitReady(GRAPH, c.id, FB_PAGE_TOKEN);
  return post(`${GRAPH}/${IG_USER_ID}/media_publish`, { creation_id: c.id, access_token: FB_PAGE_TOKEN });
}

// Confirma que o token do Instagram funciona e conta há quantos dias foi posto (avisa antes de expirar)
async function checkToken(state, date) {
  const hash = createHash("sha256").update(IG_TOKEN).digest("hex").slice(0, 12);   // impressão digital, não é o token
  if (state.token?.hash !== hash) state.token = { hash, since: date };
  const age = daysBetween(state.token.since, date);
  try {
    const me = await get(`${IGRAPH}/me?fields=user_id,username&access_token=${IG_TOKEN}`);
    console.log(`Token do Instagram OK: @${me.username} · em uso há ${age} dia(s) (dura ${TOKEN_DAYS})`);
  } catch (e) {
    throw new Error(`Token do Instagram inválido ou expirado (${e.message}). Gera um novo na Meta e atualiza o segredo IG_TOKEN.`);
  }
  return age >= TOKEN_WARN ? `ATENÇÃO: o token do Instagram está em uso há ${age} dias e expira aos ${TOKEN_DAYS}. Gera um novo e atualiza o segredo IG_TOKEN.` : null;
}

async function main() {
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, "api/data/menu.json"), "utf8"));
  const { date, min } = lisbon();
  const stateFile = path.join(ROOT, "api/data/published.json");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const state = prev.date === date ? prev : { date, done: [], log: [], token: prev.token };
  const queue = buildQueue(menu, date);
  const due = queue.find((q) => !state.done.includes(q.key) && q.slot <= min && min <= TO + 45);
  console.log(`${date} ${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} · fila ${queue.length} · publicadas ${state.done.length}`);
  if (!due) return console.log("Nada para publicar agora.");
  const text = caption(due), live = IG_TOKEN || (FB_PAGE_ID && FB_PAGE_TOKEN);
  console.log(`\n→ ${due.key} (horário ${Math.floor(due.slot / 60)}:${String(due.slot % 60).padStart(2, "0")})\n${text}\n`);
  if (!live) return console.log("ENSAIO: sem credenciais, nada foi publicado.");
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  let warning = null, res = [];
  try {
    if (IG_TOKEN) warning = await checkToken(state, date);
    const img = await jpg(due, date);
    const tries = [...(FB_PAGE_ID && FB_PAGE_TOKEN ? [["facebook", () => sendFacebook(img, text)]] : []), ...(IG_TOKEN ? [["instagram", () => sendInstagramDirect(img, text)]] : IG_USER_ID && FB_PAGE_TOKEN ? [["instagram", () => sendInstagram(img, text)]] : [])];
    for (const [n, f] of tries) { try { await f(); res.push(n + ":ok"); } catch (e) { res.push(`${n}:erro ${e.message}`); } }
  } catch (e) { res.push("erro: " + e.message); }
  console.log(res.join(" | "));
  const ok = res.some((x) => x.endsWith(":ok"));
  if (ok) state.done.push(due.key); else state.fails = (state.fails || 0) + 1;
  state.log.push(`${new Date().toISOString()} ${due.key} ${res.join(" ")}`);
  const warnNow = warning && state.warned !== date;   // aviso do token: uma vez por dia, para não encher o email
  if (warnNow) state.warned = date;
  save();
  if (warning) console.error("\n" + warning);
  if (!ok || warnNow) process.exitCode = 1;   // execução marcada a vermelho = o GitHub envia email de aviso
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((e) => { console.error(e); process.exit(1); });
