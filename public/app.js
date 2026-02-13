const DEFAULT_FETCH_TIMEOUT_MS = 9000;

const dom = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#query-input"),
  status: document.querySelector("#status"),
  searchBtn: document.querySelector("#search-btn"),
  quickChips: document.querySelectorAll(".quick-chip"),
  openSearchList: document.querySelector("#open-search-list"),
  openSearchLinks: document.querySelector("#open-search-links"),
  newsList: document.querySelector("#news-list"),
  wikiSummary: document.querySelector("#wiki-summary"),
  wikiRelated: document.querySelector("#wiki-related"),
  discussionList: document.querySelector("#discussion-list"),
  profilesList: document.querySelector("#profiles-list")
};

let activeController = null;
let currentRunId = 0;

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
  const signal = activeController.signal;
  const runId = ++currentRunId;
  const startedAt = Date.now();

  setLoadingState(true);
  clearAllResults();
  setStatus(`Escaneando "${term}"... 0/5 fontes`);

  const tasks = [
    {
      label: "Busca aberta",
      fetcher: fetchOpenSearch,
      renderer: renderOpenSearch
    },
    {
      label: "Noticias",
      fetcher: fetchLatestNews,
      renderer: renderNews
    },
    {
      label: "Wikipedia",
      fetcher: fetchWikipediaContext,
      renderer: renderWiki
    },
    {
      label: "Discussao tecnica",
      fetcher: fetchTechnicalDiscussions,
      renderer: renderDiscussions
    },
    {
      label: "Perfis",
      fetcher: fetchProfiles,
      renderer: renderProfiles
    }
  ];

  let done = 0;
  let failures = 0;
  let totalItems = 0;

  const runs = tasks.map(async (task) => {
    try {
      const data = await task.fetcher(term, signal);
      if (isStaleRun(runId)) {
        return;
      }

      totalItems += task.renderer(data);
    } catch {
      if (isStaleRun(runId)) {
        return;
      }

      failures += 1;
      totalItems += task.renderer(null, true);
    } finally {
      if (isStaleRun(runId)) {
        return;
      }

      done += 1;
      setStatus(`Escaneando "${term}"... ${done}/${tasks.length} fontes`);
    }
  });

  await Promise.allSettled(runs);

  if (isStaleRun(runId)) {
    return;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const when = new Date().toLocaleString("pt-BR");

  if (totalItems === 0) {
    setStatus(`Nenhum resultado para "${term}". Tente um termo mais especifico.`);
  } else {
    const failText = failures > 0 ? ` Fontes com erro: ${failures}.` : "";
    setStatus(`Radar atualizado (${elapsed}s) para "${term}" em ${when}. Itens: ${totalItems}.${failText}`);
  }

  setLoadingState(false);
}

function isStaleRun(runId) {
  return runId !== currentRunId;
}

function setLoadingState(isLoading) {
  dom.searchBtn.disabled = isLoading;
  dom.searchBtn.textContent = isLoading ? "Buscando..." : "Escanear";
}

function setStatus(message) {
  dom.status.textContent = message;
}

function clearAllResults() {
  setContainerLoading(dom.openSearchList, "Carregando resultados de busca...");
  dom.openSearchLinks.innerHTML = "";

  setContainerLoading(dom.newsList, "Carregando noticias...");

  dom.wikiSummary.classList.add("empty-box");
  dom.wikiSummary.textContent = "Carregando contexto enciclopedico...";
  setContainerLoading(dom.wikiRelated, "Carregando paginas relacionadas...");

  setContainerLoading(dom.discussionList, "Carregando discussoes...");
  setContainerLoading(dom.profilesList, "Carregando perfis publicos...");
}

function setContainerLoading(container, message) {
  container.innerHTML = "";
  container.appendChild(buildEmpty(message));
}

async function fetchOpenSearch(term, signal) {
  const params = new URLSearchParams({
    q: term,
    format: "json",
    no_redirect: "1",
    no_html: "1"
  });

  const url = `https://api.duckduckgo.com/?${params.toString()}`;
  const data = await fetchJson(url, signal);

  const results = [];

  if (data.AbstractURL && data.AbstractText) {
    results.push({
      title: data.Heading || "Resultado principal",
      description: data.AbstractText,
      url: data.AbstractURL
    });
  }

  flattenDuckTopics(data.RelatedTopics)
    .filter((topic) => topic.FirstURL && topic.Text)
    .slice(0, 8)
    .forEach((topic) => {
      results.push({
        title: topic.Text.split(" - ")[0] || topic.Text,
        description: topic.Text,
        url: topic.FirstURL
      });
    });

  const deduped = uniqueBy(results, (item) => item.url).slice(0, 8);
  const encoded = encodeURIComponent(term);

  return {
    results: deduped,
    links: [
      { label: "DuckDuckGo", url: `https://duckduckgo.com/?q=${encoded}` },
      { label: "Brave Search", url: `https://search.brave.com/search?q=${encoded}` },
      { label: "Wikipedia", url: `https://pt.wikipedia.org/w/index.php?search=${encoded}` },
      { label: "Reddit", url: `https://www.reddit.com/search/?q=${encoded}&sort=new` }
    ]
  };
}

function flattenDuckTopics(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }

  const items = [];

  topics.forEach((topic) => {
    if (Array.isArray(topic.Topics)) {
      topic.Topics.forEach((nested) => items.push(nested));
      return;
    }

    items.push(topic);
  });

  return items;
}

async function fetchLatestNews(term, signal) {
  const params = new URLSearchParams({
    query: `"${term}"`,
    mode: "ArtList",
    sort: "DateDesc",
    maxrecords: "10",
    format: "json"
  });

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const list = Array.isArray(data.articles) ? data.articles : [];

  return sortByDateDesc(
    list.map((item) => ({
      title: item.title || "Sem titulo",
      url: item.url,
      source: item.domain || item.sourcecommonname || "Fonte nao informada",
      date: parseGdeltDate(item.seendate)
    }))
  ).slice(0, 8);
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

async function fetchTechnicalDiscussions(term, signal) {
  const [hnResult, redditResult] = await Promise.allSettled([
    fetchHackerNewsRecent(term, signal),
    fetchRedditDiscussions(term, signal)
  ]);

  const hnItems = readSettled(hnResult);
  const redditItems = readSettled(redditResult);

  return {
    items: sortByDateDesc([...hnItems, ...redditItems]).slice(0, 12),
    redditBlocked: redditResult.status === "rejected"
  };
}

async function fetchHackerNewsRecent(term, signal) {
  const params = new URLSearchParams({
    query: term,
    tags: "story",
    hitsPerPage: "8"
  });

  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const hits = Array.isArray(data.hits) ? data.hits : [];

  return sortByDateDesc(
    hits.map((hit) => ({
      source: "Hacker News",
      title: hit.title || hit.story_title || "Sem titulo",
      url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author || "autor desconhecido",
      score: Number.isFinite(hit.points) ? hit.points : 0,
      date: hit.created_at ? new Date(hit.created_at) : null
    }))
  );
}

async function fetchRedditDiscussions(term, signal) {
  const params = new URLSearchParams({
    q: term,
    sort: "new",
    limit: "8",
    t: "all",
    raw_json: "1"
  });

  const redditUrl = `https://www.reddit.com/search.json?${params.toString()}`;
  let redditData;

  try {
    redditData = await fetchJson(redditUrl, signal);
  } catch {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(redditUrl)}`;
    const text = await fetchText(proxyUrl, signal, 10000);

    try {
      redditData = JSON.parse(text);
    } catch {
      throw new Error("Reddit indisponivel");
    }
  }

  const children = Array.isArray(redditData?.data?.children) ? redditData.data.children : [];

  if (children.length === 0) {
    return [];
  }

  return sortByDateDesc(
    children.map((entry) => {
      const post = entry.data || {};
      const permalink = post.permalink || "";

      return {
        source: "Reddit",
        title: post.title || "Sem titulo",
        url: permalink ? `https://www.reddit.com${permalink}` : `https://www.reddit.com/search/?q=${encodeURIComponent(term)}&sort=new`,
        author: post.author || "autor desconhecido",
        score: Number.isFinite(post.score) ? post.score : 0,
        subreddit: post.subreddit_name_prefixed || "r/unknown",
        date: Number.isFinite(post.created_utc) ? new Date(post.created_utc * 1000) : null
      };
    })
  );
}

async function fetchProfiles(term, signal) {
  const [githubResult, blueskyResult, wikidataResult] = await Promise.allSettled([
    fetchGitHubProfiles(term, signal),
    fetchBlueskyProfiles(term, signal),
    fetchWikidataSocialProfiles(term, signal)
  ]);

  const merged = [
    ...readSettled(githubResult),
    ...readSettled(blueskyResult),
    ...readSettled(wikidataResult)
  ];

  return sortByDateDesc(uniqueBy(merged, (item) => `${item.platform}|${item.url}`)).slice(0, 12);
}

async function fetchGitHubProfiles(term, signal) {
  const params = new URLSearchParams({
    q: `${term} in:login in:name`,
    per_page: "5"
  });

  const searchUrl = `https://api.github.com/search/users?${params.toString()}`;
  const searchData = await fetchJson(searchUrl, signal);
  const users = Array.isArray(searchData.items) ? searchData.items : [];

  const detailResults = await Promise.allSettled(
    users.map((user) => fetchJson(user.url, signal))
  );

  return sortByDateDesc(
    users.map((user, index) => {
      const detail = detailResults[index].status === "fulfilled" ? detailResults[index].value : null;

      return {
        platform: "GitHub",
        name: detail?.name || user.login,
        url: user.html_url,
        avatar: user.avatar_url,
        date: detail?.created_at ? new Date(detail.created_at) : null,
        note: detail
          ? `${detail.followers || 0} seguidores | ${detail.public_repos || 0} repositorios`
          : `Score ${Number(user.score || 0).toFixed(1)}`
      };
    })
  );
}

async function fetchBlueskyProfiles(term, signal) {
  const params = new URLSearchParams({
    q: term,
    limit: "6"
  });

  const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?${params.toString()}`;
  const data = await fetchJson(url, signal);
  const actors = Array.isArray(data.actors) ? data.actors : [];

  return sortByDateDesc(
    actors.map((actor) => ({
      platform: "Bluesky",
      name: actor.displayName || actor.handle,
      url: `https://bsky.app/profile/${encodeURIComponent(actor.handle)}`,
      avatar: actor.avatar || "",
      date: actor.createdAt ? new Date(actor.createdAt) : actor.indexedAt ? new Date(actor.indexedAt) : null,
      note: actor.description ? actor.description.slice(0, 110) : actor.handle
    }))
  );
}

async function fetchWikidataSocialProfiles(term, signal) {
  const searchParams = new URLSearchParams({
    action: "wbsearchentities",
    search: term,
    language: "en",
    limit: "5",
    format: "json",
    origin: "*"
  });

  const searchUrl = `https://www.wikidata.org/w/api.php?${searchParams.toString()}`;
  const searchData = await fetchJson(searchUrl, signal);
  const entities = Array.isArray(searchData.search) ? searchData.search : [];
  const ids = entities.map((item) => item.id).filter(Boolean).slice(0, 5);

  if (ids.length === 0) {
    return [];
  }

  const getParams = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "labels|descriptions|claims",
    languages: "pt|en",
    format: "json",
    origin: "*"
  });

  const getUrl = `https://www.wikidata.org/w/api.php?${getParams.toString()}`;
  const details = await fetchJson(getUrl, signal);
  const allEntities = details.entities || {};
  const results = [];

  Object.values(allEntities).forEach((entity) => {
    const label = pickLabel(entity, ["pt", "en"]) || "Entidade";
    const description = pickDescription(entity, ["pt", "en"]);

    extractClaimValues(entity, "P2002").forEach((handle) => {
      results.push({
        platform: "X/Twitter",
        name: `@${handle}`,
        url: `https://x.com/${encodeURIComponent(handle)}`,
        avatar: "",
        date: null,
        note: description ? `${label} - ${description}` : `${label} (Wikidata)`
      });
    });

    extractClaimValues(entity, "P4265").forEach((username) => {
      results.push({
        platform: "Reddit",
        name: `u/${username}`,
        url: `https://www.reddit.com/user/${encodeURIComponent(username)}`,
        avatar: "",
        date: null,
        note: description ? `${label} - ${description}` : `${label} (Wikidata)`
      });
    });
  });

  return uniqueBy(results, (item) => item.url);
}

function extractClaimValues(entity, propertyId) {
  const claims = Array.isArray(entity?.claims?.[propertyId]) ? entity.claims[propertyId] : [];
  const values = [];

  claims.forEach((claim) => {
    const value = claim?.mainsnak?.datavalue?.value;

    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
    }
  });

  return values;
}

function pickLabel(entity, langs) {
  for (const lang of langs) {
    const value = entity?.labels?.[lang]?.value;
    if (value) {
      return value;
    }
  }

  return "";
}

function pickDescription(entity, langs) {
  for (const lang of langs) {
    const value = entity?.descriptions?.[lang]?.value;
    if (value) {
      return value;
    }
  }

  return "";
}

async function fetchJson(url, signal, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, signal, timeoutMs);

  if (!response.ok) {
    throw new Error(`Falha ${response.status} em ${url}`);
  }

  return response.json();
}

async function fetchText(url, signal, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, signal, timeoutMs);

  if (!response.ok) {
    throw new Error(`Falha ${response.status} em ${url}`);
  }

  return response.text();
}

async function fetchWithTimeout(url, parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromParent = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  try {
    return await fetch(url, {
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Timeout apos ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);

    if (parentSignal) {
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  }
}

function renderOpenSearch(payload, hasError = false) {
  dom.openSearchList.innerHTML = "";
  dom.openSearchLinks.innerHTML = "";

  if (hasError || !payload) {
    dom.openSearchList.appendChild(buildEmpty("Busca aberta indisponivel no momento."));
    return 0;
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) {
    dom.openSearchList.appendChild(buildEmpty("Sem itens na API de busca aberta para este termo."));
  } else {
    results.forEach((item) => {
      const box = document.createElement("article");
      box.className = "mini-item";

      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || item.url;

      const description = document.createElement("p");
      description.textContent = item.description || "Sem descricao.";

      box.append(link, description);
      dom.openSearchList.appendChild(box);
    });
  }

  const links = Array.isArray(payload.links) ? payload.links : [];
  links.forEach((item) => {
    const anchor = document.createElement("a");
    anchor.className = "search-link";
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = item.label;
    dom.openSearchLinks.appendChild(anchor);
  });

  return results.length;
}

function renderNews(news, hasError = false) {
  dom.newsList.innerHTML = "";

  if (hasError || !Array.isArray(news)) {
    dom.newsList.appendChild(buildEmpty("Falha ao carregar noticias."));
    return 0;
  }

  if (news.length === 0) {
    dom.newsList.appendChild(buildEmpty("Nenhuma noticia encontrada."));
    return 0;
  }

  news.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.appendChild(buildAnchor(item.url, item.title));

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.append(buildMetaSource(item.source), document.createTextNode(formatDate(item.date)));

    card.append(title, meta);
    dom.newsList.appendChild(card);
  });

  return news.length;
}

function renderWiki(context, hasError = false) {
  dom.wikiSummary.innerHTML = "";
  dom.wikiRelated.innerHTML = "";

  if (hasError || !context) {
    dom.wikiSummary.classList.add("empty-box");
    dom.wikiSummary.textContent = "Falha ao carregar Wikipedia.";
    return 0;
  }

  if (!context.summary) {
    dom.wikiSummary.classList.add("empty-box");
    dom.wikiSummary.textContent = "Sem contexto enciclopedico para este termo.";
  } else {
    dom.wikiSummary.classList.remove("empty-box");

    const title = document.createElement("h3");
    title.appendChild(buildAnchor(context.summary.url, context.summary.title));

    const extract = document.createElement("p");
    extract.textContent = context.summary.extract;

    dom.wikiSummary.append(title, extract);
  }

  if (!Array.isArray(context.related) || context.related.length === 0) {
    dom.wikiRelated.appendChild(buildEmpty("Sem paginas relacionadas na Wikipedia."));
    return context.summary ? 1 : 0;
  }

  context.related.slice(0, 5).forEach((entry) => {
    const box = document.createElement("article");
    box.className = "mini-item";

    const link = buildAnchor(entry.url, entry.title);
    const description = document.createElement("p");
    description.textContent = entry.description;

    box.append(link, description);
    dom.wikiRelated.appendChild(box);
  });

  return context.related.length + (context.summary ? 1 : 0);
}

function renderDiscussions(payload, hasError = false) {
  dom.discussionList.innerHTML = "";

  if (hasError || !payload) {
    dom.discussionList.appendChild(buildEmpty("Falha ao carregar discussao tecnica."));
    return 0;
  }

  if (payload.redditBlocked) {
    dom.discussionList.appendChild(buildEmpty("Reddit bloqueou esta consulta nesta rede. Exibindo outras fontes disponiveis."));
  }

  const items = Array.isArray(payload.items) ? payload.items : [];

  if (items.length === 0) {
    dom.discussionList.appendChild(buildEmpty("Sem discussoes recentes para este termo."));
    return 0;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.appendChild(buildAnchor(item.url, item.title));

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.append(buildMetaSource(item.source));

    const parts = [];
    if (item.author) {
      parts.push(`por ${item.author}`);
    }
    if (Number.isFinite(item.score)) {
      parts.push(`${item.score} pontos`);
    }
    if (item.subreddit) {
      parts.push(item.subreddit);
    }
    parts.push(formatDate(item.date));

    meta.append(document.createTextNode(parts.join(" | ")));

    card.append(title, meta);
    dom.discussionList.appendChild(card);
  });

  return items.length;
}

function renderProfiles(profiles, hasError = false) {
  dom.profilesList.innerHTML = "";

  if (hasError || !Array.isArray(profiles)) {
    dom.profilesList.appendChild(buildEmpty("Falha ao carregar perfis publicos."));
    return 0;
  }

  if (profiles.length === 0) {
    dom.profilesList.appendChild(buildEmpty("Nenhum perfil publico encontrado."));
    return 0;
  }

  profiles.forEach((profile) => {
    const card = document.createElement("article");
    card.className = "profile-card";

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = profile.avatar || "./favicon.svg";
    avatar.alt = `${profile.name} avatar`;
    avatar.loading = "lazy";

    const body = document.createElement("div");
    body.className = "profile-body";

    const name = buildAnchor(profile.url, profile.name);

    const platform = document.createElement("p");
    platform.className = "platform";
    platform.textContent = profile.platform;

    const note = document.createElement("p");
    note.className = "profile-note";

    if (profile.date) {
      note.textContent = `${profile.note} | desde ${profile.date.toLocaleDateString("pt-BR")}`;
    } else {
      note.textContent = profile.note;
    }

    body.append(name, platform, note);
    card.append(avatar, body);
    dom.profilesList.appendChild(card);
  });

  return profiles.length;
}

function buildAnchor(url, text) {
  const link = document.createElement("a");
  link.href = url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text || url || "Abrir";
  return link;
}

function buildMetaSource(source) {
  const span = document.createElement("span");
  span.className = "meta-source";
  span.textContent = `${source || "Fonte"} `;
  return span;
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

function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const dateA = a?.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : -Infinity;
    const dateB = b?.date instanceof Date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : -Infinity;
    return dateB - dateA;
  });
}

function formatDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("pt-BR")
    : "data nao informada";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];

  items.forEach((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    output.push(item);
  });

  return output;
}
