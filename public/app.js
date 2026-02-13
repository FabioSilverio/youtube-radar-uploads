const DEFAULT_FETCH_TIMEOUT_MS = 9000;

const dom = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#query-input"),
  status: document.querySelector("#status"),
  searchBtn: document.querySelector("#search-btn"),
  judicialForm: document.querySelector("#judicial-form"),
  judicialInput: document.querySelector("#judicial-input"),
  judicialBtn: document.querySelector("#judicial-btn"),
  judicialStatus: document.querySelector("#judicial-status"),
  judicialList: document.querySelector("#judicial-list"),
  openSearchList: document.querySelector("#open-search-list"),
  newsList: document.querySelector("#news-list"),
  wikiSummary: document.querySelector("#wiki-summary"),
  wikiRelated: document.querySelector("#wiki-related"),
  discussionList: document.querySelector("#discussion-list"),
  profilesList: document.querySelector("#profiles-list")
};

let activeController = null;
let judicialController = null;
let currentRunId = 0;
let currentJudicialRunId = 0;

const QUERY_STOPWORDS = new Set([
  "a", "as", "ao", "aos", "de", "da", "das", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os",
  "que", "quem", "qual", "quais", "como", "onde", "quando", "com", "para", "por", "sobre", "ja", "já",
  "foi", "foram", "ser", "sao", "são", "passou", "passaram", "trabalhou", "trabalhar",
  "the", "who", "what", "where", "when", "how", "and", "or", "in", "on", "at", "from", "of", "to"
]);

const QUERY_GENERIC_TERMS = new Set([
  "empresa", "empresas", "companhia", "companhias", "historia", "história",
  "noticia", "noticias", "notícia", "notícias", "latest", "news", "termo", "conceito"
]);

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "developer", "direct", "download", "explore", "legal",
  "p", "policies", "privacy", "reel", "reels", "stories", "tags", "tv"
]);

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const term = dom.input.value.trim();
  runScan(term);
});

dom.judicialForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const term = dom.judicialInput.value.trim();
  runJudicialScan(term);
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
  if (dom.judicialInput && !dom.judicialInput.value.trim()) {
    dom.judicialInput.value = term;
  }

  setStatus(`Escaneando "${term}"... 0/6 fontes`);

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
    },
    {
      label: "Processos judiciais",
      fetcher: fetchJudicialRecords,
      renderer: renderJudicialResults
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

async function runJudicialScan(term) {
  if (!term || term.length < 2) {
    setJudicialStatus("Use pelo menos 2 caracteres para buscar processos.");
    return;
  }

  if (judicialController) {
    judicialController.abort();
  }

  judicialController = new AbortController();
  const signal = judicialController.signal;
  const runId = ++currentJudicialRunId;
  const startedAt = Date.now();

  setJudicialLoadingState(true);
  setContainerLoading(dom.judicialList, "Carregando processos judiciais...");
  setJudicialStatus(`Buscando processos para "${term}"...`);

  try {
    const results = await fetchJudicialRecords(term, signal);
    if (runId !== currentJudicialRunId) {
      return;
    }

    const count = renderJudicialResults(results);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (count === 0) {
      setJudicialStatus(`Nenhum processo encontrado para "${term}".`);
    } else {
      setJudicialStatus(`Busca de processos concluida em ${elapsed}s. Itens: ${count}.`);
    }
  } catch {
    if (runId !== currentJudicialRunId) {
      return;
    }

    renderJudicialResults(null, true);
    setJudicialStatus("Falha ao buscar processos judiciais.");
  } finally {
    if (runId === currentJudicialRunId) {
      setJudicialLoadingState(false);
    }
  }
}

function setJudicialLoadingState(isLoading) {
  if (!dom.judicialBtn) {
    return;
  }

  dom.judicialBtn.disabled = isLoading;
  dom.judicialBtn.textContent = isLoading ? "Buscando..." : "Buscar processos";
}

function setJudicialStatus(message) {
  if (dom.judicialStatus) {
    dom.judicialStatus.textContent = message;
  }
}

function clearAllResults() {
  setContainerLoading(dom.openSearchList, "Carregando noticias dos provedores...");

  setContainerLoading(dom.newsList, "Carregando noticias...");

  dom.wikiSummary.classList.add("empty-box");
  dom.wikiSummary.textContent = "Carregando contexto enciclopedico...";
  setContainerLoading(dom.wikiRelated, "Carregando paginas relacionadas...");

  setContainerLoading(dom.discussionList, "Carregando discussoes...");
  setContainerLoading(dom.profilesList, "Carregando perfis publicos...");
  setContainerLoading(dom.judicialList, "Carregando processos judiciais...");
  setJudicialStatus("Buscando processos judiciais...");
}

function setContainerLoading(container, message) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  container.appendChild(buildEmpty(message));
}

function buildQueryVariants(term) {
  const original = (term || "").trim();
  if (!original) {
    return [];
  }

  const normalized = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ").filter(Boolean);
  const meaningful = tokens.filter((token) => {
    return token.length > 2 && !QUERY_STOPWORDS.has(token);
  });

  const bigrams = [];
  for (let i = 0; i < meaningful.length - 1; i += 1) {
    const a = meaningful[i];
    const b = meaningful[i + 1];
    if (!QUERY_GENERIC_TERMS.has(a) && !QUERY_GENERIC_TERMS.has(b)) {
      bigrams.push(`${a} ${b}`);
    }
  }

  const focus = bigrams[0]
    || meaningful.filter((token) => !QUERY_GENERIC_TERMS.has(token)).slice(0, 2).join(" ")
    || meaningful.slice(0, 3).join(" ");

  const variants = [];
  if (focus) {
    variants.push(focus);
  }
  variants.push(original);
  if (meaningful.length > 0) {
    variants.push(meaningful.slice(0, 4).join(" "));
  }

  return uniqueBy(
    variants
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
    (value) => value.toLowerCase()
  );
}

async function fetchOpenSearch(term, signal) {
  const variants = buildQueryVariants(term);
  let mergedItems = [];
  let providerErrors = [];

  for (const variant of variants) {
    const result = await fetchOpenSearchWithVariant(variant, signal);
    mergedItems = uniqueBy([...mergedItems, ...result.items], (item) => normalizeNewsIdentity(item));
    providerErrors = uniqueBy([...providerErrors, ...result.providerErrors], (item) => item);

    if (mergedItems.length >= 6) {
      break;
    }
  }

  const sorted = sortByDateDesc(mergedItems).slice(0, 12);
  if (sorted.length === 0) {
    throw new Error("Sem noticias de provedores abertos");
  }

  return {
    items: sorted,
    providerErrors
  };
}

async function fetchOpenSearchWithVariant(query, signal) {
  const encodedTerm = encodeURIComponent(query);
  const googleUrl = `https://news.google.com/rss/search?q=${encodedTerm}%20when%3A30d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const bingUrl = `https://www.bing.com/news/search?q=${encodedTerm}&format=rss`;

  const [googleResult, bingResult] = await Promise.allSettled([
    fetchProviderRssNews("Google News", googleUrl, signal),
    fetchProviderRssNews("Bing News", bingUrl, signal)
  ]);

  const items = uniqueBy(
    sortByDateDesc([...readSettled(googleResult), ...readSettled(bingResult)]),
    (item) => normalizeNewsIdentity(item)
  );

  return {
    items,
    providerErrors: [
      googleResult.status === "rejected" ? `Google News (${query})` : null,
      bingResult.status === "rejected" ? `Bing News (${query})` : null
    ].filter(Boolean)
  };
}

async function fetchProviderRssNews(provider, rssUrl, signal) {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`;
  const xmlText = await fetchText(proxyUrl, signal, 11000);
  return parseRssNewsItems(xmlText, provider);
}

function parseRssNewsItems(xmlText, provider) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const hasError = xml.querySelector("parsererror");

  if (hasError) {
    throw new Error(`RSS invalido (${provider})`);
  }

  const items = Array.from(xml.querySelectorAll("item"));
  return items.map((item) => {
    const rawTitle = item.querySelector("title")?.textContent || "Sem titulo";
    const rawLink = item.querySelector("link")?.textContent || "";
    const rawDescription = item.querySelector("description")?.textContent || "";
    const rawSource = item.querySelector("source, News\\:Source")?.textContent || provider;
    const rawDate = item.querySelector("pubDate")?.textContent || "";

    return {
      source: rawSource || provider,
      title: stripHtml(rawTitle),
      url: unwrapBingNewsUrl(rawLink),
      description: stripHtml(rawDescription),
      date: parseFlexibleDate(rawDate)
    };
  });
}

async function fetchLatestNews(term, signal) {
  const variants = buildQueryVariants(term);
  let merged = [];

  for (const variant of variants) {
    const params = new URLSearchParams({
      query: variant,
      mode: "ArtList",
      sort: "DateDesc",
      maxrecords: "12",
      format: "json"
    });

    const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
    const data = await fetchJson(url, signal);
    const list = Array.isArray(data.articles) ? data.articles : [];

    const mapped = list.map((item) => ({
      title: item.title || "Sem titulo",
      url: item.url,
      source: item.domain || item.sourcecommonname || "Fonte nao informada",
      date: parseGdeltDate(item.seendate)
    }));

    merged = uniqueBy([...merged, ...mapped], (item) => normalizeNewsIdentity(item));
    if (merged.length >= 8) {
      break;
    }
  }

  return sortByDateDesc(merged).slice(0, 8);
}

async function fetchWikipediaContext(term, signal) {
  const variants = buildQueryVariants(term);

  for (const variant of variants) {
    let context = await searchWikipedia(variant, "pt", signal);

    if (context.related.length === 0) {
      context = await searchWikipedia(variant, "en", signal);
    }

    if (context.related.length > 0 || context.summary) {
      return context;
    }
  }

  return { summary: null, related: [] };
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
  const variants = buildQueryVariants(term);
  let merged = [];
  let redditBlocked = false;

  for (const variant of variants) {
    const [hnResult, redditResult] = await Promise.allSettled([
      fetchHackerNewsRecent(variant, signal),
      fetchRedditDiscussions(variant, signal)
    ]);

    if (redditResult.status === "rejected") {
      redditBlocked = true;
    }

    const hnItems = readSettled(hnResult);
    const redditItems = readSettled(redditResult);
    const combined = [...hnItems, ...redditItems];
    merged = uniqueBy([...merged, ...combined], (item) => `${item.source}|${item.url}`);

    if (merged.length >= 10) {
      break;
    }
  }

  const ranked = rankDiscussionItems(merged).slice(0, 12);

  return {
    items: ranked,
    redditBlocked
  };
}

async function fetchJudicialRecords(term, signal) {
  const variants = uniqueBy([term, ...buildQueryVariants(term)], (value) => value.toLowerCase());
  let merged = [];

  for (const variant of variants.slice(0, 3)) {
    const queries = [
      `${variant} processo judicial`,
      `${variant} site:jusbrasil.com.br/processos`,
      `${variant} site:pje.jus.br`,
      `${variant} site:esaj.tjsp.jus.br`,
      `${variant} site:tribunal`
    ];

    const settled = await Promise.allSettled(
      queries.map((query) => fetchBingWebSearchFeed(query, signal))
    );

    const collected = settled
      .flatMap((result) => readSettled(result))
      .filter((item) => isLikelyJudicialResult(item));

    merged = uniqueBy(
      [...merged, ...collected],
      (item) => normalizeNewsIdentity(item)
    );

    if (merged.length >= 12) {
      break;
    }
  }

  return sortByDateDesc(merged).slice(0, 12);
}

async function fetchBingWebSearchFeed(query, signal) {
  const bingItems = await fetchBingSearchRssFeed(query, signal);
  if (bingItems.length > 0) {
    return bingItems;
  }

  return fetchDuckDuckGoLiteFeed(query, signal);
}

async function fetchBingSearchRssFeed(query, signal) {
  const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  const proxyCandidates = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`
  ];

  for (const proxyUrl of proxyCandidates) {
    try {
      const text = await fetchText(proxyUrl, signal, 11000);
      const xmlText = proxyUrl.includes("/get?url=")
        ? JSON.parse(text)?.contents || ""
        : text;

      if (!xmlText) {
        continue;
      }

      const parsedItems = parseRssNewsItems(xmlText, "Bing Search");
      const mapped = parsedItems.map((item) => ({
        title: item.title || "Resultado sem titulo",
        url: item.url,
        source: extractHostLabel(item.url) || item.source || "Bing Search",
        description: item.description || "",
        date: item.date
      }));

      if (mapped.length > 0) {
        return mapped;
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchDuckDuckGoLiteFeed(query, signal) {
  const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const proxyCandidates = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(ddgUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(ddgUrl)}`
  ];

  for (const proxyUrl of proxyCandidates) {
    try {
      const text = await fetchText(proxyUrl, signal, 11000);
      const htmlText = proxyUrl.includes("/get?url=")
        ? JSON.parse(text)?.contents || ""
        : text;

      if (!htmlText) {
        continue;
      }

      const parser = new DOMParser();
      const html = parser.parseFromString(htmlText, "text/html");
      const anchors = Array.from(html.querySelectorAll("a[href]"));

      const results = anchors.map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        const resolvedHref = resolveDuckDuckGoRedirect(rawHref);
        const title = stripHtml(anchor.textContent || "");

        if (!resolvedHref || !title) {
          return null;
        }

        return {
          title,
          url: resolvedHref,
          source: extractHostLabel(resolvedHref) || "DuckDuckGo",
          description: "",
          date: null
        };
      }).filter(Boolean);

      if (results.length > 0) {
        return uniqueBy(results, (item) => normalizeNewsIdentity(item));
      }
    } catch {
      continue;
    }
  }

  return [];
}

function resolveDuckDuckGoRedirect(href) {
  if (!href) {
    return "";
  }

  try {
    const absoluteHref = href.startsWith("//") ? `https:${href}` : href;
    const url = new URL(absoluteHref, "https://lite.duckduckgo.com");
    const host = url.hostname.toLowerCase();

    if (host.includes("duckduckgo.com")) {
      const target = url.searchParams.get("uddg");
      if (target) {
        return decodeURIComponent(target);
      }
    }

    return url.toString();
  } catch {
    return "";
  }
}

function isLikelyJudicialResult(item) {
  const text = `${item.title || ""} ${item.description || ""} ${item.url || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const strongKeywords = [
    "processo", "judicial", "tribunal", "acordao", "sentenca", "jusbrasil",
    "pje", "esaj", "trf", "trt", "tj", "stj", "stf"
  ];

  return strongKeywords.some((keyword) => text.includes(keyword));
}

function extractHostLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || "";
  } catch {
    return "";
  }
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
      comments: Number.isFinite(hit.num_comments) ? hit.num_comments : 0,
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
        comments: Number.isFinite(post.num_comments) ? post.num_comments : 0,
        subreddit: post.subreddit_name_prefixed || "r/unknown",
        date: Number.isFinite(post.created_utc) ? new Date(post.created_utc * 1000) : null
      };
    })
  );
}

async function fetchProfiles(term, signal) {
  const variants = buildQueryVariants(term);
  let merged = [];

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const tasks = [
      fetchGitHubProfiles(variant, signal),
      fetchBlueskyProfiles(variant, signal),
      fetchWikidataSocialProfiles(variant, signal)
    ];

    if (index === 0 || merged.length === 0) {
      tasks.push(fetchSearchEngineSocialProfiles(variant, signal));
    }

    const settled = await Promise.allSettled(tasks);
    const collected = settled.flatMap((result) => readSettled(result));

    merged = uniqueBy(
      [
        ...merged,
        ...collected
      ],
      (item) => `${item.platform}|${item.url}`
    );

    if (merged.length >= 10) {
      break;
    }
  }

  const prioritized = [...merged].sort((a, b) => {
    const priorityA = getProfilePriority(a.platform);
    const priorityB = getProfilePriority(b.platform);
    if (priorityB !== priorityA) {
      return priorityB - priorityA;
    }

    const dateA = a?.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : -Infinity;
    const dateB = b?.date instanceof Date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : -Infinity;
    return dateB - dateA;
  }).slice(0, 20);

  return hydrateProfileAvatars(prioritized, signal);
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
    const wikiAvatar = pickWikidataAvatar(entity);
    const note = description ? `${label} - ${description}` : `${label} (Wikidata)`;

    extractClaimValues(entity, "P2002").forEach((handle) => {
      const username = handle.replace(/^@/, "").trim();
      if (!username) {
        return;
      }

      results.push({
        platform: "X/Twitter",
        name: `@${username}`,
        url: `https://x.com/${encodeURIComponent(username)}`,
        avatar: wikiAvatar,
        date: null,
        note
      });
    });

    extractClaimValues(entity, "P4265").forEach((username) => {
      const account = username.replace(/^u\//i, "").trim();
      if (!account) {
        return;
      }

      results.push({
        platform: "Reddit",
        name: `u/${account}`,
        url: `https://www.reddit.com/user/${encodeURIComponent(account)}`,
        avatar: wikiAvatar,
        date: null,
        note
      });
    });

    extractClaimValues(entity, "P6634").forEach((value) => {
      const linkedin = normalizeLinkedInIdentity(value, "in");
      if (!linkedin) {
        return;
      }

      results.push({
        platform: "LinkedIn",
        name: label,
        url: linkedin.url,
        avatar: wikiAvatar,
        date: null,
        note
      });
    });

    extractClaimValues(entity, "P4264").forEach((value) => {
      const linkedin = normalizeLinkedInIdentity(value, "company");
      if (!linkedin) {
        return;
      }

      results.push({
        platform: "LinkedIn",
        name: label,
        url: linkedin.url,
        avatar: wikiAvatar,
        date: null,
        note
      });
    });

    extractClaimValues(entity, "P2003").forEach((username) => {
      const instagram = normalizeInstagramIdentity(username);
      if (!instagram) {
        return;
      }

      results.push({
        platform: "Instagram",
        name: `@${instagram.username}`,
        url: instagram.url,
        avatar: `https://unavatar.io/instagram/${encodeURIComponent(instagram.username)}`,
        date: null,
        note
      });
    });
  });

  return uniqueBy(results, (item) => `${item.platform}|${item.url}`);
}

async function fetchSearchEngineSocialProfiles(term, signal) {
  const sources = [
    { platform: "LinkedIn", query: `${term} site:linkedin.com/company` },
    { platform: "LinkedIn", query: `${term} site:linkedin.com/in` },
    { platform: "LinkedIn", query: `${term} LinkedIn` },
    { platform: "Instagram", query: `${term} site:instagram.com` },
    { platform: "Instagram", query: `${term} Instagram` }
  ];

  const settled = await Promise.allSettled(
    sources.map((source) => fetchBingWebSearchItems(source, signal))
  );

  const merged = settled.flatMap((result) => readSettled(result));
  return uniqueBy(sortByDateDesc(merged), (item) => `${item.platform}|${item.url}`).slice(0, 6);
}

async function fetchBingWebSearchItems(source, signal) {
  const feedItems = await fetchBingWebSearchFeed(source.query, signal);

  return feedItems.flatMap((item) => {
    const candidates = uniqueBy(
      [
        item.url,
        ...extractProfileUrlsFromText(item.title),
        ...extractProfileUrlsFromText(item.description)
      ].filter(Boolean),
      (value) => value
    );

    const profiles = candidates
      .map((candidate) => (source.platform === "LinkedIn"
        ? parseLinkedInUrl(candidate)
        : parseInstagramUrl(candidate)))
      .filter(Boolean);

    if (profiles.length === 0) {
      return [];
    }

    return profiles.map((profile) => {
      const title = item.title || "Perfil publico";
      const normalizedName = source.platform === "Instagram"
        ? `@${profile.username}`
        : cleanLinkedInTitle(title, profile);

      const avatar = source.platform === "Instagram"
        ? `https://unavatar.io/instagram/${encodeURIComponent(profile.username)}`
        : "";

      return {
        platform: source.platform,
        name: normalizedName,
        url: profile.url,
        avatar,
        date: item.date,
        note: `Encontrado na busca aberta (${item.source || "Bing"})`
      };
    });
  });
}

async function hydrateProfileAvatars(profiles, signal) {
  let linkedInLookups = 0;
  const MAX_LINKEDIN_LOOKUPS = 4;

  const hydrated = await Promise.all(
    profiles.map(async (profile) => {
      let linkedInAvatar = "";

      if (profile.platform === "LinkedIn" && !profile.avatar && linkedInLookups < MAX_LINKEDIN_LOOKUPS) {
        linkedInLookups += 1;
        linkedInAvatar = await fetchLinkedInAvatarFromPage(profile.url, signal);
      }

      const avatarCandidates = uniqueBy(
        [
          linkedInAvatar,
          ...buildProfileAvatarCandidates(profile),
          "./favicon.svg"
        ].filter(Boolean),
        (value) => value
      );

      return {
        ...profile,
        avatar: avatarCandidates[0] || "./favicon.svg",
        avatarCandidates
      };
    })
  );

  return hydrated;
}

async function fetchLinkedInAvatarFromPage(profileUrl, signal) {
  const parsed = parseLinkedInUrl(profileUrl);

  if (!parsed) {
    return "";
  }

  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(parsed.url)}`;
    const html = await fetchText(proxyUrl, signal, 4500);
    return extractLinkedInImageFromHtml(html);
  } catch {
    return "";
  }
}

function extractLinkedInImageFromHtml(html) {
  if (!html) {
    return "";
  }

  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImageMatch?.[1]) {
    return decodeHtmlEntities(ogImageMatch[1]);
  }

  const companyLogoMatch = html.match(/https:\/\/media\.licdn\.com\/[^"'\\\s>]*(company-logo|profile-displayphoto)[^"'\\\s>]*/i);
  if (companyLogoMatch?.[0]) {
    return decodeHtmlEntities(companyLogoMatch[0]);
  }

  const genericMediaMatch = html.match(/https:\/\/media\.licdn\.com\/[^"'\\\s>]+/i);
  return genericMediaMatch?.[0] ? decodeHtmlEntities(genericMediaMatch[0]) : "";
}

function buildProfileAvatarCandidates(profile) {
  const candidates = [];

  if (profile.avatar) {
    candidates.push(profile.avatar);
  }

  const domainAvatar = buildDomainAvatar(profile.url);
  if (domainAvatar) {
    candidates.push(domainAvatar);
  }

  const nameAvatar = buildNameAvatar(profile.name);
  if (nameAvatar) {
    candidates.push(nameAvatar);
  }

  return candidates;
}

function buildDomainAvatar(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (!host) {
      return "";
    }

    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return "";
  }
}

function buildNameAvatar(name) {
  const baseName = (name || "Perfil publico").trim();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(baseName)}&size=128&background=0B3A3A&color=F4F9F8&bold=true`;
}

function pickWikidataAvatar(entity) {
  const imageName = extractClaimValues(entity, "P18")[0] || extractClaimValues(entity, "P154")[0];
  if (!imageName) {
    return "";
  }

  const cleanFileName = imageName.replace(/^File:/i, "").trim();
  if (!cleanFileName) {
    return "";
  }

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(cleanFileName)}`;
}

function extractProfileUrlsFromText(value) {
  const text = value || "";
  if (!text) {
    return [];
  }

  const linkedInMatches = text.match(/https?:\/\/(?:[a-z]{2}\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9._%-]+/gi) || [];
  const instagramMatches = text.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._%-]+\/?/gi) || [];

  return [...linkedInMatches, ...instagramMatches];
}

function normalizeLinkedInIdentity(value, preferredType) {
  const text = (value || "").trim();
  if (!text) {
    return null;
  }

  if (text.includes("linkedin.com")) {
    return parseLinkedInUrl(text);
  }

  const compact = text.replace(/^@/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const split = compact.split("/").filter(Boolean);

  if (split.length >= 2 && (split[0] === "in" || split[0] === "company")) {
    return normalizeLinkedInIdentity(`https://www.linkedin.com/${split[0]}/${split[1]}`, preferredType);
  }

  const slug = split[0];
  if (!slug) {
    return null;
  }

  const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeSlug) {
    return null;
  }

  const type = preferredType === "company" ? "company" : "in";
  return {
    type,
    slug: safeSlug,
    url: `https://www.linkedin.com/${type}/${safeSlug}`
  };
}

function parseLinkedInUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("linkedin.com")) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const type = parts[0].toLowerCase();
    if (type !== "in" && type !== "company") {
      return null;
    }

    const slug = decodeURIComponent(parts[1]).replace(/[^a-zA-Z0-9._-]/g, "");
    if (!slug) {
      return null;
    }

    return {
      type,
      slug,
      url: `https://www.linkedin.com/${type}/${slug}`
    };
  } catch {
    return null;
  }
}

function cleanLinkedInTitle(title, profile) {
  const raw = (title || "").trim();
  if (!raw) {
    return profile.type === "company" ? profile.slug : `@${profile.slug}`;
  }

  const cleaned = raw
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s*-\s*LinkedIn\s*$/i, "")
    .trim();

  return cleaned || (profile.type === "company" ? profile.slug : `@${profile.slug}`);
}

function normalizeInstagramIdentity(value) {
  const text = (value || "").trim();
  if (!text) {
    return null;
  }

  if (text.includes("instagram.com")) {
    return parseInstagramUrl(text);
  }

  const username = text.replace(/^@/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    return null;
  }

  const lowered = username.toLowerCase();
  if (RESERVED_INSTAGRAM_PATHS.has(lowered)) {
    return null;
  }

  return {
    username,
    url: `https://www.instagram.com/${username}/`
  };
}

function parseInstagramUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("instagram.com")) {
      return null;
    }

    const username = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
      return null;
    }

    if (RESERVED_INSTAGRAM_PATHS.has(username.toLowerCase())) {
      return null;
    }

    return {
      username,
      url: `https://www.instagram.com/${username}/`
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

  if (hasError || !payload) {
    dom.openSearchList.appendChild(buildEmpty("Busca aberta indisponivel no momento."));
    return 0;
  }

  if (Array.isArray(payload.providerErrors) && payload.providerErrors.length > 0) {
    dom.openSearchList.appendChild(
      buildEmpty(`Fontes temporariamente indisponiveis: ${payload.providerErrors.join(", ")}.`)
    );
  }

  const results = Array.isArray(payload.items) ? payload.items : [];
  if (results.length === 0) {
    dom.openSearchList.appendChild(buildEmpty("Sem noticias recentes nos provedores abertos para este termo."));
  } else {
    results.forEach((item) => {
      const box = document.createElement("article");
      box.className = "result-card";

      const title = document.createElement("h3");
      title.appendChild(buildAnchor(item.url, item.title || item.url));

      const meta = document.createElement("p");
      meta.className = "meta";
      meta.append(buildMetaSource(item.source), document.createTextNode(formatDate(item.date)));

      const description = document.createElement("p");
      description.className = "meta";
      description.textContent = item.description || "Sem resumo disponivel.";

      box.append(title, meta, description);
      dom.openSearchList.appendChild(box);
    });
  }

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
    if (Number.isFinite(item.comments)) {
      parts.push(`${item.comments} comentarios`);
    }
    if (item.subreddit) {
      parts.push(item.subreddit);
    }
    if (Number.isFinite(item.rankScore)) {
      parts.push(`relevancia ${item.rankScore.toFixed(1)}`);
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
    avatar.alt = `${profile.name} avatar`;
    avatar.loading = "lazy";
    setImageWithFallbacks(avatar, profile.avatarCandidates || [profile.avatar, "./favicon.svg"]);

    const body = document.createElement("div");
    body.className = "profile-body";

    const name = buildAnchor(profile.url, profile.name);

    const platform = document.createElement("p");
    platform.className = "platform";
    platform.textContent = profile.platform;

    const note = document.createElement("p");
    note.className = "profile-note";
    const noteText = (profile.note || "").trim();

    if (profile.date) {
      note.textContent = noteText
        ? `${noteText} | desde ${profile.date.toLocaleDateString("pt-BR")}`
        : `desde ${profile.date.toLocaleDateString("pt-BR")}`;
    } else {
      note.textContent = noteText || "Perfil publico";
    }

    body.append(name, platform, note);
    card.append(avatar, body);
    dom.profilesList.appendChild(card);
  });

  return profiles.length;
}

function renderJudicialResults(items, hasError = false) {
  if (!dom.judicialList) {
    return 0;
  }

  dom.judicialList.innerHTML = "";

  if (hasError || !Array.isArray(items)) {
    dom.judicialList.appendChild(buildEmpty("Falha ao carregar resultados judiciais."));
    return 0;
  }

  if (items.length === 0) {
    dom.judicialList.appendChild(buildEmpty("Nenhum resultado judicial encontrado para este termo."));
    return 0;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.appendChild(buildAnchor(item.url, item.title || "Abrir resultado"));

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.append(buildMetaSource(item.source || "Fonte"), document.createTextNode(formatDate(item.date)));

    const description = document.createElement("p");
    description.className = "meta";
    description.textContent = item.description || "Sem resumo disponivel.";

    card.append(title, meta, description);
    dom.judicialList.appendChild(card);
  });

  return items.length;
}

function buildAnchor(url, text) {
  const link = document.createElement("a");
  link.href = url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text || url || "Abrir";
  return link;
}

function setImageWithFallbacks(imageElement, sources) {
  const queue = uniqueBy(
    (Array.isArray(sources) ? sources : [sources])
      .filter(Boolean)
      .concat("./favicon.svg"),
    (value) => value
  );

  const applyNext = () => {
    const nextSource = queue.shift();
    if (!nextSource) {
      imageElement.onerror = null;
      return;
    }

    imageElement.src = nextSource;
  };

  imageElement.onerror = () => applyNext();
  applyNext();
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

function rankDiscussionItems(items) {
  return [...items]
    .map((item) => ({
      ...item,
      rankScore: computeDiscussionRank(item)
    }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }

      const scoreA = Number.isFinite(a.score) ? a.score : 0;
      const scoreB = Number.isFinite(b.score) ? b.score : 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      const dateA = a?.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : -Infinity;
      const dateB = b?.date instanceof Date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : -Infinity;
      return dateB - dateA;
    });
}

function getProfilePriority(platform) {
  const label = (platform || "").toLowerCase();

  if (label.includes("linkedin") || label.includes("instagram")) {
    return 4;
  }

  if (label.includes("x/") || label.includes("twitter")) {
    return 3;
  }

  if (label.includes("github") || label.includes("bluesky")) {
    return 2;
  }

  return 1;
}

function computeDiscussionRank(item) {
  const score = Number.isFinite(item.score) ? item.score : 0;
  const comments = Number.isFinite(item.comments) ? item.comments : 0;
  const popularity = score + comments * 2;
  const popularityScore = Math.log10(popularity + 1) * 55;

  const ageHours = item.date instanceof Date && !Number.isNaN(item.date.getTime())
    ? Math.max(0, (Date.now() - item.date.getTime()) / (1000 * 60 * 60))
    : 120;
  const freshnessScore = Math.max(0, 45 - ageHours * 0.9);

  return popularityScore + freshnessScore;
}

function normalizeNewsIdentity(item) {
  const normalizedTitle = (item.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedUrl = (item.url || "").split("?")[0].toLowerCase();
  return `${normalizedTitle}|${normalizedUrl}`;
}

function stripHtml(value) {
  if (!value) {
    return "";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${value}</body>`, "text/html");
  return doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function unwrapBingNewsUrl(link) {
  try {
    const url = new URL(link);
    if (url.hostname.includes("bing.com")) {
      const target = url.searchParams.get("url");
      if (target) {
        return decodeURIComponent(target);
      }
    }
  } catch {
    return link || "";
  }

  return link || "";
}

function parseFlexibleDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
