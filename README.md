# Radar de Conceitos

Site estatico para monitorar um termo (software, empresa, pessoa, conceito) e mostrar:

- ultimas noticias (`GDELT`)
- contexto enciclopedico (`Wikipedia`)
- discussao tecnica (`Hacker News`)
- perfis publicos relacionados (`GitHub` e `Bluesky`)

## Como usar

1. Abra o site.
2. Digite um termo na busca (ex.: `OpenAI`, `Kubernetes`, `Figma`).
3. Clique em `Escanear`.
4. Veja os blocos de noticias, Wikipedia, discussao tecnica e perfis publicos.

## Rodar local

```bash
npm install
npm start
```

Depois abra `http://localhost:3000`.

## Deploy no GitHub Pages

Este repo ja inclui workflow para publicar a pasta `public/`.

1. Faça push para `main`.
2. Abra `Settings > Pages` e deixe `Source: GitHub Actions`.
3. Aguarde o job terminar em `Actions`.
4. Use a URL gerada no ambiente `github-pages`.

## Observacoes

- O projeto usa apenas APIs publicas acessadas no navegador.
- Alguns provedores podem limitar requisoes por minuto (especialmente o GitHub sem token).
