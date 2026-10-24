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

const perPerson = (r) => ((+r.mainCost || 0) + (+r.est || 0)) / (parseInt(r.servings) || 4);
const SITE_SHORT = SITE.replace(/^https?:\/\//, "").replace(/\/$/, "");

// Legenda: o mais importante (preço + convite para ver a receita no site) nas 2 primeiras linhas,
// que são as únicas visíveis no feed antes do "mais".
export function caption({ m, r }, handle) {
  const serv = parseInt(r.servings) || 4, per = perPerson(r);
  const main = (r.ingredients || []).find((i) => i.price);
  const bio = handle ? `link na bio @${handle}` : "link na bio";
  const tags = ["#receitas", "#menudodia", "#supermercado", "#poupar", "#" + plain(m.name), ...(r.cuisine ? ["#cozinha" + plain(r.cuisine)] : [])];
  return [
    `${EMOJI[r.meal] || "🍴"} ${r.name} por cerca de ${money(per)} por pessoa`,
    `👉 Receita completa, lista de compras e preços de todas as lojas: ${bio}`,
    "",
    [r.cuisine, r.time, `${serv} pessoas`].filter(Boolean).join(" · "),
    ...(r.description ? [r.description] : []),
    "",
    `🛒 ${m.name}${main ? `: ${main.item} a ${money(main.price)}${main.per === "kg" ? "/kg" : ""} no folheto` : ""}`,
    `💶 Produto do folheto + despensa (valor aproximado)`,
    "",
    `🔗 ${SITE_SHORT}`,
    "Preços lidos dos folhetos; confirma na loja. Imagem gerada por IA.",
    "",
    tags.join(" "),
  ].join("\n");
}

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrap(text, max) {
  const lines = [""];
  for (const w of String(text).split(/\s+/)) {
    const cur = lines[lines.length - 1];
    if ((cur + " " + w).trim().length > max && cur) lines.push(w); else lines[lines.length - 1] = (cur + " " + w).trim();
  }
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].replace(/\s*\S*$/, "") + "…"; }
  return lines;
}

// Faixa por cima da foto (1080x1350): marca, loja, nome do prato, preço por pessoa e convite para o site
export function cardSvg({ m, r }) {
  const W = 1080, H = 1350, BLUE = "#2340C8", YEL = "#FFD43B", F = "DejaVu Sans, Liberation Sans, Arial, sans-serif";
  const title = wrap(r.name, 22);
  const tY = 1060 - (title.length - 1) * 82;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.4" stop-color="#000" stop-opacity="0.75"/><stop offset="1" stop-color="#000" stop-opacity="0.92"/></linearGradient></defs>
  <rect x="0" y="${tY - 330}" width="${W}" height="${H - tY + 330}" fill="url(#g)"/>
  <g transform="translate(40,40)">
    <rect width="372" height="78" rx="39" fill="${BLUE}"/>
    <g transform="translate(26,14) scale(0.1)" fill="${YEL}"><path d="M0 300 A250 250 0 0 1 500 300 L440 300 A190 190 0 0 0 60 300 Z"/><rect x="215" y="25" width="70" height="40"/><rect x="0" y="330" width="500" height="70"/></g>
    <text x="96" y="52" font-family="${F}" font-size="32" font-weight="700" fill="${YEL}">MENU DO DIA</text>
  </g>
  <text x="60" y="${tY - 120}" font-family="${F}" font-size="34" font-weight="700" fill="${YEL}" letter-spacing="2">${esc((m.name + " · " + r.meal).toUpperCase())}</text>
  ${title.map((l, i) => `<text x="60" y="${tY - 30 + i * 82}" font-family="${F}" font-size="72" font-weight="700" fill="#fff">${esc(l)}</text>`).join("\n  ")}
  <text x="60" y="${tY + (title.length - 1) * 82 + 70}" font-family="${F}" font-size="50" font-weight="700" fill="${YEL}">≈ ${esc(money(perPerson(r)))} por pessoa</text>
  <rect x="0" y="${H - 150}" width="${W}" height="150" fill="${BLUE}"/>
  <text x="${W / 2}" y="${H - 85}" text-anchor="middle" font-family="${F}" font-size="44" font-weight="700" fill="#fff">Receita completa → link na bio</text>
  <text x="${W / 2}" y="${H - 35}" text-anchor="middle" font-family="${F}" font-size="30" fill="${YEL}">${esc(SITE_SHORT)}</text>
</svg>`;
}

const git = (c) => {
  try { return execSync(c, { cwd: ROOT, stdio: "pipe" }).toString(); }
  catch (e) { throw new Error((e.stderr?.toString() || e.message).trim().split("\n").slice(-2).join(" ")); }
};

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
  await sharp(src).resize(1080, 1350, { fit: "cover" })
    .composite([{ input: Buffer.from(cardSvg(item)), top: 0, left: 0 }])
    .jpeg({ quality: 88 }).toFile(path.join(dir, name));
  git("git config user.name 'Menu do Dia bot' && git config user.email 'noreply@users.noreply.github.com'");
  git(`git add -A public/posts`);
  if (git("git status --porcelain public/posts").trim()) {
    git(`git commit -q -m 'Imagem de publicação ${name}'`);
    let pushed = false, lastErr = "";
    for (let t = 0; t < 3 && !pushed; t++) {
      // --autostash: o npm install altera o package-lock.json e isso não pode bloquear o pull
      try { git("git pull --rebase --autostash -q origin main && git push -q origin HEAD:main"); pushed = true; } catch (e) { lastErr = e.message; await sleep(3000 * (t + 1)); }
    }
    if (!pushed) throw new Error("não foi possível enviar a imagem para o GitHub: " + lastErr);
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
    state.token.handle = me.username;
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
  let text = caption(due, state.token?.handle); const live = IG_TOKEN || (FB_PAGE_ID && FB_PAGE_TOKEN);
  console.log(`\n→ ${due.key} (horário ${Math.floor(due.slot / 60)}:${String(due.slot % 60).padStart(2, "0")})\n${text}\n`);
  if (!live) return console.log("ENSAIO: sem credenciais, nada foi publicado.");
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  let warning = null, res = [];
  try {
    if (IG_TOKEN) { warning = await checkToken(state, date); text = caption(due, state.token.handle); }
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
