"use strict";

const crypto = require("crypto");
const http = require("http");
const linkPreview = require("../lib/index.js");

const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 6767;
})();
const HOST = process.env.HOST || "127.0.0.1";

const SCREENSHOT_TTL_MS = 15 * 60 * 1000;
const MAX_SCREENSHOTS = 200;
/** @type {Map<string, { buffer: Buffer, mime: string, timer: NodeJS.Timeout }>} */
const screenshotStore = new Map();

const SCREENSHOT_PATH_SIZED = new RegExp(
  "^/s/(full|viewport|vp)/([a-f0-9]{48})(?:\\.(?:png|jpe?g|webp))?/?$",
  "i"
);
const SCREENSHOT_PATH_LEGACY = new RegExp(
  "^/s/([a-f0-9]{48})(?:\\.(?:png|jpe?g|webp))?/?$",
  "i"
);

function requestBaseUrl(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const secure =
    req.headers["x-forwarded-proto"] === "https" ||
    req.headers["x-forwarded-ssl"] === "on";
  const proto = secure ? "https" : "http";
  return `${proto}://${host}`;
}

function storeScreenshot(buffer, mime) {
  while (screenshotStore.size >= MAX_SCREENSHOTS) {
    const firstId = screenshotStore.keys().next().value;
    const old = screenshotStore.get(firstId);
    if (old?.timer) {
      clearTimeout(old.timer);
    }
    screenshotStore.delete(firstId);
  }
  const id = crypto.randomBytes(24).toString("hex");
  const timer = setTimeout(() => {
    const cur = screenshotStore.get(id);
    if (cur?.timer) {
      clearTimeout(cur.timer);
    }
    screenshotStore.delete(id);
  }, SCREENSHOT_TTL_MS);
  screenshotStore.set(id, { buffer, mime, timer });
  return id;
}

function sendStoredScreenshot(res, id) {
  const entry = screenshotStore.get(id);
  if (!entry) {
    sendJson(res, 404, { error: "Screenshot not found or expired" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": entry.mime,
    "Content-Length": entry.buffer.length,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, max-age=300",
  });
  res.end(entry.buffer);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function targetFromPathname(pathname) {
  const raw = pathname.replace(/^\/+/, "");
  if (!raw) {
    return null;
  }
  const path = decodeURIComponent(raw);
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `https://${path}`;
}

function screenshotBytesToBuffer(value) {
  if (value == null) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function screenshotMimeFromOpts(screenshotOpts) {
  return screenshotOpts.type === "jpeg"
    ? "image/jpeg"
    : screenshotOpts.type === "webp"
      ? "image/webp"
      : "image/png";
}

function fileExtensionFromMime(mime) {
  if (mime === "image/jpeg") {
    return ".jpg";
  }
  if (mime === "image/webp") {
    return ".webp";
  }
  return ".png";
}

/** URL path segment for capture mode: full-page vs visible viewport. */
function screenshotSizePathSegment(screenshotOpts) {
  if (screenshotOpts && screenshotOpts.fullPage === false) {
    return "viewport";
  }
  return "full";
}

function previewToJSON(result, screenshotOpts, baseUrl) {
  const out = {
    title: result.title,
    description: result.description,
    domain: result.domain,
    img: result.img,
    favicon: result.favicon,
  };
  if (result.screenshotPath) {
    out.screenshotPath = result.screenshotPath;
  }
  const shot = screenshotBytesToBuffer(result.screenshot);
  if (screenshotOpts != null && shot) {
    const mime = screenshotMimeFromOpts(screenshotOpts);
    const id = storeScreenshot(shot, mime);
    const ext = fileExtensionFromMime(mime);
    const sizeSeg = screenshotSizePathSegment(screenshotOpts);
    out.screenshotSize = sizeSeg;
    out.screenshotUrl = `${baseUrl}/s/${sizeSeg}/${id}${ext}`;
    out.screenshotMime = mime;
  }
  if (result.accentColor) {
    out.accentColor = result.accentColor;
  }
  return out;
}

function screenshotDisabled(searchParams) {
  if (!searchParams.has("screenshot")) {
    return false;
  }
  const flag = searchParams.get("screenshot");
  return flag === "0" || flag === "false" || flag === "no";
}

function screenshotOptionsFromQuery(searchParams) {
  const opts = { returnBuffer: true };
  const fullPage = searchParams.get("fullPage");
  if (fullPage === "0" || fullPage === "false") {
    opts.fullPage = false;
  }
  const extra = searchParams.get("extraDelayMs");
  if (extra != null && extra !== "" && !Number.isNaN(Number(extra))) {
    opts.extraDelayMs = Number(extra);
  }
  const fmt = searchParams.get("type");
  if (fmt === "jpeg" || fmt === "jpg") {
    opts.type = "jpeg";
    const q = searchParams.get("quality");
    if (q != null && q !== "" && !Number.isNaN(Number(q))) {
      opts.quality = Number(q);
    }
  } else if (fmt === "webp") {
    opts.type = "webp";
    const q = searchParams.get("quality");
    if (q != null && q !== "" && !Number.isNaN(Number(q))) {
      opts.quality = Number(q);
    }
  }
  return opts;
}

function resolveServerScreenshotArg(searchParams) {
  if (screenshotDisabled(searchParams)) {
    return false;
  }
  return screenshotOptionsFromQuery(searchParams);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let incoming;
  try {
    incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "Invalid URL" });
    return;
  }

  const { pathname } = incoming;

  if (pathname === "/" || pathname === "") {
    sendJson(res, 200, {
      usage:
        "GET /example.com  — screenshotUrl is /s/full|viewport/:id.ext (full-page vs viewport). Legacy /s/:id.ext still works. ?screenshot=0 to skip. ?fullPage=0 for viewport capture.",
    });
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  let shotMatch = pathname.match(SCREENSHOT_PATH_SIZED);
  if (shotMatch) {
    sendStoredScreenshot(res, shotMatch[2].toLowerCase());
    return;
  }
  shotMatch = pathname.match(SCREENSHOT_PATH_LEGACY);
  if (shotMatch) {
    sendStoredScreenshot(res, shotMatch[1].toLowerCase());
    return;
  }

  const target = targetFromPathname(pathname);
  if (!target) {
    sendJson(res, 400, { error: "Missing host or URL in path" });
    return;
  }

  const screenshotArg = resolveServerScreenshotArg(incoming.searchParams);

  try {
    const result = await linkPreview(
      target,
      [],
      undefined,
      undefined,
      screenshotArg
    );
    const payload = previewToJSON(
      result,
      screenshotArg === false ? null : screenshotArg,
      requestBaseUrl(req)
    );
    payload.url = target;
    sendJson(res, 200, payload);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
      url: target,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.error(
    `Link preview server listening on http://${HOST}:${PORT}/ (try http://${HOST}:${PORT}/example.com)`
  );
});
