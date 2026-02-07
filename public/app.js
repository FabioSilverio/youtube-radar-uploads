const STORAGE_KEY = "yt-radar-state-v2";
const CLOUD_FILE_NAME = "youtube-radar-sync.json";
const CLOUD_PULL_INTERVAL_MS = 45000;

const state = {
  apiKey: "",
  channels: [],
  feedVideos: [],
  watchLater: [],
  seenVideos: [],
  watchedMap: {},
  lastModifiedAt: 0,
  cloudSync: {
    enabled: false,
    token: "",
    gistId: "",
    lastSyncedAt: 0
  }
};

const refs = {
  tabFeed: document.querySelector("#tab-feed"),
  tabWatchLater: document.querySelector("#tab-watch-later"),
  tabSeen: document.querySelector("#tab-seen"),
  feedSection: document.querySelector("#feed-section"),
  watchLaterSection: document.querySelector("#watch-later-section"),
  seenSection: document.querySelector("#seen-section"),
  apiKeyInput: document.querySelector("#api-key"),
  saveApiKeyBtn: document.querySelector("#save-api-key"),
  addChannelForm: document.querySelector("#add-channel-form"),
  channelUrlInput: document.querySelector("#channel-url"),
  refreshFeedBtn: document.querySelector("#refresh-feed"),
  cloudTokenInput: document.querySelector("#cloud-token"),
  cloudGistIdInput: document.querySelector("#cloud-gist-id"),
  connectCloudSyncBtn: document.querySelector("#connect-cloud-sync"),
  pullCloudSyncBtn: document.querySelector("#pull-cloud-sync"),
  cloudSyncStatus: document.querySelector("#cloud-sync-status"),
  generateSyncCodeBtn: document.querySelector("#generate-sync-code"),
  copySyncLinkBtn: document.querySelector("#copy-sync-link"),
  importSyncCodeBtn: document.querySelector("#import-sync-code"),
  syncCodeInput: document.querySelector("#sync-code"),
  channelsList: document.querySelector("#channels-list"),
  feedList: document.querySelector("#feed-list"),
  watchLaterList: document.querySelector("#watch-later-list"),
  seenList: document.querySelector("#seen-list"),
  statusMessage: document.querySelector("#status-message"),
  videoTemplate: document.querySelector("#video-card-template")
};

let cloudPushTimer = null;
let cloudPullTimer = null;
let cloudOperationInFlight = false;
let suppressCloudPush = false;

init();

function init() {
  hydrateState();
  importFromSyncHash();
  normalizeStateCollections();
  bindEvents();
  refs.apiKeyInput.value = state.apiKey;
  refs.cloudTokenInput.value = state.cloudSync.token;
  refs.cloudGistIdInput.value = state.cloudSync.gistId;
  render();
  renderCloudSyncStatus();

  if (hasCloudSyncConfig()) {
    startCloudAutoSync();
    syncFromCloud({ silent: true });
  }

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
  refs.tabSeen.addEventListener("click", () => showSection("seen"));

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
  refs.connectCloudSyncBtn.addEventListener("click", connectCloudSync);
  refs.pullCloudSyncBtn.addEventListener("click", () => syncFromCloud({ silent: false }));
  refs.generateSyncCodeBtn.addEventListener("click", () => {
    refs.syncCodeInput.value = encodeSyncState();
    setStatus("Codigo de sincronizacao gerado.");
  });
  refs.copySyncLinkBtn.addEventListener("click", async () => {
    const token = encodeSyncState();
    const shareLink = `${window.location.origin}${window.location.pathname}#sync=${encodeURIComponent(token)}`;

    try {
      await navigator.clipboard.writeText(shareLink);
      setStatus("Link de sincronizacao copiado.");
    } catch {
      refs.syncCodeInput.value = token;
      setStatus("Nao consegui copiar automaticamente. Codigo gerado no campo.");
    }
  });
  refs.importSyncCodeBtn.addEventListener("click", async () => {
    const token = refs.syncCodeInput.value.trim();
    if (!token) {
      setStatus("Cole um codigo de sincronizacao primeiro.");
      return;
    }

    try {
      applyImportedState(decodeSyncState(token), { preserveCloud: true });
      refs.apiKeyInput.value = state.apiKey;
      render();
      renderCloudSyncStatus();
      setStatus("Sincronizacao importada com sucesso.");

      if (state.channels.length > 0 && state.apiKey) {
        await refreshFeed();
      }
    } catch (error) {
      setStatus(error.message || "Codigo de sincronizacao invalido.");
    }
  });
}

function showSection(name) {
  const feedActive = name === "feed";
  const watchLaterActive = name === "watchLater";
  const seenActive = name === "seen";
  refs.tabFeed.classList.toggle("active", feedActive);
  refs.tabWatchLater.classList.toggle("active", watchLaterActive);
  refs.tabSeen.classList.toggle("active", seenActive);
  refs.feedSection.classList.toggle("hidden", !feedActive);
  refs.watchLaterSection.classList.toggle("hidden", !watchLaterActive);
  refs.seenSection.classList.toggle("hidden", !seenActive);
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
    persist();
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

  const sortedVideos = Array.from(unique.values()).sort((a, b) => {
    const da = new Date(a.publishedAt || 0).getTime();
    const db = new Date(b.publishedAt || 0).getTime();
    return db - da;
  });

  const unseenVideos = [];
  for (const video of sortedVideos) {
    if (state.watchedMap[video.id]) {
      upsertSeenVideo(video, { prepend: false });
      continue;
    }
    unseenVideos.push(video);
  }

  state.feedVideos = unseenVideos;
  state.watchLater = state.watchLater.filter((video) => !state.watchedMap[video.id]);

  persist();
  render();

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
  renderSeen();
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
  state.watchLater = state.watchLater.filter((video) => video.channelId !== channelId);
  state.seenVideos = state.seenVideos.filter((video) => video.channelId !== channelId);

  persist();
  render();

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
    const card = buildVideoCard(video, { mode: "feed" });
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
    const card = buildVideoCard(video, { mode: "watchLater" });
    refs.watchLaterList.appendChild(card);
  }
}

function renderSeen() {
  refs.seenList.innerHTML = "";

  if (state.seenVideos.length === 0) {
    refs.seenList.innerHTML = "<p class=\"empty\">Nenhum video marcado como visto.</p>";
    return;
  }

  for (const video of state.seenVideos) {
    const card = buildVideoCard(video, { mode: "seen" });
    refs.seenList.appendChild(card);
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
  const restoreButton = node.querySelector(".restore-button");
  const durationLabel = getDurationLabel(video);

  thumb.src = video.thumbnail || "";
  thumb.alt = `Thumbnail: ${video.title}`;
  link.href = video.url;
  link.textContent = video.title;
  meta.textContent = `${video.channelTitle} - ${formatDate(video.publishedAt)}`;
  durationText.textContent = `Duracao: ${durationLabel}`;
  durationBadge.textContent = durationLabel;

  if (config.mode === "seen") {
    watchedCheckbox.checked = true;
    watchedCheckbox.disabled = true;
    node.classList.add("watched");
    saveButton.classList.add("hidden");
    removeButton.classList.add("hidden");
    restoreButton.classList.remove("hidden");
    restoreButton.addEventListener("click", () => {
      restoreFromSeen(video);
    });
    return node;
  }

  const watched = Boolean(state.watchedMap[video.id]);
  watchedCheckbox.checked = watched;
  node.classList.toggle("watched", watched);

  watchedCheckbox.addEventListener("change", () => {
    if (watchedCheckbox.checked) {
      moveVideoToSeen(video);
      return;
    }

    delete state.watchedMap[video.id];
    persist();
    render();
  });

  restoreButton.classList.add("hidden");

  if (config.mode === "feed") {
    const isSaved = state.watchLater.some((item) => item.id === video.id);
    saveButton.classList.toggle("saved", isSaved);
    saveButton.textContent = isSaved ? "Salvo" : "Salvar para assistir depois";
    saveButton.addEventListener("click", () => {
      saveToWatchLater(video);
    });
    removeButton.classList.add("hidden");
    return node;
  }

  saveButton.classList.add("hidden");

  if (config.mode === "watchLater") {
    removeButton.classList.remove("hidden");
    removeButton.addEventListener("click", () => {
      removeFromWatchLater(video.id);
    });
  }

  return node;
}

function saveToWatchLater(video) {
  if (state.watchedMap[video.id]) {
    setStatus("Este video ja esta marcado como visto.");
    return;
  }

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
  render();
  setStatus("Video removido da lista.");
}

function moveVideoToSeen(video) {
  state.watchedMap[video.id] = true;
  state.feedVideos = state.feedVideos.filter((item) => item.id !== video.id);
  state.watchLater = state.watchLater.filter((item) => item.id !== video.id);
  upsertSeenVideo(video, { prepend: true });
  persist();
  render();
  setStatus("Video movido para JA VISTOS.");
}

function restoreFromSeen(video) {
  delete state.watchedMap[video.id];
  state.seenVideos = state.seenVideos.filter((item) => item.id !== video.id);

  if (!state.feedVideos.some((item) => item.id === video.id)) {
    state.feedVideos.unshift(video);
  }

  persist();
  render();
  setStatus("Video voltou para o FEED.");
}

function upsertSeenVideo(video, options = { prepend: false }) {
  const index = state.seenVideos.findIndex((item) => item.id === video.id);
  if (index >= 0) {
    state.seenVideos[index] = { ...state.seenVideos[index], ...video };
    return;
  }

  if (options.prepend) {
    state.seenVideos.unshift(video);
    return;
  }

  state.seenVideos.push(video);
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

function normalizeStateCollections() {
  state.channels = dedupeByKey(state.channels, "channelId");
  state.feedVideos = dedupeByKey(state.feedVideos, "id");
  state.watchLater = dedupeByKey(state.watchLater, "id");
  state.seenVideos = dedupeByKey(state.seenVideos, "id");

  for (const video of [...state.feedVideos, ...state.watchLater]) {
    if (state.watchedMap[video.id]) {
      upsertSeenVideo(video, { prepend: false });
    }
  }

  state.feedVideos = state.feedVideos.filter((video) => !state.watchedMap[video.id]);
  state.watchLater = state.watchLater.filter((video) => !state.watchedMap[video.id]);
}

function dedupeByKey(items, key) {
  if (!Array.isArray(items)) {
    return [];
  }

  const map = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const value = item[key];
    if (!value || map.has(value)) continue;
    map.set(value, item);
  }

  return Array.from(map.values());
}

function hasCloudSyncConfig() {
  return Boolean(state.cloudSync.enabled && state.cloudSync.token && state.cloudSync.gistId);
}

function renderCloudSyncStatus() {
  if (!refs.cloudSyncStatus) return;

  if (!hasCloudSyncConfig()) {
    refs.cloudSyncStatus.textContent =
      "Ao conectar, o app salva e atualiza automaticamente seus dados na nuvem.";
    return;
  }

  const lastSync = state.cloudSync.lastSyncedAt
    ? new Date(state.cloudSync.lastSyncedAt).toLocaleString("pt-BR")
    : "agora";

  refs.cloudSyncStatus.textContent = `Sync ativo no Gist ${state.cloudSync.gistId.slice(0, 8)}... | ultimo sync: ${lastSync}`;
}

async function connectCloudSync() {
  const token = refs.cloudTokenInput.value.trim();
  const gistIdInput = refs.cloudGistIdInput.value.trim();

  if (!token) {
    setStatus("Informe um token do GitHub com permissao gist.");
    return;
  }

  setStatus("Conectando sync na nuvem...");

  try {
    const gistId = await ensureCloudGist(token, gistIdInput);
    state.cloudSync.enabled = true;
    state.cloudSync.token = token;
    state.cloudSync.gistId = gistId;

    refs.cloudGistIdInput.value = gistId;
    persist({ skipCloudPush: true });
    renderCloudSyncStatus();

    await syncFromCloud({ silent: true });
    await pushCloudState({ silent: true });
    startCloudAutoSync();
    setStatus("Sync na nuvem conectado. Agora a sincronizacao e automatica.");
  } catch (error) {
    setStatus(`Falha ao conectar sync na nuvem: ${error.message}`);
  }
}

function startCloudAutoSync() {
  if (cloudPullTimer) {
    clearInterval(cloudPullTimer);
  }

  cloudPullTimer = setInterval(() => {
    syncFromCloud({ silent: true });
  }, CLOUD_PULL_INTERVAL_MS);
}

function scheduleCloudPush() {
  if (!hasCloudSyncConfig()) {
    return;
  }

  if (cloudPushTimer) {
    clearTimeout(cloudPushTimer);
  }

  cloudPushTimer = setTimeout(() => {
    pushCloudState({ silent: true });
  }, 900);
}

async function syncFromCloud(options = {}) {
  const { silent = false } = options;

  if (!hasCloudSyncConfig()) {
    if (!silent) {
      setStatus("Conecte o sync na nuvem primeiro.");
    }
    return;
  }

  if (cloudOperationInFlight) {
    return;
  }

  cloudOperationInFlight = true;

  try {
    const gist = await githubApiRequest({
      method: "GET",
      path: `/gists/${state.cloudSync.gistId}`,
      token: state.cloudSync.token
    });

    const payload = await parseCloudPayload(gist);

    if (!payload || !payload.data) {
      throw new Error("Payload da nuvem invalido.");
    }

    const remoteUpdatedAt = Number(payload.updatedAt || 0);
    const localUpdatedAt = Number(state.lastModifiedAt || 0);

    if (remoteUpdatedAt > localUpdatedAt) {
      suppressCloudPush = true;
      applyImportedState(payload.data, { preserveCloud: true, keepTimestamp: true });
      state.lastModifiedAt = remoteUpdatedAt;
      persist({ skipCloudPush: true, keepTimestamp: true });
      refs.apiKeyInput.value = state.apiKey;
      render();

      if (state.apiKey && state.channels.length > 0) {
        await refreshFeed();
      }

      if (!silent) {
        setStatus("Dados da nuvem sincronizados.");
      }
    } else if (!silent) {
      setStatus("Nuvem ja esta sincronizada.");
    }

    state.cloudSync.lastSyncedAt = Date.now();
    persist({ skipCloudPush: true, keepTimestamp: true });
    renderCloudSyncStatus();
  } catch (error) {
    if (!silent) {
      setStatus(`Falha ao sincronizar nuvem: ${error.message}`);
    }
  } finally {
    suppressCloudPush = false;
    cloudOperationInFlight = false;
  }
}

async function pushCloudState(options = {}) {
  const { silent = false } = options;

  if (!hasCloudSyncConfig()) {
    return;
  }

  if (cloudOperationInFlight) {
    return;
  }

  cloudOperationInFlight = true;

  try {
    await githubApiRequest({
      method: "PATCH",
      path: `/gists/${state.cloudSync.gistId}`,
      token: state.cloudSync.token,
      body: {
        files: {
          [CLOUD_FILE_NAME]: {
            content: buildCloudDocument()
          }
        }
      }
    });

    state.cloudSync.lastSyncedAt = Date.now();
    persist({ skipCloudPush: true, keepTimestamp: true });
    renderCloudSyncStatus();

    if (!silent) {
      setStatus("Dados enviados para a nuvem.");
    }
  } catch (error) {
    if (!silent) {
      setStatus(`Falha ao enviar dados para nuvem: ${error.message}`);
    }
  } finally {
    cloudOperationInFlight = false;
  }
}

async function ensureCloudGist(token, gistId) {
  if (gistId) {
    await githubApiRequest({
      method: "GET",
      path: `/gists/${gistId}`,
      token
    });
    return gistId;
  }

  const created = await githubApiRequest({
    method: "POST",
    path: "/gists",
    token,
    body: {
      description: "YouTube Radar cloud sync",
      public: false,
      files: {
        [CLOUD_FILE_NAME]: {
          content: buildCloudDocument()
        }
      }
    }
  });

  if (!created?.id) {
    throw new Error("Nao foi possivel criar o Gist de sincronizacao.");
  }

  return created.id;
}

function buildCloudDocument() {
  return JSON.stringify(
    {
      version: 1,
      updatedAt: state.lastModifiedAt || Date.now(),
      data: {
        apiKey: state.apiKey,
        channels: state.channels,
        watchLater: state.watchLater,
        seenVideos: state.seenVideos,
        watchedMap: state.watchedMap
      }
    },
    null,
    2
  );
}

async function parseCloudPayload(gistResponse) {
  const files = gistResponse?.files || {};
  const preferred = files[CLOUD_FILE_NAME] || Object.values(files)[0];

  if (!preferred) {
    throw new Error("Gist de sincronizacao vazio.");
  }

  let raw = preferred.content;

  if ((!raw || preferred.truncated) && preferred.raw_url) {
    const response = await fetch(preferred.raw_url);
    if (!response.ok) {
      throw new Error("Nao consegui ler o arquivo de sincronizacao.");
    }
    raw = await response.text();
  }

  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("Arquivo de sincronizacao invalido.");
  }
}

async function githubApiRequest({ method, path, token, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || `GitHub API retornou ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function encodeSyncState() {
  const payload = {
    apiKey: state.apiKey,
    channels: state.channels,
    watchLater: state.watchLater,
    seenVideos: state.seenVideos,
    watchedMap: state.watchedMap
  };

  return base64Encode(JSON.stringify(payload));
}

function decodeSyncState(token) {
  let parsed;

  try {
    parsed = JSON.parse(base64Decode(token));
  } catch {
    throw new Error("Codigo de sincronizacao invalido.");
  }

  return parsed;
}

function applyImportedState(payload, options = {}) {
  const { preserveCloud = false, keepTimestamp = false } = options;

  if (!payload || typeof payload !== "object") {
    throw new Error("Codigo de sincronizacao invalido.");
  }

  const previousCloud = { ...state.cloudSync };

  state.apiKey = typeof payload.apiKey === "string" ? payload.apiKey : "";
  state.channels = Array.isArray(payload.channels) ? payload.channels : [];
  state.watchLater = Array.isArray(payload.watchLater) ? payload.watchLater : [];
  state.seenVideos = Array.isArray(payload.seenVideos) ? payload.seenVideos : [];
  state.watchedMap = payload.watchedMap && typeof payload.watchedMap === "object" ? payload.watchedMap : {};
  state.feedVideos = [];

  if (!keepTimestamp) {
    state.lastModifiedAt = Date.now();
  }

  if (preserveCloud) {
    state.cloudSync = previousCloud;
  }

  normalizeStateCollections();
  persist({ skipCloudPush: true, keepTimestamp });
}

function importFromSyncHash() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#sync=")) {
    return;
  }

  const token = decodeURIComponent(hash.slice(6));

  try {
    applyImportedState(decodeSyncState(token), { preserveCloud: true });
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      window.location.hash = "";
    }
  } catch {
    setStatus("Nao consegui importar sincronizacao do link.");
  }
}

function base64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function persist(options = {}) {
  const { skipCloudPush = false, keepTimestamp = false } = options;

  if (!keepTimestamp) {
    state.lastModifiedAt = Date.now();
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: state.apiKey,
      channels: state.channels,
      feedVideos: state.feedVideos,
      watchLater: state.watchLater,
      seenVideos: state.seenVideos,
      watchedMap: state.watchedMap,
      lastModifiedAt: state.lastModifiedAt,
      cloudSync: state.cloudSync
    })
  );

  if (!skipCloudPush && !suppressCloudPush) {
    scheduleCloudPush();
  }
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

    if (Array.isArray(parsed.feedVideos)) {
      state.feedVideos = parsed.feedVideos;
    }

    if (Array.isArray(parsed.watchLater)) {
      state.watchLater = parsed.watchLater;
    }

    if (Array.isArray(parsed.seenVideos)) {
      state.seenVideos = parsed.seenVideos;
    }

    if (parsed.watchedMap && typeof parsed.watchedMap === "object") {
      state.watchedMap = parsed.watchedMap;
    }

    if (typeof parsed.lastModifiedAt === "number") {
      state.lastModifiedAt = parsed.lastModifiedAt;
    }

    if (parsed.cloudSync && typeof parsed.cloudSync === "object") {
      state.cloudSync = {
        enabled: Boolean(parsed.cloudSync.enabled),
        token: typeof parsed.cloudSync.token === "string" ? parsed.cloudSync.token : "",
        gistId: typeof parsed.cloudSync.gistId === "string" ? parsed.cloudSync.gistId : "",
        lastSyncedAt: Number(parsed.cloudSync.lastSyncedAt || 0)
      };
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
