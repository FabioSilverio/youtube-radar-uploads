const dom = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#query-input"),
  status: document.querySelector("#status"),
  newsList: document.querySelector("#news-list"),
  wikiSummary: document.querySelector("#wiki-summary"),
  wikiRelated: document.querySelector("#wiki-related"),
  hnList: document.querySelector("#hn-list"),
  profilesList: document.querySelector("#profiles-list"),
  quickChips: document.querySelectorAll(".quick-chip"),
  searchBtn: document.querySelector("#search-btn")
};

let activeController = null;

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const term = dom.input.value.trim();
  runScan(term);
});

dom.quickChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const term = chip.dataset.term || "";
    dom.input.value = term;
    runScan(term);
  });
});

async function runScan(term) {
  if (!term || term.length < 2) {
    setStatus("Use pelo menos 2 caracteres.");
    return;
  }

  if (activeController) {
    activeController.abort();
  }

  activeController = new AbortController();
  setLoadingState(true);
  clearAllResults();
  setStatus(`Escaneando: "${term}"...`);

  const signal = activeController.signal;
  const tasks = [
    fetchLatestNews(term, signal),
    fetchWikipediaContext(term, signal),
    fetchHackerNews(term, signal),
    fetchGitHubProfiles(term, signal),
    fetchBlueskyProfiles(term, signal)
  ];

  const [newsResult, wikiResult, hnResult, githubResult, blueskyResult] = await Promise.allSettled(tasks);

  if (signal.aborted) {
    return;
  }

  const news = readSettled(newsResult);
  const wiki = readSettled(wikiResult, { summary: null, related: [] });
  const hn = readSettled(hnResult);
  const githubProfiles = readSettled(githubResult);
  const blueskyProfiles = readSettled(blueskyResult);

  renderNews(news);
  renderWiki(wiki);
  renderHackerNews(hn);
  renderProfiles([...githubProfiles, ...blueskyProfiles]);

  const total = news.length + wiki.related.length + hn.length + githubProfiles.length + blueskyProfiles.length;
  const when = new Date().toLocaleString("pt-BR");

  if (total === 0) {
    setStatus(`Nenhum resultado para "${term}". Tente outro termo.`);
  } else {
    setStatus(`Radar atualizado para "${term}" em ${when}. Itens encontrados: ${total}.`);
  }

  setLoadingState(false);
}

function setLoadingState(isLoading) {
  dom.searchBtn.disabled = isLoading;
  dom.searchBtn.textContent = isLoading ? "Buscando..." : "Escanear";
}

function setStatus(message) {
  dom.status.textContent = message;
}

function clearAllResults() {
  dom.newsList.innerHTML = "";
  dom.wikiRelated.innerHTML = "";
  dom.hnList.innerHTML = "";
  dom.profilesList.innerHTML = "";
  dom.wikiSummary.classList.add("empty-box");
  dom.wikiSummary.textContent = "Carregando...";
}

async function fetchLatestNews(term, signal) {
  const params = new URLSearchParams({
    query: `"${term}"`,
    mode: "ArtList",
    sort: "DateDesc",
    maxrecords: "8",
    format: "json"
  });

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const list = Array.isArray(data.articles) ? data.articles : [];

  return list.map((item) => ({
    title: item.title || "Sem titulo",
    url: item.url,
    source: item.domain || item.sourcecommonname || "fonte nao informada",
    date: parseGdeltDate(item.seendate)
  }));
}

async function fetchWikipediaContext(term, signal) {
  let context = await searchWikipedia(term, "pt", signal);

  if (context.related.length === 0) {
    context = await searchWikipedia(term, "en", signal);
  }

  return context;
}

async function searchWikipedia(term, lang, signal) {
  const params = new URLSearchParams({
    action: "opensearch",
    search: term,
    limit: "6",
    namespace: "0",
    format: "json",
    origin: "*"
  });

  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
  const response = await fetchJson(searchUrl, signal);

  const titles = Array.isArray(response[1]) ? response[1] : [];
  const descriptions = Array.isArray(response[2]) ? response[2] : [];
  const links = Array.isArray(response[3]) ? response[3] : [];

  const related = titles.map((title, index) => ({
    title,
    description: descriptions[index] || "Sem descricao.",
    url: links[index] || ""
  }));

  let summary = null;
  if (titles.length > 0) {
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`;

    try {
      const summaryData = await fetchJson(summaryUrl, signal);
      summary = {
        title: summaryData.title || titles[0],
        extract: summaryData.extract || "Sem resumo disponivel.",
        url: summaryData.content_urls?.desktop?.page || links[0] || ""
      };
    } catch {
      summary = {
        title: titles[0],
        extract: "Resumo indisponivel no momento.",
        url: links[0] || ""
      };
    }
  }

  return { summary, related };
}

async function fetchHackerNews(term, signal) {
  const params = new URLSearchParams({
    query: term,
    tags: "story",
    hitsPerPage: "8"
  });

  const url = `https://hn.algolia.com/api/v1/search?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const hits = Array.isArray(data.hits) ? data.hits : [];

  return hits.map((hit) => ({
    title: hit.title || hit.story_title || "Sem titulo",
    url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author || "autor desconhecido",
    points: Number.isFinite(hit.points) ? hit.points : 0,
    date: hit.created_at ? new Date(hit.created_at) : null
  }));
}

async function fetchGitHubProfiles(term, signal) {
  const params = new URLSearchParams({
    q: `${term} in:login in:name`,
    per_page: "6"
  });

  const url = `https://api.github.com/search/users?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const users = Array.isArray(data.items) ? data.items : [];

  return users.map((user) => ({
    platform: "GitHub",
    name: user.login,
    url: user.html_url,
    avatar: user.avatar_url,
    note: `Score ${Number(user.score || 0).toFixed(1)}`
  }));
}

async function fetchBlueskyProfiles(term, signal) {
  const params = new URLSearchParams({
    q: term,
    limit: "6"
  });

  const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const actors = Array.isArray(data.actors) ? data.actors : [];

  return actors.map((actor) => ({
    platform: "Bluesky",
    name: actor.displayName || actor.handle,
    url: `https://bsky.app/profile/${encodeURIComponent(actor.handle)}`,
    avatar: actor.avatar || "",
    note: actor.description ? actor.description.slice(0, 110) : actor.handle
  }));
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Falha ${response.status} em ${url}`);
  }

  return response.json();
}

function renderNews(news) {
  if (news.length === 0) {
    dom.newsList.appendChild(buildEmpty("Nenhuma noticia encontrada."));
    return;
  }

  news.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    title.appendChild(link);

    const meta = document.createElement("p");
    meta.className = "meta";
    const dateText = item.date ? item.date.toLocaleString("pt-BR") : "data nao informada";
    meta.textContent = `${item.source} | ${dateText}`;

    card.append(title, meta);
    dom.newsList.appendChild(card);
  });
}

function renderWiki(context) {
  dom.wikiSummary.innerHTML = "";

  if (!context.summary) {
    dom.wikiSummary.classList.add("empty-box");
    dom.wikiSummary.textContent = "Sem contexto enciclopedico para este termo.";
  } else {
    dom.wikiSummary.classList.remove("empty-box");

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = context.summary.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = context.summary.title;
    title.appendChild(link);

    const extract = document.createElement("p");
    extract.textContent = context.summary.extract;

    dom.wikiSummary.append(title, extract);
  }

  if (context.related.length === 0) {
    dom.wikiRelated.appendChild(buildEmpty("Sem paginas relacionadas na Wikipedia."));
    return;
  }

  context.related.slice(0, 5).forEach((entry) => {
    const box = document.createElement("article");
    box.className = "mini-item";

    const link = document.createElement("a");
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = entry.title;

    const description = document.createElement("p");
    description.textContent = entry.description;

    box.append(link, description);
    dom.wikiRelated.appendChild(box);
  });
}

function renderHackerNews(items) {
  if (items.length === 0) {
    dom.hnList.appendChild(buildEmpty("Sem discussoes recentes no Hacker News."));
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    title.appendChild(link);

    const meta = document.createElement("p");
    meta.className = "meta";
    const dateText = item.date ? item.date.toLocaleString("pt-BR") : "data nao informada";
    meta.textContent = `por ${item.author} | ${item.points} pontos | ${dateText}`;

    card.append(title, meta);
    dom.hnList.appendChild(card);
  });
}

function renderProfiles(profiles) {
  if (profiles.length === 0) {
    dom.profilesList.appendChild(buildEmpty("Nenhum perfil publico encontrado."));
    return;
  }

  profiles.slice(0, 10).forEach((profile) => {
    const card = document.createElement("article");
    card.className = "profile-card";

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = profile.avatar || "./favicon.svg";
    avatar.alt = `${profile.name} avatar`;
    avatar.loading = "lazy";

    const body = document.createElement("div");
    body.className = "profile-body";

    const name = document.createElement("a");
    name.href = profile.url;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.textContent = profile.name;

    const platform = document.createElement("p");
    platform.className = "platform";
    platform.textContent = profile.platform;

    const note = document.createElement("p");
    note.className = "profile-note";
    note.textContent = profile.note;

    body.append(name, platform, note);
    card.append(avatar, body);
    dom.profilesList.appendChild(card);
  });
}

function buildEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "meta";
  empty.textContent = message;
  return empty;
}

function parseGdeltDate(raw) {
  if (!raw || typeof raw !== "string" || raw.length < 14) {
    return null;
  }

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));

  const result = new Date(Date.UTC(year, month, day, hour, minute, second));
  return Number.isNaN(result.getTime()) ? null : result;
}

function readSettled(result, fallback = []) {
  return result.status === "fulfilled" ? result.value : fallback;
}
