// Sondagem 2: listas de produtos e folhetos oficiais (só leitura)
import fs from "node:fs";
const OUT = "probe/out2"; fs.mkdirSync(OUT, { recursive: true });
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "pt-PT,pt;q=0.9", "accept": "text/html,application/json;q=0.9,*/*;q=0.8" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PD = "https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-UpdateGrid?cgid=ec_poupeestasemana_1100000_100&pmin=0.04&srule=PD_Relevance";
const CNT = "https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid";
const URLS = [
  ["pd_0", PD + "&start=0&sz=48"], ["pd_48", PD + "&start=48&sz=48"], ["pd_288", PD + "&start=288&sz=48"],
  ["cnt_grid_zu", CNT + "?cgid=zu-promocoes&pmin=0.01&start=0&sz=36"],
  ["cnt_promos_ajax", "https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-ShowAjax?cgid=zu-promocoes&start=0&sz=36"],
  ["cnt_folheto", "https://folhetos.continente.pt/2026/10/semanal-43-gt80/"],
  ["lidl_v4", "https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=promocoes-semanais-a-partir-de-26-10&region_id=0&region_code=0"],
  ["lidl_v3", "https://endpoints.leaflets.schwarz/v3/flyer?flyer_identifier=promocoes-semanais-a-partir-de-26-10&region_id=0&region_code=0"],
  ["lidl_js", "https://lidl.leaflets.schwarz/assets/index-db1e7dc5.js"],
  ["aldi_oport", "https://www.aldi.pt/oportunidades-da-semana.html"],
  ["aldi_oport2", "https://www.aldi.pt/oportunidades-da-semana"],
  ["aldi_folheto", "https://www.aldi.pt/folheto/esta-semana.html"],
  ["inter_robots", "https://www.intermarche.pt/robots.txt"],
  ["cnt_robots", "https://www.continente.pt/robots.txt"], ["pd_robots", "https://www.pingodoce.pt/robots.txt"], ["lidl_robots", "https://www.lidl.pt/robots.txt"], ["aldi_robots", "https://www.aldi.pt/robots.txt"]
];
let rep = "# Sondagem 2\n";
for (const [name, url] of URLS) {
  await sleep(1500);
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const ext = /json/.test(r.headers.get("content-type") || "") ? "json" : /javascript/.test(r.headers.get("content-type") || "") ? "js" : "html";
    const keep = ext === "js" ? [...new Set(t.match(/["'`][^"'`]{0,80}(endpoints\.leaflets|\/v\d\/[a-z-]+|flyer_identifier|region_code)[^"'`]{0,120}["'`]/g) || [])].join("\n") : t;
    fs.writeFileSync(`${OUT}/${name}.${ext === "js" ? "txt" : ext}`, keep);
    rep += `\n- **${name}** ${r.status} ${r.headers.get("content-type")} ${t.length} bytes · ${url}`;
  } catch (e) { rep += `\n- **${name}** ERRO ${e.message} · ${url}`; }
}
fs.writeFileSync(OUT + "/REPORT.md", rep); console.log(rep);
