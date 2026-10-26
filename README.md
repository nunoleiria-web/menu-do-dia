# Menu do Dia

Almoço e jantar ao **preço real do folheto** de cada supermercado (Continente, Pingo Doce, Lidl, Aldi, Intermarché):
receitas de cozinhas do mundo, comparador entre lojas, plano da semana e lista de compras.

🌐 Site: **https://nunoleiria-web.github.io/menu-do-dia/** (funciona também como app no telemóvel — PWA)
📸 Instagram: publicações automáticas das receitas do dia, das 10h às 19h

## De onde vêm os preços
| Loja | Fonte | Como |
|---|---|---|
| Continente | Folheto oficial em folhetos.continente.pt | Produtos e preços em texto (iPaper); a IA só indica se o preço é ao kg ou por unidade |
| Pingo Doce | Folheto oficial em folhetos.pingodoce.pt | Produtos, pesos e preços em texto (iPaper) |
| Aldi | aldi.pt — Oportunidades da semana | Produtos, preços, €/kg e datas em texto |
| Lidl | Folheto oficial (leaflets.schwarz) | Imagens das páginas de alimentação, lidas pela IA (só quando o folheto muda) |
| Intermarché | Blog 200 | O site oficial bloqueia leituras automáticas |

Se o site oficial de uma loja falhar, a atualização usa o Blog 200 nesse dia. Só se leem páginas que o robots.txt de cada site permite
(as listagens das lojas online do Continente e do Pingo Doce não são usadas). Código em `scripts/official.mjs`.

## Princípio
Nenhum preço é inventado. Os preços vêm dos folhetos (lidos por IA e confirmados numa segunda leitura);
os custos das receitas são calculados em código (preço × quantidade). O custo por pessoa inclui uma
estimativa dos ingredientes de despensa e está sempre indicado como aproximado.

## Como funciona
| Quando | Workflow | O que faz |
|---|---|---|
| Todos os dias às 05:00 | `update.yml` → `scripts/update.mjs` | Procura folhetos novos, lê preços, escolhe receitas da biblioteca, gera fotos com IA |
| A seguir a cada atualização | `pages.yml` | Publica o site estático no GitHub Pages |
| De 30 em 30 min, 10h–19h | `publish.yml` → `scripts/publish.mjs` | Publica a próxima receita no Instagram, alternando **carrossel** (foto → onde é mais barato → chamada para o site) e **Reel** (vídeo de ~9 s) |
| ~07:30 e ~20:00 | `monitor.yml` → `scripts/monitor.mjs` | Vigia o site, o menu, as fotos, o Instagram e os outros workflows; se algo falhar fica a vermelho e o GitHub envia email |

## Estrutura
```
index.html            ← o site (HTML + JS, sem build)
public/               ← ícones, manifest, service worker e fotos das receitas (meals/)
api/data/menu.json    ← menu atual (gerado automaticamente)
api/data/published.json ← estado das publicações do dia (gerado automaticamente)
ramo media             ← ficheiros da publicação atual (substituído a cada publicação, não acumula)
scripts/
  update.mjs          ← atualização diária (folhetos, receitas, fotos)
  menu.mjs            ← lógica pura: escolha de receitas, custos, plano, comparador
  publish.mjs         ← publicação no Instagram/Facebook
  media.mjs           ← imagens do carrossel e vídeo do Reel
  recipes.json        ← biblioteca de receitas
  prices.json         ← preços médios para estimar ingredientes de despensa
  monitor.mjs         ← verificação do site e das publicações
  dev.mjs             ← ver o site localmente
```

## Correr localmente
```bash
npm run dev              # site em http://localhost:3000
npm run publish:ensaio   # mostra a próxima publicação, sem publicar
```

## Segredos e variáveis (Settings → Secrets and variables → Actions)
| Nome | Tipo | Para quê |
|---|---|---|
| `OPENAI_API_KEY` ou `MISTRAL_API_KEY` | segredo | Ler folhetos (obrigatório um dos dois) |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | segredo | Fotos grátis no Workers AI (opcional) |
| `IG_TOKEN` | segredo | Publicar no Instagram (API com login do Instagram, sem Página de Facebook) |
| `FB_PAGE_ID` + `FB_PAGE_TOKEN` | segredo | Publicar também na Página de Facebook (opcional) |
| `SITE_URL` | variável | Link nas legendas (omissão: o GitHub Pages) |
| `IG_FORMAT` | variável | `alternar` (omissão), `carrossel`, `reel` ou `foto` |
| `OPENAI_MODEL`, `MISTRAL_MODEL`, `CLOUDFLARE_IMAGE_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `AI_DELAY_MS` | variáveis | Afinação dos modelos (opcional) |

### Token do Instagram
Gera-se em developers.facebook.com → app → Instagram → *API setup with Instagram login* → *Generate token*.
**Dura 60 dias.** A partir do dia 50, a execução "Publicar receitas do dia" fica a vermelho uma vez por dia
(o GitHub envia email): gera um token novo e substitui o segredo `IG_TOKEN`.

## Manutenção
- Correr a atualização à mão: *Actions → Atualizar menu → Run workflow* (com opções para refazer fotos ou reler folhetos).
- Testar uma publicação: *Actions → Publicar receitas do dia → Run workflow*.
- Ver como fica sem publicar: o mesmo, com a opção **preview** marcada (os ficheiros ficam no ramo `media`).
- Se um Reel falhar, a publicação sai em carrossel; se o carrossel falhar, sai como foto.
- Ver o estado de tudo: *Actions → Vigiar o site → Run workflow* e abrir o resumo da execução.
- Ver o que foi publicado hoje: `api/data/published.json`.
