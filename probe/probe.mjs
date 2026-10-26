// Sondagem das fontes oficiais (só leitura). Guarda o HTML das páginas e um relatório do que encontrou.
import fs from "node:fs";
const OUT = "probe/out"; fs.mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "pt-PT,pt;q=0.9" };
const SEEDS = {
  Continente: ["https://www.continente.pt/folhetos/", "https://www.continente.pt/promocoes/", "https://www.continente.pt/"],
  "Pingo Doce": ["https://www.pingodoce.pt/folhetos/", "https://www.pingodoce.pt/"],
  Lidl: ["https://www.lidl.pt/", "https://www.lidl.pt/c/folhetos/s10020672"],
  Aldi: ["https://www.aldi.pt/", "https://www.aldi.pt/folhetos.html"],
  "Intermarché": ["https://www.intermarche.pt/folhetos/", "https://www.intermarche.pt/", "https://loja.intermarche.pt/"]
};
const KEYS = /folheto|flyer|leaflet|promoc|oportunidad|campanha|catalog/i;
const SIGNS = { pdf: /https?:[^"'\s<>]+\.pdf/gi, publitas: /publitas/gi, issuu: /issuu/gi, leaflets: /leaflets?\.[a-z.]+|flyer_identifier|endpoints\.leaflets/gi, nextdata: /__NEXT_DATA__/g, ldjson: /application\/ld\+json/g, demandware: /demandware|dw\/image|Sites-[A-Za-z-]+-Site/g, tileJson: /data-product-tile-impression|data-gtm|data-product/gi, price: /\d+,\d{2}\s*€|€\s*\d+,\d{2}/g, api: /https?:\/\/[^"'\s<>]*(api|graphql|json)[^"'\s<>]*/gi, images: /https?:\/\/[^"'\s<>]+\.(jpe?g|webp|png)/gi };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = new Set(); let report = "# Sondagem das fontes oficiais\n\n";
async function get(url) {
  try { const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25000) }); const t = await r.text(); return { ok: r.ok, status: r.status, final: r.url, type: r.headers.get("content-type"), text: t }; }
  catch (e) { return { ok: false, status: "ERRO " + e.message, text: "" }; }
}
for (const [shop, seeds] of Object.entries(SEEDS)) {
  report += `\n## ${shop}\n`;
  const queue = [...seeds]; let n = 0;
  while (queue.length && n < 7) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url); n++;
    await sleep(1500);
    const r = await get(url);
    const file = OUT + "/" + shop.replace(/\W+/g, "_") + "_" + n + ".html";
    fs.writeFileSync(file, `<!-- ${url} -> ${r.final} ${r.status} -->\n` + r.text);
    report += `\n### ${url}\n- estado: ${r.status} · final: ${r.final} · tipo: ${r.type} · tamanho: ${r.text.length}\n- ficheiro: ${file}\n`;
    for (const [k, re] of Object.entries(SIGNS)) { const m = [...new Set(r.text.match(re) || [])]; if (m.length) report += `- ${k}: ${m.length} → ${m.slice(0, 6).join(" | ").slice(0, 600)}\n`; }
    const host = (() => { try { return new URL(r.final || url).host.replace(/^www\./, "").split(".").slice(-2).join("."); } catch { return ""; } })();
    const links = [...new Set([...r.text.matchAll(/href="([^"#]+)"/g)].map((x) => { try { return new URL(x[1], r.final || url).href; } catch { return null; } }).filter(Boolean))];
    const rel = links.filter((l) => KEYS.test(l) && l.includes(host));
    report += `- ligações relevantes (${rel.length}): ${rel.slice(0, 15).join(" | ")}\n`;
    for (const l of rel.slice(0, 4)) if (!seen.has(l)) queue.push(l);
  }
}
fs.writeFileSync("probe/out/REPORT.md", report);
console.log(report);
