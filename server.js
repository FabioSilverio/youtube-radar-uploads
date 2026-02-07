const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/channel/:channelId/videos", async (req, res) => {
  const { channelId } = req.params;
  const limit = Number(req.query.limit || 8);

  if (!/^UC[\w-]{10,}$/.test(channelId)) {
    return res.status(400).json({ error: "channel_id invalido" });
  }

  try {
    const feed = await fetchChannelFeed(channelId);
    res.json({
      channelId,
      channelTitle: feed.channelTitle,
      videos: feed.videos.slice(0, Math.max(1, Math.min(limit, 20)))
    });
  } catch (error) {
    res.status(500).json({
      error: "Falha ao carregar feed do canal",
      detail: error.message
    });
  }
});

app.post("/api/resolve-channel", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Informe uma URL valida do YouTube" });
  }

  try {
    const channelId = await resolveChannelId(url);
    const feed = await fetchChannelFeed(channelId);

    return res.json({
      channelId,
      channelTitle: feed.channelTitle,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      videos: feed.videos
    });
  } catch (error) {
    return res.status(400).json({
      error: "Nao foi possivel resolver este canal",
      detail: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

async function resolveChannelId(inputUrl) {
  let url;

  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("URL invalida");
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    throw new Error("A URL precisa ser do YouTube");
  }

  if (host === "youtu.be") {
    throw new Error("Use a URL do canal, nao de um video");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    throw new Error("URL de canal nao identificada");
  }

  if (pathParts[0] === "channel" && pathParts[1]) {
    return pathParts[1];
  }

  let normalizedPath = url.pathname;
  if (!normalizedPath.startsWith("/@") && !normalizedPath.startsWith("/c/") && !normalizedPath.startsWith("/user/")) {
    if (pathParts[0]) {
      normalizedPath = `/${pathParts[0]}`;
    }
  }

  const canonicalUrl = `https://www.youtube.com${normalizedPath}`;
  const html = await fetchText(canonicalUrl);

  const channelMatch = html.match(/"channelId":"(UC[\w-]+)"/);
  if (!channelMatch) {
    throw new Error("Nao encontrei channel_id para essa URL");
  }

  return channelMatch[1];
}

async function fetchChannelFeed(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const xml = await fetchText(feedUrl);

  const authorNameMatch = xml.match(/<author>\s*<name>([^<]+)<\/name>/);
  const channelTitle = decodeXml(authorNameMatch ? authorNameMatch[1] : channelId);

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const videos = [];

  let entry;
  while ((entry = entryRegex.exec(xml)) !== null) {
    const block = entry[1];
    const videoId = readTag(block, "yt:videoId");
    const title = decodeXml(readTag(block, "title"));
    const link = readLinkHref(block);
    const published = readTag(block, "published");
    const updated = readTag(block, "updated");
    const thumb = readThumbnail(block, videoId);

    if (!videoId) {
      continue;
    }

    videos.push({
      id: videoId,
      title: title || "Video sem titulo",
      url: link || `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published || updated || null,
      thumbnail: thumb,
      channelId,
      channelTitle
    });
  }

  return { channelId, channelTitle, videos };
}

function readTag(text, tagName) {
  const regex = new RegExp(`<${escapeRegExp(tagName)}>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function readLinkHref(text) {
  const match = text.match(/<link[^>]+href="([^"]+)"/);
  return match ? match[1] : "";
}

function readThumbnail(text, videoId) {
  const thumbMatch = text.match(/<media:thumbnail[^>]+url="([^"]+)"/);
  if (thumbMatch) {
    return thumbMatch[1];
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Falha em ${url} (${response.status})`);
  }

  return response.text();
}

module.exports = {
  app,
  startServer
};
