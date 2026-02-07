const STORAGE_KEY = "yt-radar-state-v2";

const state = {
  apiKey: "",
  channels: [],
  feedVideos: [],
  watchLater: [],
  watchedMap: {}
};

const refs = {
  tabFeed: document.querySelector("#tab-feed"),
  tabWatchLater: document.querySelector("#tab-watch-later"),
  feedSection: document.querySelector("#feed-section"),
  watchLaterSection: document.querySelector("#watch-later-section"),
  apiKeyInput: document.querySelector("#api-key"),
  saveApiKeyBtn: document.querySelector("#save-api-key"),
  addChannelForm: document.querySelector("#add-channel-form"),
  channelUrlInput: document.querySelector("#channel-url"),
  refreshFeedBtn: document.querySelector("#refresh-feed"),
  channelsList: document.querySelector("#channels-list"),
  feedList: document.querySelector("#feed-list"),
  watchLaterList: document.querySelector("#watch-later-list"),
  statusMessage: document.querySelector("#status-message"),
  videoTemplate: document.querySelector("#video-card-template")
};

init();

function init() {
  hydrateState();
  bindEvents();
  refs.apiKeyInput.value = state.apiKey;
  render();

  if (!state.apiKey) {
    setStatus("Salve sua YouTube API key para carregar o feed.");
    return;
  }

  if (state.channels.length > 0) {
    refreshFeed();
  } else {
    setStatus("Adicione canais para montar seu feed.");
  }
}

function bindEvents() {
  refs.tabFeed.addEventListener("click", () => showSection("feed"));
  refs.tabWatchLater.addEventListener("click", () => showSection("watchLater"));

  refs.saveApiKeyBtn.addEventListener("click", async () => {
    const key = refs.apiKeyInput.value.trim();
    state.apiKey = key;
    persist();

    if (!key) {
      setStatus("API key removida.");
      state.feedVideos = [];
      renderFeed();
      return;
    }

    setStatus("API key salva.");
    if (state.channels.length > 0) {
      await refreshFeed();
    }
  });

  refs.addChannelForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.apiKey) {
      setStatus("Salve sua API key antes de adicionar canais.");
      return;
    }

    const url = refs.channelUrlInput.value.trim();
    if (!url) return;

    await addChannel(url);
  });

  refs.refreshFeedBtn.addEventListener("click", refreshFeed);
  refs.channelsList.addEventListener("click", handleRemoveChannelClick);
}

function showSection(name) {
  const feedActive = name === "feed";
  refs.tabFeed.classList.toggle("active", feedActive);
  refs.tabWatchLater.classList.toggle("active", !feedActive);
  refs.feedSection.classList.toggle("hidden", !feedActive);
  refs.watchLaterSection.classList.toggle("hidden", feedActive);
}

async function addChannel(url) {
  setStatus("Resolvendo canal...");

  try {
    const channel = await resolveChannelFromInput(url);

    if (state.channels.some((item) => item.channelId === channel.channelId)) {
      setStatus("Esse canal ja esta na sua lista.");
      refs.channelUrlInput.value = "";
      return;
    }

    state.channels.push(channel);
    refs.channelUrlInput.value = "";
    persist();
    renderChannels();
    setStatus(`Canal adicionado: ${channel.channelTitle}`);

    await refreshFeed();
  } catch (error) {
    setStatus(error.message || "Nao foi possivel adicionar esse canal.");
  }
}

async function refreshFeed() {
  if (!state.apiKey) {
    setStatus("Salve sua API key para atualizar o feed.");
    return;
  }

  if (state.channels.length === 0) {
    state.feedVideos = [];
    renderFeed();
    setStatus("Adicione canais para montar seu feed.");
    return;
  }

  setStatus("Atualizando feed...");

  const results = await Promise.all(
    state.channels.map(async (channel) => {
      try {
        const videos = await fetchLatestVideos(channel);
        return { channel, videos };
      } catch (error) {
        return { channel, error };
      }
    })
  );

  const failures = [];
  const mergedVideos = [];

  for (const result of results) {
    if (result.error) {
      failures.push(result.channel.channelTitle || result.channel.channelId);
      continue;
    }
    mergedVideos.push(...result.videos);
  }

  const unique = new Map();
  for (const video of mergedVideos) {
    if (!unique.has(video.id)) {
      unique.set(video.id, video);
    }
  }

  state.feedVideos = Array.from(unique.values()).sort((a, b) => {
    const da = new Date(a.publishedAt || 0).getTime();
    const db = new Date(b.publishedAt || 0).getTime();
    return db - da;
  });

  persist();
  renderFeed();

  if (failures.length > 0) {
    setStatus(`Feed atualizado com alertas. Falha em: ${failures.join(", ")}`);
    return;
  }

  setStatus("Feed atualizado.");
}

async function fetchLatestVideos(channel) {
  const data = await callYouTube("search", {
    part: "snippet",
    channelId: channel.channelId,
    maxResults: "12",
    order: "date",
    type: "video"
  });

  const items = Array.isArray(data.items) ? data.items : [];
  const videos = [];

  for (const item of items) {
    const videoId = item?.id?.videoId;
    const snippet = item?.snippet;

    if (!videoId || !snippet) continue;

    videos.push({
      id: videoId,
      title: snippet.title || "Video sem titulo",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail:
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.default?.url ||
        "",
      publishedAt: snippet.publishedAt || null,
      duration: null,
      channelId: channel.channelId,
      channelTitle: channel.channelTitle || snippet.channelTitle || "Canal"
    });
  }

  const durationMap = await fetchVideoDurations(videos.map((video) => video.id));
  for (const video of videos) {
    video.duration = durationMap.get(video.id) || null;
  }

  return videos;
}

async function fetchVideoDurations(videoIds) {
  const ids = videoIds.filter(Boolean);
  if (ids.length === 0) {
    return new Map();
  }

  const data = await callYouTube("videos", {
    part: "contentDetails",
    id: ids.join(","),
    maxResults: "50"
  });

  const map = new Map();
  for (const item of data.items || []) {
    if (!item?.id) continue;
    map.set(item.id, item?.contentDetails?.duration || null);
  }

  return map;
}

async function resolveChannelFromInput(input) {
  const raw = input.trim();

  if (/^UC[\w-]{20,}$/.test(raw)) {
    return resolveChannelById(raw, `https://www.youtube.com/channel/${raw}`);
  }

  if (/^@[\w.-]{3,}$/.test(raw)) {
    return resolveChannelBySearch(raw, `https://www.youtube.com/${raw}`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Informe uma URL valida de canal do YouTube.");
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com"].includes(host)) {
    throw new Error("A URL precisa ser de um canal do YouTube.");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    throw new Error("URL de canal nao identificada.");
  }

  if (pathParts[0] === "channel" && /^UC[\w-]{20,}$/.test(pathParts[1] || "")) {
    return resolveChannelById(pathParts[1], raw);
  }

  if (pathParts[0].startsWith("@")) {
    return resolveChannelBySearch(pathParts[0], raw);
  }

  if (pathParts[0] === "user" && pathParts[1]) {
    return resolveChannelByUsername(pathParts[1], raw);
  }

  if (pathParts[0] === "c" && pathParts[1]) {
    return resolveChannelBySearch(pathParts[1], raw);
  }

  return resolveChannelBySearch(pathParts[0], raw);
}

async function resolveChannelById(channelId, sourceUrl) {
  const data = await callYouTube("channels", {
    part: "snippet",
    id: channelId,
    maxResults: "1"
  });

  const item = data?.items?.[0];
  if (!item) {
    throw new Error("Canal nao encontrado para esse ID.");
  }

  return {
    channelId,
    channelTitle: item.snippet?.title || channelId,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    sourceUrl
  };
}

async function resolveChannelByUsername(username, sourceUrl) {
  const data = await callYouTube("channels", {
    part: "snippet",
    forUsername: username,
    maxResults: "1"
  });

  const item = data?.items?.[0];
  if (item?.id) {
    return {
      channelId: item.id,
      channelTitle: item.snippet?.title || username,
      channelUrl: `https://www.youtube.com/channel/${item.id}`,
      sourceUrl
    };
  }

  return resolveChannelBySearch(username, sourceUrl);
}

async function resolveChannelBySearch(query, sourceUrl) {
  const data = await callYouTube("search", {
    part: "snippet",
    type: "channel",
    q: query,
    maxResults: "1"
  });

  const item = data?.items?.[0];
  const channelId = item?.id?.channelId;

  if (!channelId) {
    throw new Error("Nao foi possivel resolver esse canal.");
  }

  return {
    channelId,
    channelTitle: item.snippet?.channelTitle || item.snippet?.title || query,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    sourceUrl
  };
}

async function callYouTube(endpoint, params) {
  if (!state.apiKey) {
    throw new Error("API key ausente.");
  }

  const search = new URLSearchParams(params);
  search.set("key", state.apiKey);

  const response = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${search.toString()}`);
  const data = await response.json();

  if (!response.ok || data.error) {
    const message =
      data?.error?.message ||
      `Erro na YouTube API (${response.status}). Verifique sua chave e restricoes.`;
    throw new Error(message);
  }

  return data;
}

function render() {
  renderChannels();
  renderFeed();
  renderWatchLater();
}

function renderChannels() {
  refs.channelsList.innerHTML = "";

  for (const channel of state.channels) {
    const pill = document.createElement("div");
    pill.className = "channel-pill";
    pill.innerHTML = `
      <span>${escapeHtml(channel.channelTitle)}</span>
      <button type="button" data-remove-channel="${channel.channelId}">Remover</button>
    `;
    refs.channelsList.appendChild(pill);
  }
}

function handleRemoveChannelClick(event) {
  const channelId = event.target.getAttribute("data-remove-channel");
  if (!channelId) return;

  state.channels = state.channels.filter((channel) => channel.channelId !== channelId);
  state.feedVideos = state.feedVideos.filter((video) => video.channelId !== channelId);

  persist();
  renderChannels();
  renderFeed();

  if (state.channels.length === 0) {
    setStatus("Canal removido. Sua lista esta vazia.");
    return;
  }

  setStatus("Canal removido.");
}

function renderFeed() {
  refs.feedList.innerHTML = "";

  if (state.feedVideos.length === 0) {
    refs.feedList.innerHTML = "<p class=\"empty\">Sem videos para mostrar no feed.</p>";
    return;
  }

  for (const video of state.feedVideos) {
    const card = buildVideoCard(video, { showSaveButton: true, showRemoveButton: false });
    refs.feedList.appendChild(card);
  }
}

function renderWatchLater() {
  refs.watchLaterList.innerHTML = "";

  if (state.watchLater.length === 0) {
    refs.watchLaterList.innerHTML = "<p class=\"empty\">Nenhum video salvo ainda.</p>";
    return;
  }

  for (const video of state.watchLater) {
    const card = buildVideoCard(video, { showSaveButton: false, showRemoveButton: true });
    refs.watchLaterList.appendChild(card);
  }
}

function buildVideoCard(video, config) {
  const node = refs.videoTemplate.content.firstElementChild.cloneNode(true);

  const thumb = node.querySelector(".thumb");
  const durationBadge = node.querySelector(".duration-badge");
  const link = node.querySelector("a");
  const meta = node.querySelector(".meta");
  const durationText = node.querySelector(".duration-text");
  const watchedCheckbox = node.querySelector(".watched-checkbox");
  const saveButton = node.querySelector(".save-button");
  const removeButton = node.querySelector(".remove-button");
  const durationLabel = getDurationLabel(video);

  thumb.src = video.thumbnail || "";
  thumb.alt = `Thumbnail: ${video.title}`;
  link.href = video.url;
  link.textContent = video.title;
  meta.textContent = `${video.channelTitle} - ${formatDate(video.publishedAt)}`;
  durationText.textContent = `Duracao: ${durationLabel}`;
  durationBadge.textContent = durationLabel;

  const watched = Boolean(state.watchedMap[video.id]);
  watchedCheckbox.checked = watched;
  node.classList.toggle("watched", watched);

  watchedCheckbox.addEventListener("change", () => {
    if (watchedCheckbox.checked) {
      state.watchedMap[video.id] = true;
    } else {
      delete state.watchedMap[video.id];
    }

    persist();
    renderFeed();
    renderWatchLater();
  });

  if (config.showSaveButton) {
    const isSaved = state.watchLater.some((item) => item.id === video.id);
    saveButton.classList.toggle("saved", isSaved);
    saveButton.textContent = isSaved ? "Salvo" : "Salvar para assistir depois";

    saveButton.addEventListener("click", () => {
      saveToWatchLater(video);
    });
  } else {
    saveButton.classList.add("hidden");
  }

  if (config.showRemoveButton) {
    removeButton.classList.remove("hidden");
    removeButton.addEventListener("click", () => {
      removeFromWatchLater(video.id);
    });
  }

  return node;
}

function saveToWatchLater(video) {
  if (state.watchLater.some((item) => item.id === video.id)) {
    setStatus("Video ja salvo em Assistir Depois.");
    return;
  }

  state.watchLater.unshift(video);
  persist();
  renderFeed();
  renderWatchLater();
  setStatus("Video salvo em Assistir Depois.");
}

function removeFromWatchLater(videoId) {
  state.watchLater = state.watchLater.filter((video) => video.id !== videoId);
  persist();
  renderFeed();
  renderWatchLater();
  setStatus("Video removido da lista.");
}

function formatDate(value) {
  if (!value) return "Data desconhecida";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data desconhecida";
  }

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function getDurationLabel(video) {
  const label = formatIsoDuration(video.duration);
  if (label) return label;
  return "Indisponivel";
}

function formatIsoDuration(isoDuration) {
  if (typeof isoDuration !== "string" || isoDuration.length === 0) {
    return "";
  }

  const match = isoDuration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) {
    return "";
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const totalHours = days * 24 + hours;

  if (totalHours > 0) {
    return `${totalHours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${Math.max(0, minutes)}:${String(seconds).padStart(2, "0")}`;
}

function setStatus(message) {
  refs.statusMessage.textContent = message;
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: state.apiKey,
      channels: state.channels,
      watchLater: state.watchLater,
      watchedMap: state.watchedMap
    })
  );
}

function hydrateState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);

    if (typeof parsed.apiKey === "string") {
      state.apiKey = parsed.apiKey;
    }

    if (Array.isArray(parsed.channels)) {
      state.channels = parsed.channels;
    }

    if (Array.isArray(parsed.watchLater)) {
      state.watchLater = parsed.watchLater;
    }

    if (parsed.watchedMap && typeof parsed.watchedMap === "object") {
      state.watchedMap = parsed.watchedMap;
    }
  } catch (error) {
    console.error("Falha ao carregar estado local", error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
