// Imagens e vídeo das publicações do Instagram (carrossel e Reel), gerados a partir de cada receita.
// Tudo em SVG desenhado aqui e convertido com a sharp; o vídeo é montado com o ffmpeg.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BLUE = "#2340C8", BLUE2 = "#16288A", YEL = "#FFD43B", F = "DejaVu Sans, Liberation Sans, Arial, sans-serif";
export const money = (n) => (+n).toFixed(2).replace(".", ",") + " €";
export const perPerson = (r, mainTotal = r.mainCost) => ((+mainTotal || 0) + (+r.est || 0)) / (parseInt(r.servings) || 4);
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1).trimEnd() + "…" : String(t));

export function wrap(text, max, lines = 2) {
  const out = [""];
  for (const w of String(text).split(/\s+/)) {
    const cur = out[out.length - 1];
    if ((cur + " " + w).trim().length > max && cur) out.push(w); else out[out.length - 1] = (cur + " " + w).trim();
  }
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, "") + "…"; }
  return out;
}

// Logótipo do site (cloche amarela), desenhado numa caixa de 500x400
const cloche = (x, y, s, fill = YEL) => `<g transform="translate(${x},${y}) scale(${s})" fill="${fill}"><path d="M0 300 A250 250 0 0 1 500 300 L425 300 A175 175 0 0 0 75 300 Z"/><rect x="212" y="20" width="76" height="45"/><rect x="0" y="330" width="500" height="75"/></g>`;
const badge = (x, y) => `<g transform="translate(${x},${y})"><rect width="372" height="78" rx="39" fill="${BLUE}"/>${cloche(26, 14, 0.1)}<text x="96" y="52" font-family="${F}" font-size="32" font-weight="700" fill="${YEL}">MENU DO DIA</text></g>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;

// 1) Foto do prato com nome, loja e preço por pessoa. bottom = texto da barra azul de baixo (ou nada)
export function photoSvg({ m, r }, W, H, { bottom = "Receita completa → link na bio", site = "" } = {}) {
  const title = wrap(r.name, 22);
  const bar = bottom ? 150 : 0;
  const tY = H - bar - 290 - (title.length - 1) * 82;
  return svg(W, H, `
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.4" stop-color="#000" stop-opacity="0.75"/><stop offset="1" stop-color="#000" stop-opacity="0.92"/></linearGradient></defs>
  <rect x="0" y="${tY - 330}" width="${W}" height="${H - tY + 330}" fill="url(#g)"/>
  ${badge(40, 40)}
  <text x="60" y="${tY - 120}" font-family="${F}" font-size="34" font-weight="700" fill="${YEL}" letter-spacing="2">${esc((m.name + " · " + r.meal).toUpperCase())}</text>
  ${title.map((l, i) => `<text x="60" y="${tY - 30 + i * 82}" font-family="${F}" font-size="72" font-weight="700" fill="#fff">${esc(l)}</text>`).join("")}
  <text x="60" y="${tY + (title.length - 1) * 82 + 70}" font-family="${F}" font-size="50" font-weight="700" fill="${YEL}">≈ ${esc(money(perPerson(r)))} por pessoa</text>
  ${bottom ? `<rect x="0" y="${H - bar}" width="${W}" height="${bar}" fill="${BLUE}"/>
  <text x="${W / 2}" y="${H - (site ? 85 : 62)}" text-anchor="middle" font-family="${F}" font-size="44" font-weight="700" fill="#fff">${esc(bottom)}</text>
  ${site ? `<text x="${W / 2}" y="${H - 35}" text-anchor="middle" font-family="${F}" font-size="30" fill="${YEL}">${esc(site)}</text>` : ""}` : ""}`);
}

// 2) "Onde fica mais barato?" — o mesmo prato em cada loja (ou, se só houver uma, o que leva)
export function compareSvg({ m, r }, W, H) {
  const rows = (r.compare?.length > 1 ? r.compare : []).slice(0, 5).map((c) => ({ ...c, pp: perPerson(r, c.total) })).sort((a, b) => a.pp - b.pp);
  let body;
  if (rows.length) {
    const top = Math.max(Math.round(H * 0.16), Math.round((H - (170 + rows.length * 172 + 60)) / 2) + 20);   // bloco centrado
    const rh = 150, y0 = top + 170;
    body = `
    <text x="${W / 2}" y="${top}" text-anchor="middle" font-family="${F}" font-size="64" font-weight="700" fill="#fff">Onde fica mais barato?</text>
    <text x="${W / 2}" y="${top + 70}" text-anchor="middle" font-family="${F}" font-size="38" fill="${YEL}">${esc(cut(r.name, 40))}</text>
    ${rows.map((c, i) => {
      const y = y0 + i * (rh + 22), best = i === 0;
      return `<rect x="60" y="${y}" width="${W - 120}" height="${rh}" rx="28" fill="${best ? YEL : "#fff"}" fill-opacity="${best ? 1 : 0.1}"/>
      <text x="100" y="${y + 62}" font-family="${F}" font-size="44" font-weight="700" fill="${best ? BLUE2 : "#fff"}">${esc(c.market)}</text>
      ${best ? `<rect x="${124 + c.market.length * 29}" y="${y + 26}" width="210" height="46" rx="23" fill="${BLUE2}"/><text x="${229 + c.market.length * 29}" y="${y + 58}" text-anchor="middle" font-family="${F}" font-size="24" font-weight="700" fill="${YEL}">MAIS BARATO</text>` : ""}
      <text x="100" y="${y + 112}" font-family="${F}" font-size="28" fill="${best ? BLUE2 : "#dfe4ff"}">${esc(cut(c.product, 24))} · ${esc(money(c.price))}${c.per === "kg" ? "/kg" : ""}</text>
      <text x="${W - 100}" y="${y + 70}" text-anchor="end" font-family="${F}" font-size="52" font-weight="700" fill="${best ? BLUE2 : "#fff"}">${esc(money(c.pp))}</text>
      <text x="${W - 100}" y="${y + 112}" text-anchor="end" font-family="${F}" font-size="26" fill="${best ? BLUE2 : "#dfe4ff"}">por pessoa</text>`;
    }).join("")}
    <text x="${W / 2}" y="${y0 + rows.length * (rh + 22) + 60}" text-anchor="middle" font-family="${F}" font-size="28" fill="#dfe4ff">Preços dos folhetos desta semana · valores aproximados</text>`;
  } else {
    const ing = (r.ingredients || []).slice(0, 8), top = Math.round(H * 0.18);
    body = `
    <text x="${W / 2}" y="${top}" text-anchor="middle" font-family="${F}" font-size="64" font-weight="700" fill="#fff">O que precisas</text>
    <text x="${W / 2}" y="${top + 70}" text-anchor="middle" font-family="${F}" font-size="38" fill="${YEL}">${esc(cut(r.name, 40))} · ${esc(r.servings || "4 pessoas")}</text>
    ${ing.map((x, i) => `<text x="110" y="${top + 200 + i * 80}" font-family="${F}" font-size="40" fill="${x.price ? YEL : "#fff"}" font-weight="${x.price ? 700 : 400}">${x.price ? "★" : "•"} ${esc(cut(x.item + (x.qty ? " · " + x.qty : ""), 32))}${x.price ? "  " + esc(money(x.price)) : ""}</text>`).join("")}
    <text x="110" y="${top + 200 + ing.length * 80 + 30}" font-family="${F}" font-size="30" fill="#dfe4ff">★ em promoção no folheto do ${esc(m.name)}</text>`;
  }
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${BLUE}"/>${badge(40, 40)}${body}`);
}

// 3) Chamada final para o site
export function ctaSvg({ r }, W, H, handle, site) {
  const c = Math.round(H * 0.17);
  const items = ["Receita passo a passo", "Lista de compras pronta", "Preços de 5 supermercados", "Plano para a semana"];
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${BLUE}"/>
  ${cloche(W / 2 - 150, c, 0.6)}
  <text x="${W / 2}" y="${c + 360}" text-anchor="middle" font-family="${F}" font-size="68" font-weight="700" fill="#fff">Receita completa</text>
  <text x="${W / 2}" y="${c + 430}" text-anchor="middle" font-family="${F}" font-size="40" fill="${YEL}">${esc(cut(r.name, 34))}</text>
  ${items.map((t, i) => `<text x="${W / 2 - 300}" y="${c + 550 + i * 72}" font-family="${F}" font-size="42" fill="#fff"><tspan fill="${YEL}" font-weight="700">✓</tspan>  ${esc(t)}</text>`).join("")}
  <rect x="80" y="${c + 880}" width="${W - 160}" height="130" rx="65" fill="${YEL}"/>
  <text x="${W / 2}" y="${c + 962}" text-anchor="middle" font-family="${F}" font-size="50" font-weight="700" fill="${BLUE2}">Link na bio → ${esc(handle ? "@" + handle : "")}</text>
  <text x="${W / 2}" y="${c + 1075}" text-anchor="middle" font-family="${F}" font-size="32" fill="#dfe4ff">${esc(site)}</text>`);
}

async function render(sharp, base, overlay, W, H, out) {
  const img = base ? sharp(base).resize(W, H, { fit: "cover" }) : sharp({ create: { width: W, height: H, channels: 3, background: BLUE } });
  await img.composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).jpeg({ quality: 88 }).toFile(out);
  return out;
}

// Carrossel 1080x1350: foto → comparação → chamada para o site
export async function buildCarousel(item, photo, dir, name, handle, site) {
  const { default: sharp } = await import("sharp");
  const W = 1080, H = 1350;
  return [
    await render(sharp, photo, photoSvg(item, W, H, { bottom: "Desliza →  preços em todas as lojas" }), W, H, path.join(dir, `${name}-1.jpg`)),
    await render(sharp, null, compareSvg(item, W, H), W, H, path.join(dir, `${name}-2.jpg`)),
    await render(sharp, null, ctaSvg(item, W, H, handle, site), W, H, path.join(dir, `${name}-3.jpg`)),
  ];
}

// Reel 1080x1920 (~9 s): foto com zoom lento → comparação → chamada final; devolve [vídeo, capa]
export async function buildReel(item, photo, dir, name, handle, site) {
  const { default: sharp } = await import("sharp");
  const W = 1080, H = 1920;
  const tmp = fs.mkdtempSync(path.join(dir, ".reel-"));
  const f1 = await render(sharp, photo, photoSvg(item, W, H, { bottom: "Receita completa → link na bio" }), W, H, path.join(tmp, "1.jpg"));
  const f2 = await render(sharp, null, compareSvg(item, W, H), W, H, path.join(tmp, "2.jpg"));
  const f3 = await render(sharp, null, ctaSvg(item, W, H, handle, site), W, H, path.join(tmp, "3.jpg"));
  const cover = path.join(dir, `${name}-capa.jpg`), video = path.join(dir, `${name}.mp4`);
  fs.copyFileSync(f1, cover);
  const fps = 30, d1 = 3.5, d2 = 3, d3 = 3, x = 0.4;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error",
    "-i", f1, "-loop", "1", "-t", String(d2), "-i", f2, "-loop", "1", "-t", String(d3), "-i", f3,
    "-f", "lavfi", "-t", String(d1 + d2 + d3), "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex",
    `[0:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.06*on/${d1 * fps}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d1 * fps}:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p[a];` +
    `[1:v]fps=${fps},setsar=1,format=yuv420p[b];[2:v]fps=${fps},setsar=1,format=yuv420p[c];` +
    `[a][b]xfade=transition=fade:duration=${x}:offset=${d1 - x}[ab];[ab][c]xfade=transition=fade:duration=${x}:offset=${d1 + d2 - 2 * x}[v]`,
    "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(fps), "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", video]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return [video, cover];
}
