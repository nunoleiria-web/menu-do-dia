import fs from "node:fs";
import path from "node:path";

const MENU_PATH = path.resolve(process.cwd(), "api/data/menu.json");

let cachedData: any = null;
let lastMtime = 0;

export function getMenuData() {
  try {
    const stat = fs.statSync(MENU_PATH);
    if (!cachedData || stat.mtimeMs !== lastMtime) {
      const raw = fs.readFileSync(MENU_PATH, "utf8");
      cachedData = JSON.parse(raw);
      lastMtime = stat.mtimeMs;
    }
    return cachedData;
  } catch (err) {
    console.error("Erro ao ler api/data/menu.json:", err);
    return cachedData ?? { updatedAt: "", markets: [] };
  }
}
