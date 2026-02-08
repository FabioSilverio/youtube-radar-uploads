# Radar de Uploads YouTube

App web com 4 secoes:

- `FEED`: junta os ultimos videos por categoria (`News`, `Entretenimento`, `Entrevistas`).
- `CANAIS`: area para adicionar/remover canais e definir categoria de cada canal.
- `ASSISTIR DEPOIS`: guarda os videos que voce salvou.
- `JA VISTOS`: recebe os videos marcados como assistidos (saem do FEED).

Tambem permite:

- adicionar canais por URL (`/@canal`, `/channel/UC...`, `/user/...`, `/c/...`),
- marcar video como `Ja assisti`,
- salvar/remover videos em `Assistir Depois`,
- sincronizacao por codigo/link entre dispositivos,
- sincronizacao automatica em nuvem via GitHub Gist.

## Como usar

1. Abra o site.
2. Cole sua **YouTube API key** e clique em `Salvar chave`.
3. Adicione URLs dos canais que quer acompanhar.
4. Escolha a categoria do canal ao cadastrar (ou edite depois na aba `CANAIS`).
5. Use `Atualizar feed` para buscar uploads recentes.
5. Para nuvem automatica, informe um token GitHub com escopo `gist` e clique em `Conectar nuvem`.

## Sync na nuvem (GitHub Gist)

1. Gere um token GitHub (classic) com permissao `gist`.
2. No app, cole o token em `Sync na nuvem`.
3. Clique em `Conectar nuvem`.
4. O app passa a sincronizar automaticamente seus canais, videos salvos e `JA VISTOS`.

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
