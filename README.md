# Radar de Uploads YouTube

App web com 2 secoes:

- `FEED`: junta os ultimos videos dos canais que voce acompanha.
- `ASSISTIR DEPOIS`: guarda os videos que voce salvou.

Tambem permite:

- adicionar canais por URL (`/@canal`, `/channel/UC...`, `/user/...`, `/c/...`),
- marcar video como `Ja assisti`,
- salvar/remover videos em `Assistir Depois`.

## Como usar

1. Abra o site.
2. Cole sua **YouTube API key** e clique em `Salvar chave`.
3. Adicione URLs dos canais que quer acompanhar.
4. Use `Atualizar feed` para buscar uploads recentes.

## API Key (YouTube Data API v3)

1. Crie um projeto no Google Cloud.
2. Ative `YouTube Data API v3`.
3. Crie uma API key.
4. (Opcional) Restrinja por dominio quando estiver no GitHub Pages.

## Rodar local

Opcao simples:

```bash
npm install
npm start
```

Depois abra `http://localhost:3000`.

## Deploy no GitHub Pages

Este repo ja inclui o workflow `.github/workflows/deploy-pages.yml`.

Quando fizer push para `main`, o GitHub Actions publica automaticamente a pasta `public/` no Pages.

Depois do primeiro push:

1. Abra `Settings > Pages` no repo.
2. Em `Build and deployment`, deixe `Source: GitHub Actions`.
3. Aguarde o workflow terminar e use a URL gerada pelo Pages.