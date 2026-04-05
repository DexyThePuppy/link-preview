/**
 * Cloudflare Worker: link preview API compatible with the Node server routes.
 *
 * - Without [browser] binding: fetches HTML and extracts Open Graph / Twitter / basic meta (no JS rendering, no screenshot).
 * - With Browser Rendering + env.BROWSER: optional screenshots (Free/Paid Workers; see wrangler.toml).
 * - With KV SCREENSHOTS: screenshotUrl paths /s/{full|viewport}/{id}.ext ; without KV, PNG is returned as screenshotBase64 in JSON.
 *
 * @see https://developers.cloudflare.com/browser-rendering/ (available on Free and Paid plans)
 */

const UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const SCREENSHOT_PATH_SIZED = /^\/s\/(full|viewport|vp)\/([a-f0-9]{48})(?:\.(?:png|jpe?g|webp))?\/?$/i;
const SCREENSHOT_PATH_LEGACY = /^\/s\/([a-f0-9]{48})(?:\.(?:png|jpe?g|webp))?\/?$/i;

/** @param {string} pathname */
function targetFromPathname(pathname) {
  const raw = pathname.replace(/^\/+/, "");
  if (!raw) return null;
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `https://${path}`;
}

/** Basic SSRF guard for worker fetch() */
function assertPublicUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  ) {
    throw new Error("Host not allowed");
  }
  const p = /^(\d{1,3})\.(\d{1,3})\./.exec(h);
  if (p) {
    const a = Number(p[1]);
    const b = Number(p[2]);
    if (a === 10) throw new Error("Host not allowed");
    if (a === 127) throw new Error("Host not allowed");
    if (a === 192 && b === 168) throw new Error("Host not allowed");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("Host not allowed");
    if (a === 169 && b === 254) throw new Error("Host not allowed");
    if (a === 100 && b >= 64 && b <= 127) throw new Error("Host not allowed");
  }
  return u.href;
}

function json(body, status = 200, extraHeaders = {}) {
  const data = JSON.stringify(body, null, 2);
  return new Response(data, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

function absolutizeUrl(baseHref, value) {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v, baseHref).href;
  } catch {
    return null;
  }
}

function pickTitle(s) {
  return (
    s.ogTitle ||
    s.twitterTitle ||
    (s.docTitle && s.docTitle.trim()) ||
    null
  );
}

function pickDescription(s) {
  return (
    s.ogDescription ||
    s.twitterDescription ||
    s.metaDescription ||
    null
  );
}

function pickImage(s, pageUrl) {
  const raw = s.ogImage || s.twitterImage;
  return absolutizeUrl(pageUrl, raw);
}

function pickDomain(pageUrl, s) {
  const fromMeta = s.ogUrl || s.canonical;
  try {
    if (fromMeta) {
      return new URL(fromMeta).hostname.replace(/^www\./, "");
    }
  } catch {
    /* fall through */
  }
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pickFavicon(s, pageUrl) {
  const href = s.faviconHref || s.appleTouch || null;
  return absolutizeUrl(pageUrl, href);
}

function hexAccent(themeColor) {
  if (!themeColor || typeof themeColor !== "string") return null;
  const m = themeColor.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = `#${m[1].toLowerCase()}`;
  const n = parseInt(m[1], 16);
  return {
    hex,
    rgb: { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 },
  };
}

/**
 * Stream HTML through HTMLRewriter; mutates `state`
 * @param {Response} res
 * @param {string} pageUrl
 * @param {Record<string, any>} state
 */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      /** @type {any} */ (bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

async function consumeHtmlMeta(res, pageUrl, state) {
  let inTitle = false;

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const prop = el.getAttribute("property");
        const name = (el.getAttribute("name") || "").toLowerCase();
        const content = el.getAttribute("content");
        if (!content) return;
        if (prop === "og:title" && !state.ogTitle) state.ogTitle = content;
        else if (prop === "og:description" && !state.ogDescription)
          state.ogDescription = content;
        else if (prop === "og:image" && !state.ogImage)
          state.ogImage = absolutizeUrl(pageUrl, content);
        else if (prop === "og:url" && !state.ogUrl)
          state.ogUrl = absolutizeUrl(pageUrl, content);
        else if (name === "twitter:title" && !state.twitterTitle)
          state.twitterTitle = content;
        else if (name === "twitter:description" && !state.twitterDescription)
          state.twitterDescription = content;
        else if (name === "twitter:image" && !state.twitterImage)
          state.twitterImage = absolutizeUrl(pageUrl, content);
        else if (name === "description" && !state.metaDescription)
          state.metaDescription = content;
        else if (name === "theme-color" && !state.themeColor)
          state.themeColor = content;
      },
    })
    .on("title", {
      element() {
        inTitle = true;
        state.docTitle = "";
      },
      text(t) {
        if (inTitle) state.docTitle += t.text;
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel === "canonical" && !state.canonical) {
          state.canonical = absolutizeUrl(pageUrl, href);
        }
        if (
          (rel === "icon" || rel === "shortcut icon") &&
          !state.faviconHref
        ) {
          state.faviconHref = href;
        }
        if (
          (rel === "apple-touch-icon" ||
            rel === "apple-touch-icon-precomposed") &&
          !state.appleTouch
        ) {
          state.appleTouch = href;
        }
      },
    })

  const transformed = rewriter.transform(res);
  await transformed.text();
}

function randomId48() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function screenshotDisabled(searchParams) {
  if (!searchParams.has("screenshot")) return false;
  const v = searchParams.get("screenshot");
  return v === "0" || v === "false" || v === "no";
}

function screenshotFullPage(searchParams) {
  const fp = searchParams.get("fullPage");
  if (fp === "0" || fp === "false") return false;
  return true;
}

/** @param {Request} request */
function requestBaseUrl(request) {
  const u = new URL(request.url);
  return `${u.origin}`;
}

/** @param {import('@cloudflare/workers-types').Fetcher} browser */
async function screenshotWithBrowser(browser, targetUrl, fullPage) {
  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const instance = await puppeteer.launch(browser);
  try {
    const page = await instance.newPage();
    await page.setUserAgent(UA);
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });
    const buf = await page.screenshot({
      type: "png",
      fullPage,
      captureBeyondViewport: fullPage,
    });
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  } finally {
    await instance.close();
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/" || pathname === "") {
      return json({
        usage:
          "GET /example.com or /https://example.com/path — HTML metadata (Worker). Optional ?screenshot=0 | ?fullPage=0. Screenshots: uncomment [browser] in wrangler (Browser Rendering is on Free + Paid Workers plans).",
        worker: true,
        browserBinding: Boolean(env.BROWSER),
        screenshotKv: Boolean(env.SCREENSHOTS),
      });
    }

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    let m = pathname.match(SCREENSHOT_PATH_SIZED);
    let id = m ? m[2] : null;
    if (!m) {
      const leg = pathname.match(SCREENSHOT_PATH_LEGACY);
      if (leg) id = leg[1];
    }
    if (id) {
      id = id.toLowerCase();
      if (!env.SCREENSHOTS) {
        return json(
          { error: "Screenshot KV not configured (SCREENSHOTS binding)" },
          501
        );
      }
      const pack = await env.SCREENSHOTS.getWithMetadata(id, {
        type: "arrayBuffer",
      });
      const blob = pack?.value;
      if (!blob) {
        return json({ error: "Screenshot not found or expired" }, 404);
      }
      /** @type {string} */
      const mime =
        (pack.metadata &&
          /** @type {{ contentType?: string }} */ (pack.metadata).contentType) ||
        "image/png";
      return new Response(blob, {
        headers: {
          "content-type": mime,
          "cache-control": "private, max-age=300",
          "access-control-allow-origin": "*",
        },
      });
    }

    const targetRaw = targetFromPathname(pathname);
    if (!targetRaw) {
      return json({ error: "Missing host or URL in path" }, 400);
    }

    let target;
    try {
      target = assertPublicUrl(targetRaw);
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : String(e) },
        400
      );
    }

    const noShot = screenshotDisabled(url.searchParams);
    const wantFull = screenshotFullPage(url.searchParams);
    const sizeSeg = wantFull ? "full" : "viewport";

    const state = {
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      ogUrl: null,
      twitterTitle: null,
      twitterDescription: null,
      twitterImage: null,
      metaDescription: null,
      themeColor: null,
      canonical: null,
      faviconHref: null,
      appleTouch: null,
      docTitle: null,
    };

    try {
      const pageRes = await fetch(target, {
        redirect: "follow",
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const ct = pageRes.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        await consumeHtmlMeta(pageRes, target, state);
      }

      const out = {
        url: target,
        title: pickTitle(state),
        description: pickDescription(state),
        domain: pickDomain(target, state),
        img: pickImage(state, target),
        favicon: pickFavicon(state, target),
        accentColor: hexAccent(state.themeColor),
        worker: true,
        fetchedContentType: ct.split(";")[0] || ct,
      };

      if (!noShot && env.BROWSER) {
        try {
          const ab = await screenshotWithBrowser(
            env.BROWSER,
            target,
            wantFull
          );
          const ext = ".png";
          const mime = "image/png";

          if (env.SCREENSHOTS) {
            const sid = randomId48();
            await env.SCREENSHOTS.put(sid, ab, {
              expirationTtl: 15 * 60,
              metadata: { contentType: mime },
            });
            const base = requestBaseUrl(request);
            out.screenshotUrl = `${base}/s/${sizeSeg}/${sid}${ext}`;
            out.screenshotMime = mime;
            out.screenshotSize = sizeSeg;
          } else {
            out.screenshotBase64 = arrayBufferToBase64(ab);
            out.screenshotMime = mime;
            out.screenshotSize = sizeSeg;
          }
        } catch (shotErr) {
          out.screenshotError =
            shotErr instanceof Error ? shotErr.message : String(shotErr);
        }
      } else if (!noShot && !env.BROWSER) {
        out.screenshotNote =
          "No BROWSER binding — enable Browser Rendering in wrangler.toml for screenshots.";
      }

      return json(out);
    } catch (err) {
      return json(
        {
          error: err instanceof Error ? err.message : String(err),
          url: target,
        },
        500
      );
    }
  },
};
