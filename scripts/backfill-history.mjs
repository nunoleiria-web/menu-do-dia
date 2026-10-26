// Recupera o histórico de preços a partir das versões antigas de api/data/menu.json no git.
// Correr uma vez, com o histórico completo: git fetch --unshallow && node scripts/backfill-history.mjs
import { execFileSync } from "node:child_process";
import { recordPrices } from "./history.mjs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const commits = git("log", "--reverse", "--format=%H %cI", "--", "api/data/menu.json").trim().split("\n").filter(Boolean);
let added = 0, changed = 0;
for (const line of commits) {
  const [sha, when] = line.split(" ");
  let data;
  try { data = JSON.parse(git("show", sha + ":api/data/menu.json")); } catch { continue; }
  const day = new Date(when).toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
  const r = recordPrices(data.markets ?? [], day);
  added += r.added; changed += r.changed;
}
console.log(commits.length, "versões lidas:", added, "produtos,", changed, "preços corrigidos");
