// Histórico de preços: guarda cada produto de cada folheto uma vez (por loja + início do folheto + produto),
// em api/data/precos/AAAA.json. Nunca apaga: é a base para o índice de preços e para prever promoções.
//
// Formato de cada linha (curto, porque o ficheiro cresce todas as semanas):
//   { "m": loja, "f": início do folheto, "t": fim, "id": produto (slug), "n": nome, "p": preço, "u": "kg"|"un",
//     "l": etiqueta (opcional), "s": dia em que foi visto pela primeira vez, "v": dia da última leitura }
import fs from "node:fs";
import path from "node:path";

export const DIR = "api/data/precos";
const fileFor = (from) => path.join(DIR, String(from).slice(0, 4) + ".json");

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
}

// Junta ao histórico os produtos das lojas em `markets` (o formato de menu.json).
// Se um produto já existe para aquele folheto, atualiza o preço (as releituras confirmadas corrigem erros).
// Devolve quantos produtos novos e quantos preços corrigidos houve.
export function recordPrices(markets, day) {
  const files = new Map(); // ficheiro -> { rows, index }
  const open = (from) => {
    const file = fileFor(from);
    if (!files.has(file)) {
      const rows = load(file);
      files.set(file, { rows, index: new Map(rows.map((r, i) => [r.m + "|" + r.f + "|" + r.id, i])) });
    }
    return files.get(file);
  };
  let added = 0, changed = 0;
  for (const mk of markets) {
    if (!mk.from || !mk.promos?.length) continue;
    const box = open(mk.from);
    for (const p of mk.promos) {
      if (!p.id || !(p.price > 0)) continue;
      const key = mk.name + "|" + mk.from + "|" + p.id;
      const row = { m: mk.name, f: mk.from, t: mk.to, id: p.id, n: p.name, p: p.price, u: p.per, ...(p.label ? { l: p.label } : {}) };
      const i = box.index.get(key);
      if (i == null) {
        box.index.set(key, box.rows.length);
        box.rows.push({ ...row, s: day, v: day });
        added++;
      } else {
        const old = box.rows[i];
        if (old.p !== row.p || old.t !== row.t || old.n !== row.n) changed++;
        box.rows[i] = { ...old, ...row, v: day };
      }
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  for (const [file, { rows }] of files) {
    rows.sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0) || a.m.localeCompare(b.m) || a.id.localeCompare(b.id));
    // Uma linha por produto: fácil de ler no GitHub e diffs pequenos
    fs.writeFileSync(file, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
  }
  return { added, changed };
}
