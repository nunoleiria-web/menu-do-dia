/**
 * Dados lidos de api/data/menu.json, atualizado de 2 em 2 dias por scripts/update.mjs
 * (GitHub Actions). Os preços vêm sempre de folhetos; os custos são calculados em código.
 */
import menu from "./data/menu.json";
export type Ing = {
  item: string;
  qty: string;
  /** preço de folheto em €; omitido = despensa */
  price?: number;
  per?: "kg" | "un";
  /** quantidade usada: kg se per="kg", unidades se per="un" */
  amount?: number;
  /** texto de preço a mostrar quando não é simples €/kg (ex.: saco de 5 kg) */
  label?: string;
  note?: string;
};
export type Promo = { id: string; name: string; price: number; per: "kg" | "un"; label?: string; note?: string };
export type Recipe = {
  slot: 1 | 2;
  name: string;
  description: string;
  servings: string;
  time: string;
  ingredients: Ing[];
  steps: string[];
  /** caminho da imagem gerada para esta receita */
  /** palavras-chave em inglês para procurar a foto */
  imageQuery?: string;
  image?: string;
  imageCredit?: { name: string; url: string };
};
export type Market = {
  name: string;
  from: string; // AAAA-MM-DD
  to: string;
  flyer: string;
  sources: { title: string; url: string }[];
  /** todos os produtos com preço extraídos do folheto (base das receitas) */
  promos: Promo[];
  recipes: Recipe[];
  /** o que a última verificação encontrou (mostrado na app) */
  check?: { date: string; result: "novo" | "sem-novo" | "sem-folheto" };
  /** nomes das últimas receitas, para não repetir */
  history: string[];
};

export const MARKETS = menu.markets as unknown as Market[];
