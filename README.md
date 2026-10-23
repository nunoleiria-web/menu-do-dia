# Menu do Dia

3 refeições por supermercado a partir de **preços reais de folheto** (Continente, Pingo Doce, Lidl, Aldi, Intermarché).

## Princípio
Nenhum preço é gerado por IA. Todos vêm de `api/flyer-data.ts`, com validade e links de fonte por supermercado.
Os custos das receitas são calculados em código (preço × quantidade). Ingredientes sem preço de folheto aparecem como "despensa" e não entram nos totais.

## Atualizar semanalmente
Em `api/flyer-data.ts`: atualizar `from`/`to`, `flyer`, `sources`, preços e receitas de cada supermercado.
A app mostra "válido até / a partir de / expirado" consoante a data de hoje (Europe/Lisbon).

## Correr
```
npm install
npm run dev
```
Não precisa de base de dados nem de chaves de API.

## Atualização automática (de 2 em 2 dias)
GitHub Actions corre `scripts/update.mjs`: procura folheto novo; se houver, atualiza preços; em qualquer caso gera receitas novas só com produtos em promoção e uma foto real por receita (Pexels; escolhida pela descrição da foto, sem IA; sem correspondência, não mostra foto).
Secrets necessários (Settings → Secrets → Actions): `GEMINI_API_KEY` e `PEXELS_API_KEY`. Opcional: variável `GEMINI_MODEL` (por omissão `gemini-3.8-flash`).
