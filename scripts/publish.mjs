// Publica as receitas do dia nas redes, de forma faseada entre as 10h e as 19h (hora de Lisboa).
// Corre de 30 em 30 minutos (publish.yml); cada execução publica, no máximo, a próxima receita cujo horário já chegou.
// Sem credenciais (segredos) faz "ensaio": mostra o que publicaria, sem publicar nem gravar estado.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SITE = process.env.SITE_URL || "https://menu-do-dia.onrender.com";
const REPO = process.env.GITHUB_REPOSITORY || "nunoleiria-web/menu-do-dia";
const { FB_PAGE_ID, FB_PAGE_TOKEN, IG_USER_ID, IG_TOKEN } = process.env;   // IG_TOKEN = só Instagram (sem Página de Facebook)
const GRAPH = "https://graph.facebook.com/v21.0";
const FROM = 10 * 60, TO = 19 * 60;   // janela em minutos desde as 00:00

const lisbon = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
};
const money = (n) => n.toFixed(2).replace(".", ",") + " €";
const EMOJI = { Almoço: "🍽️", Jantar: "🌙" };

// Fila do dia: uma publicação por receita e loja, alternando lojas e espalhada de 10h a 19h
export function buildQueue(menu, date) {
  const byMarket = menu.markets.map((m) => ({ m, rs: (m.plan?.find((d) => d.date === date)?.recipes || []).filter((r) => r.image) }));
  const items = [];
  for (let i = 0; i < 4; i++) for (const { m, rs } of byMarket) if (rs[i]) items.push({ m, r: rs[i] });
  const n = items.length;
  return items.map((x, i) => ({ ...x, key: `${x.m.name}|${x.r.id}`, slot: n > 1 ? Math.round(FROM + (i * (TO - FROM)) / (n - 1)) : FROM }));
}

export function caption({ m, r }) {
  const serv = parseInt(r.servings) || 4, per = ((+r.mainCost || 0) + (+r.est || 0)) / serv;
  const main = r.ingredients.find((i) => i.price);
  const tags = ["#receitas", "#menudodia", "#supermercado", "#poupar", "#" + m.name.toLowerCase().replace(/[^a-z]/g, ""), "#cozinha" + r.cuisine.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")];
  return [
    `${EMOJI[r.meal] || "🍴"} ${r.meal} · ${r.name}`,
    `${r.cuisine} · ${r.time} · ${serv} pessoas`,
    "",
    r.description,
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

async function jpg(item) {
  const { default: sharp } = await import("sharp");
  const src = path.join(ROOT, "public", item.r.image.replace(/^\//, ""));
  const name = `${item.m.name}-${item.r.id}`.toLowerCase().replace(/[^a-z0-9-]/g, "") + ".jpg";
  fs.mkdirSync(path.join(ROOT, "public/posts"), { recursive: true });
  await sharp(src).resize(1080, 1350, { fit: "cover" }).jpeg({ quality: 88 }).toFile(path.join(ROOT, "public/posts", name));
  const run = (c) => execSync(c, { cwd: ROOT, stdio: "pipe" }).toString();
  run("git config user.name 'Menu do Dia bot' && git config user.email 'noreply@users.noreply.github.com'");
  run(`git add public/posts/${name}`);
  try { run(`git commit -m 'Imagem de publicação ${name}'`); run("git pull --rebase -q origin main && git push -q origin HEAD:main"); } catch {}
  return `https://raw.githubusercontent.com/${REPO}/main/public/posts/${name}`;
}

const post = async (url, body) => {
  const r = await fetch(url, { method: "POST", body: new URLSearchParams(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || r.statusText);
  return j;
};
async function sendFacebook(img, text) { return post(`${GRAPH}/${FB_PAGE_ID}/photos`, { url: img, caption: text, access_token: FB_PAGE_TOKEN }); }
async function sendInstagramDirect(img, text) {
  const G = "https://graph.instagram.com/v21.0", t = IG_TOKEN;
  const c = await post(`${G}/me/media`, { image_url: img, caption: text, access_token: t });
  for (let i = 0; i < 10; i++) {
    const s = await (await fetch(`${G}/${c.id}?fields=status_code&access_token=${t}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("Instagram não aceitou a imagem");
    await new Promise((r) => setTimeout(r, 3000));
  }
  return post(`${G}/me/media_publish`, { creation_id: c.id, access_token: t });
}
async function sendInstagram(img, text) {
  const c = await post(`${GRAPH}/${IG_USER_ID}/media`, { image_url: img, caption: text, access_token: FB_PAGE_TOKEN });
  for (let i = 0; i < 10; i++) {          // espera o Instagram processar a imagem
    const s = await (await fetch(`${GRAPH}/${c.id}?fields=status_code&access_token=${FB_PAGE_TOKEN}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("Instagram não aceitou a imagem");
    await new Promise((r) => setTimeout(r, 3000));
  }
  return post(`${GRAPH}/${IG_USER_ID}/media_publish`, { creation_id: c.id, access_token: FB_PAGE_TOKEN });
}

async function main() {
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, "api/data/menu.json"), "utf8"));
  const { date, min } = lisbon();
  const stateFile = path.join(ROOT, "api/data/published.json");
  let state = { date, done: [], log: [] };
  try { const s = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (s.date === date) state = s; } catch {}
  const queue = buildQueue(menu, date);
  const due = queue.find((q) => !state.done.includes(q.key) && q.slot <= min && min <= TO + 45);
  console.log(`${date} ${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} · fila ${queue.length} · publicadas ${state.done.length}`);
  if (!due) return console.log("Nada para publicar agora.");
  const text = caption(due), live = IG_TOKEN || (FB_PAGE_ID && FB_PAGE_TOKEN);
  console.log(`\n→ ${due.key} (horário ${Math.floor(due.slot / 60)}:${String(due.slot % 60).padStart(2, "0")})\n${text}\n`);
  if (!live) return console.log("ENSAIO: sem credenciais, nada foi publicado.");
  const img = await jpg(due), res = [];
  const tries = [...(FB_PAGE_ID && FB_PAGE_TOKEN ? [["facebook", () => sendFacebook(img, text)]] : []), ...(IG_TOKEN ? [["instagram", () => sendInstagramDirect(img, text)]] : IG_USER_ID && FB_PAGE_TOKEN ? [["instagram", () => sendInstagram(img, text)]] : [])];
  for (const [n, f] of tries) { try { await f(); res.push(n + ":ok"); } catch (e) { res.push(`${n}:erro ${e.message}`); } }
  console.log(res.join(" | "));
  if (res.some((x) => x.endsWith(":ok"))) state.done.push(due.key);
  else state.fails = (state.fails || 0) + 1;
  state.log.push(`${new Date().toISOString()} ${due.key} ${res.join(" ")}`);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  if (!res.some((x) => x.endsWith(":ok"))) process.exitCode = 1;
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((e) => { console.error(e); process.exit(1); });
