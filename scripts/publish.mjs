// Publica as receitas do dia nas redes, de forma faseada entre as 10h e as 19h (hora de Lisboa).
// Corre de 30 em 30 minutos (publish.yml); cada execução publica, no máximo, a próxima receita cujo horário já chegou.
// Formatos no Instagram (alternados): carrossel (foto → onde é mais barato → chamada para o site) e Reel (vídeo ~9 s).
// Sem credenciais faz "ensaio": mostra o que publicaria. Com PREVIEW=1 gera e envia as imagens/vídeo sem publicar.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { buildCarousel, buildReel, photoSvg, perPerson, money } from "./media.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const REPO = process.env.GITHUB_REPOSITORY || "nunoleiria-web/menu-do-dia";
const [OWNER, NAME] = REPO.split("/");
const SITE = process.env.SITE_URL || `https://${OWNER}.github.io/${NAME}/`;   // site publicado no GitHub Pages
const SITE_SHORT = SITE.replace(/^https?:\/\//, "").replace(/\/$/, "");
const { FB_PAGE_ID, FB_PAGE_TOKEN, IG_USER_ID, IG_TOKEN, PREVIEW } = process.env;   // IG_TOKEN = só Instagram (sem Página de Facebook)
const FORMAT = (process.env.IG_FORMAT || "alternar").toLowerCase();   // alternar | carrossel | reel | foto
const GRAPH = "https://graph.facebook.com/v21.0";
const IGRAPH = "https://graph.instagram.com/v21.0";
const FROM = 10 * 60, TO = 19 * 60;   // janela em minutos desde as 00:00
const TOKEN_DAYS = 60, TOKEN_WARN = 50;   // o token do Instagram dura 60 dias; avisar a partir do dia 50
const MEDIA_BRANCH = "media";             // ramo só com os ficheiros da publicação atual (substituído a cada vez, sem histórico)

const lisbon = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
};
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const EMOJI = { Almoço: "🍽️", Jantar: "🌙" };

// Fila do dia: cada prato uma vez, alternando lojas e formatos, espalhada de 10h a 19h
export function buildQueue(menu, date) {
  const byMarket = menu.markets.map((m) => ({ m, rs: (m.plan?.find((d) => d.date === date)?.recipes || []).filter((r) => r.image) }));
  const items = [], seen = new Set();   // cada prato só uma vez por dia (fica na primeira loja onde aparece)
  for (let i = 0; i < 4; i++) for (const { m, rs } of byMarket) if (rs[i] && !seen.has(rs[i].id)) { seen.add(rs[i].id); items.push({ m, r: rs[i] }); }
  const n = items.length;
  const fmt = (i) => (FORMAT === "alternar" ? (i % 2 ? "reel" : "carrossel") : FORMAT);
  return items.map((x, i) => ({ ...x, key: `${x.m.name}|${x.r.id}`, format: fmt(i), slot: n > 1 ? Math.round(FROM + (i * (TO - FROM)) / (n - 1)) : FROM }));
}

// Legenda: preço e convite para o site nas 2 primeiras linhas (as únicas visíveis no feed antes do "mais")
export function caption({ m, r, format }, handle) {
  const serv = parseInt(r.servings) || 4;
  const main = (r.ingredients || []).find((i) => i.price);
  const bio = handle ? `link na bio @${handle}` : "link na bio";
  const cheaper = (r.compare?.length > 1) ? (format === "carrossel" ? "Desliza para ver onde fica mais barato · " : format === "reel" ? "Vê no vídeo onde fica mais barato · " : "") : "";
  const tags = ["#receitas", "#menudodia", "#supermercado", "#poupar", "#" + plain(m.name), ...(r.cuisine ? ["#cozinha" + plain(r.cuisine)] : []), "#receitasfaceis", "#comidacaseira"];
  return [
    `${EMOJI[r.meal] || "🍴"} ${r.name} por cerca de ${money(perPerson(r))} por pessoa`,
    `👉 ${cheaper}Receita completa e lista de compras: ${bio}`,
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

const git = (c, input) => {
  try { return execSync(c, { cwd: ROOT, stdio: "pipe", input }).toString().trim(); }
  catch (e) { throw new Error((e.stderr?.toString() || e.message).trim().split("\n").slice(-2).join(" ")); }
};

// Envia os ficheiros para o ramo "media" (um único commit, substituído de cada vez → o repositório não cresce)
// e devolve endereços públicos, confirmados acessíveis.
async function upload(files) {
  const entries = files.map((f) => `100644 blob ${git(`git hash-object -w "${f}"`)}\t${path.basename(f)}`).join("\n") + "\n";
  const tree = git("git mktree", entries);
  const commit = git(`git -c user.name='Menu do Dia bot' -c user.email='noreply@users.noreply.github.com' commit-tree ${tree} -m 'Ficheiros da publicação'`);
  let lastErr = "";
  for (let t = 0; t < 3; t++) {
    try { git(`git push -q -f origin ${commit}:refs/heads/${MEDIA_BRANCH}`); lastErr = ""; break; } catch (e) { lastErr = e.message; await sleep(3000 * (t + 1)); }
  }
  if (lastErr) throw new Error("não foi possível enviar os ficheiros para o GitHub: " + lastErr);
  const urls = {};
  for (const f of files) {
    const n = path.basename(f);
    // jsDelivr serve o tipo certo (video/mp4, image/jpeg); o raw do GitHub fica como alternativa
    const cands = [`https://cdn.jsdelivr.net/gh/${REPO}@${commit}/${n}`, `https://raw.githubusercontent.com/${REPO}/${commit}/${n}`];
    for (let t = 0; t < 12 && !urls[n]; t++) {
      for (const u of cands) { const r = await fetch(u, { method: "HEAD" }).catch(() => null); if (r?.ok) { urls[n] = u; break; } }
      if (!urls[n]) await sleep(5000);
    }
    if (!urls[n]) { urls[n] = cands[1]; console.warn("Aviso: não confirmei o acesso a " + n + "; a tentar mesmo assim."); }
  }
  return urls;
}

// Gera todos os ficheiros da publicação (foto simples, carrossel e Reel) e envia-os
async function prepareMedia(item, date, handle) {
  const { default: sharp } = await import("sharp");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-"));
  const name = `${date}-${plain(item.m.name)}-${plain(item.r.id)}`;
  const photo = path.join(ROOT, "public", item.r.image.replace(/^\//, ""));
  const single = path.join(dir, `${name}.jpg`);
  await sharp(photo).resize(1080, 1350, { fit: "cover" })
    .composite([{ input: Buffer.from(photoSvg(item, 1080, 1350, { site: SITE_SHORT })), top: 0, left: 0 }])
    .jpeg({ quality: 88 }).toFile(single);
  const slides = item.format === "foto" ? [] : await buildCarousel(item, photo, dir, name, handle, SITE_SHORT);
  let reel = [];
  if (item.format === "reel") {
    try { reel = await buildReel(item, photo, dir, name, handle, SITE_SHORT); }
    catch (e) { console.warn("Não foi possível criar o vídeo (" + e.message.slice(0, 120) + "); vai como carrossel."); }
  }
  const urls = await upload([single, ...slides, ...reel]);
  const u = (f) => urls[path.basename(f)];
  return { single: u(single), slides: slides.map(u), video: reel[0] && u(reel[0]), cover: reel[1] && u(reel[1]) };
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

// Espera que o Instagram acabe de processar um ficheiro (imagens ~segundos, vídeo até ~5 min)
async function waitReady(base, id, token, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const s = await get(`${base}/${id}?fields=status_code,status&access_token=${token}`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("Instagram não aceitou o ficheiro: " + (s.status || s.status_code));
    await sleep(5000);
  }
  throw new Error("Instagram demorou demasiado a processar o ficheiro");
}

// Instagram: API com login do Instagram (IG_TOKEN, "me") ou através da Página de Facebook (IG_USER_ID + FB_PAGE_TOKEN)
const ig = () => (IG_TOKEN ? { base: IGRAPH, who: "me", token: IG_TOKEN } : { base: GRAPH, who: IG_USER_ID, token: FB_PAGE_TOKEN });
async function igPublish(params, tries) {
  const { base, who, token } = ig();
  const c = await post(`${base}/${who}/media`, { ...params, access_token: token });
  await waitReady(base, c.id, token, tries);
  return post(`${base}/${who}/media_publish`, { creation_id: c.id, access_token: token });
}
const igPhoto = (img, text) => igPublish({ image_url: img, caption: text });
async function igCarousel(imgs, text) {
  const { base, who, token } = ig();
  const kids = [];
  for (const img of imgs) {
    const c = await post(`${base}/${who}/media`, { image_url: img, is_carousel_item: "true", access_token: token });
    await waitReady(base, c.id, token);
    kids.push(c.id);
  }
  return igPublish({ media_type: "CAROUSEL", children: kids.join(","), caption: text });
}
const igReel = (video, cover, text) => igPublish({ media_type: "REELS", video_url: video, ...(cover ? { cover_url: cover } : {}), caption: text, share_to_feed: "true" }, 60);
const sendFacebook = (img, text) => post(`${GRAPH}/${FB_PAGE_ID}/photos`, { url: img, caption: text, access_token: FB_PAGE_TOKEN });

// Tenta o formato pedido e, se falhar, um mais simples (Reel → carrossel → foto)
export async function sendInstagram(item, media, handle) {
  const plan = [];
  if (item.format === "reel" && media.video) plan.push(["reel", () => igReel(media.video, media.cover, caption({ ...item, format: "reel" }, handle))]);
  if (item.format !== "foto" && media.slides.length) plan.push(["carrossel", () => igCarousel(media.slides, caption({ ...item, format: "carrossel" }, handle))]);
  plan.push(["foto", () => igPhoto(media.single, caption({ ...item, format: "foto" }, handle))]);
  const errs = [];
  for (const [fmt, f] of plan) {
    try { await f(); return `instagram:ok (${fmt})${errs.length ? " depois de: " + errs.join("; ") : ""}`; }
    catch (e) { errs.push(`${fmt} falhou: ${e.message}`); }
  }
  throw new Error(errs.join("; "));
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
  console.log(`${date} ${hhmm(min)} · fila ${queue.length} · publicadas ${state.done.length}`);

  if (PREVIEW) {   // pré-visualização: gera e envia os ficheiros da próxima receita, sem publicar
    const item = queue.find((q) => !state.done.includes(q.key)) || queue[0];
    if (!item) return console.log("Fila vazia.");
    console.log(`PRÉ-VISUALIZAÇÃO de ${item.key} (${item.format})\n\n${caption(item, state.token?.handle)}\n`);
    const media = await prepareMedia({ ...item, format: "reel" }, date, state.token?.handle);
    console.log("Ficheiros:\n" + [media.single, ...media.slides, media.video, media.cover].filter(Boolean).join("\n"));
    return;
  }

  const due = queue.find((q) => !state.done.includes(q.key) && q.slot <= min && min <= TO + 45);
  if (!due) return console.log("Nada para publicar agora.");
  console.log(`\n→ ${due.key} · ${due.format} (horário ${hhmm(due.slot)})\n${caption(due, state.token?.handle)}\n`);
  const live = IG_TOKEN || (FB_PAGE_ID && FB_PAGE_TOKEN);
  if (!live) return console.log("ENSAIO: sem credenciais, nada foi publicado.");

  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  let warning = null;
  const res = [];
  try {
    if (IG_TOKEN) warning = await checkToken(state, date);
    const handle = state.token?.handle;
    const media = await prepareMedia(due, date, handle);
    if (FB_PAGE_ID && FB_PAGE_TOKEN) { try { await sendFacebook(media.single, caption({ ...due, format: "foto" }, handle)); res.push("facebook:ok"); } catch (e) { res.push("facebook:erro " + e.message); } }
    if (IG_TOKEN || (IG_USER_ID && FB_PAGE_TOKEN)) { try { res.push(await sendInstagram(due, media, handle)); } catch (e) { res.push("instagram:erro " + e.message); } }
  } catch (e) { res.push("erro: " + e.message); }
  console.log(res.join(" | "));
  const ok = res.some((x) => /:ok/.test(x));
  if (ok) state.done.push(due.key); else state.fails = (state.fails || 0) + 1;
  state.log.push(`${new Date().toISOString()} ${due.key} ${res.join(" ")}`);
  const warnNow = warning && state.warned !== date;   // aviso do token: uma vez por dia, para não encher o email
  if (warnNow) state.warned = date;
  save();
  if (warning) console.error("\n" + warning);
  if (!ok || warnNow) process.exitCode = 1;   // execução marcada a vermelho = o GitHub envia email de aviso
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((e) => { console.error(e); process.exit(1); });
