name: update

on:
  schedule:
    - cron: "15 7,19 * * *"
  workflow_dispatch:
    inputs:
      redo_photos:
        description: "Voltar a gerar todas as fotos (REDO_PHOTOS)"
        required: false
        default: ""
      photos_only:
        description: "Procurar/gerar apenas fotos em falta (PHOTOS_ONLY)"
        required: false
        default: ""

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install dependencies
        run: npm install --no-audit --no-fund

      - name: Run update script
        id: run_update
        continue-on-error: true
        env:
          MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          REDO_PHOTOS: ${{ github.event.inputs.redo_photos }}
          PHOTOS_ONLY: ${{ github.event.inputs.photos_only }}
        run: node scripts/update.mjs

      - name: Commit and Push changes
        run: |
          git config user.name "menu-bot"
          git config user.email "menu-bot@users.noreply.github.com"
          git add api/data/menu.json public/meals/
          if ! git diff --cached --quiet; then
            git commit -m "chore: atualiza menu e fotos das receitas"
            git pull --rebase origin main
            git push origin main
          else
            echo "Sem alterações para guardar."
          fi

      - name: Check script status
        if: steps.run_update.outcome == 'failure'
        run: exit 1
