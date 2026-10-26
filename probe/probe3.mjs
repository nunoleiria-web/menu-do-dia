// Sondagem 3: folhetos oficiais (iPaper do Continente e do Pingo Doce, PDF do Lidl) e regras robots dos subdomínios
import fs from "node:fs";
import { execSync } from "node:child_process";
const OUT = "probe/out3"; fs.mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "pt-PT,pt;q=0.9" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URLS = [
  ["cnt_enrich", fs.readFileSync("probe/cnt_enrich_url.txt", "utf8").trim()],
  ["pd_folheto", "https://folhetos.pingodoce.pt/2026/poupe-esta-semana/continental-lojas-grandes/S43/"],
  ["cnt_folhetos_robots", "https://folhetos.continente.pt/robots.txt"],
  ["pd_folhetos_robots", "https://folhetos.pingodoce.pt/robots.txt"],
  ["schwarz_robots", "https://endpoints.leaflets.schwarz/robots.txt"],
  ["aldi_folheto", "https://www.aldi.pt/folheto/esta-semana.html"]
];
let rep = "# Sondagem 3\n";
async function get(name, url, bin) {
  await sleep(1500);
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) });
    const buf = Buffer.from(await r.arrayBuffer()); const ct = r.headers.get("content-type") || "";
    const ext = bin ? "pdf" : /json/.test(ct) ? "json" : /plain/.test(ct) ? "txt" : "html";
    fs.writeFileSync(`${OUT}/${name}.${ext}`, buf); rep += `\n- **${name}** ${r.status} ${ct} ${buf.length} bytes · ${url.slice(0, 140)}`; return { r, buf, text: bin ? "" : buf.toString("utf8") };
  } catch (e) { rep += `\n- **${name}** ERRO ${e.message} · ${url.slice(0, 140)}`; return null; }
}
for (const [n, u] of URLS) await get(n, u);
// Pingo Doce: enrichments iPaper do folheto
const pd = fs.existsSync(OUT + "/pd_folheto.html") ? fs.readFileSync(OUT + "/pd_folheto.html", "utf8") : "";
const pe = pd.match(/https:\/\/cdn\.ipaper\.io\/iPaper\/Papers\/[^"']+?Page1-\d+\.json\?token=[^"'\\]+(?:\\u0026[^"'\\]+)*/);
if (pe) await get("pd_enrich", pe[0].replace(/\\u0026/g, "&"));
// Lidl: PDF oficial e texto
const lidl = JSON.parse(await (await fetch("https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=promocoes-semanais-a-partir-de-26-10&region_id=0&region_code=0", { headers: UA })).text());
const pdf = lidl.flyer?.pdfUrl; if (pdf) { await get("lidl_pdf", pdf, true);
  try { execSync(`pdftotext -layout ${OUT}/lidl_pdf.pdf ${OUT}/lidl_pdf.txt`); rep += `\n- lidl_pdf.txt: ${fs.statSync(OUT + "/lidl_pdf.txt").size} bytes de texto`; fs.unlinkSync(OUT + "/lidl_pdf.pdf"); } catch (e) { rep += "\n- pdftotext falhou: " + e.message; } }
fs.writeFileSync(OUT + "/REPORT.md", rep); console.log(rep);
