# Menu do Dia

3 refeições por supermercado a partir de **preços reais de folheto** (Continente, Pingo Doce, Lidl, Aldi, Intermarché).

## Princípio
Nenhum preço é gerado por IA. Todos vêm de `api/flyer-data.ts`, com validade e links de fonte por supermercado.
Os custos das receitas são calculados em código (preço × quantidade). Ingredientes sem preço de folheto aparecem como "despensa" e não entram nos totais.

## Correr localmente
```bash
npm install
npm run dev
```
Não precisa de base de dados nem de chaves de API.

## Atualização automática (GitHub Actions)
O workflow `.github/workflows/update.yml` corre **todos os dias às 05:00 de Lisboa**:
procura folheto novo; se houver, atualiza preços; em qualquer caso gera receitas novas só com produtos
em promoção e uma foto gerada por IA por receita (Cloudflare Workers AI ou OpenAI).

### Secrets necessários (Settings → Secrets and variables → Actions)
| Secret | Obrigatório | Descrição |
|---|---|---|
| `OPENAI_API_KEY` | um dos dois | Ler folhetos + gerar receitas |
| `MISTRAL_API_KEY` | um dos dois | Alternativa ao OpenAI |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | opcional | Gerar fotos grátis no Workers AI (quota diária) |

### Variables opcionais (Settings → Secrets and variables → Actions → Variables)
| Variable | Omissão | Descrição |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo de texto OpenAI |
| `MISTRAL_MODEL` | `mistral-small-latest` | Modelo de texto Mistral |
| `CLOUDFLARE_IMAGE_MODEL` | `@cf/black-forest-labs/flux-1-schnell` | Modelo de imagem Cloudflare |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1-mini` | Modelo de imagem OpenAI |
| `OPENAI_IMAGE_QUALITY` | `low` | Qualidade da imagem OpenAI (`low`/`medium`/`high`) |
| `AI_DELAY_MS` | 300/1100 | Delay entre chamadas à API |

Também podes correr o workflow à mão (*Actions → Atualizar menu → Run workflow*), com opções para refazer fotos.

## Deploy
A app é um servidor Node único (Hono + Vite build). Em produção:
```bash
npm install
npm run build
npm start          # serve estático + API na porta PORT (omissão: 3000)
```
Ex.: Railway, Render, Fly.io, ou qualquer VPS com Node 20+.

## Estrutura
```
api/
  flyer-data.ts     ← dados de origem (folhetos, preços, receitas)
  data/menu.json    ← menu atual (gerado automaticamente)
  queries/          ← lógica (custo, validade, estado do folheto)
scripts/update.mjs  ← atualização automática (Actions)
public/meals/       ← fotos das receitas
src/pages/Home.tsx  ← interface (tabs, receitas, lista de compras)
```
