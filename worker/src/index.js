/**
 * Link preview Worker — metadata via fetch + HTMLRewriter; screenshots via
 * Browser Rendering (@cloudflare/puppeteer). Optional KV + Cache API.
 *
 * @see https://developers.cloudflare.com/workers/
 * @see https://developers.cloudflare.com/browser-rendering/
 */

import {
  FETCH_TIMEOUT_MS,
  SCREENSHOT_KV_TTL_SEC,
  SCREENSHOT_PATH_LEGACY,
  SCREENSHOT_PATH_SIZED,
  UA,
} from "./constants.js";
import {
  arrayBufferToBase64,
  jsonResponse,
  randomId48,
  requestOrigin,
  screenshotDisabled,
  screenshotFullPage,
} from "./http-utils.js";
import {
  consumeHtmlMeta,
  createMetaState,
  hexAccent,
  pickDescription,
  pickDomain,
  pickFavicon,
  pickImage,
  pickTitle,
} from "./meta-extract.js";
import { cacheGet, cacheKeyRequest, cachePut, cacheTtlSeconds } from "./preview-cache.js";
import { screenshotWithBrowser } from "./screenshot.js";
import { assertPublicUrl, targetFromPathname } from "./url-utils.js";

/** @param {Record<string, unknown>} out */
function shouldCachePreview(out) {
  if (out.screenshotError) return false;
  if (typeof out.screenshotBase64 === "string" && out.screenshotBase64.length > 0) {
    return false;
  }
  return true;
}

export default {
  /**
   * @param {Request} request
   * @param {import("./env.d.ts").Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
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
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const prettyJson = env.PRETTY_JSON === "1";

    if (pathname === "/" || pathname === "") {
      return jsonResponse(
        {
          usage:
            "GET /example.com or /https://example.com/path — preview JSON. ?screenshot=0 | ?fullPage=0. Screenshots require BROWSER binding (Browser Rendering).",
          docs: "https://developers.cloudflare.com/browser-rendering/",
          worker: true,
          runtime: "cloudflare-workers",
          browserBinding: Boolean(env.BROWSER),
          screenshotKv: Boolean(env.SCREENSHOTS),
          previewCacheTtl: cacheTtlSeconds(env.PREVIEW_CACHE_TTL),
        },
        200,
        {},
        prettyJson
      );
    }

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    let m = pathname.match(SCREENSHOT_PATH_SIZED);
    let sid = m ? m[2] : null;
    if (!m) {
      const leg = pathname.match(SCREENSHOT_PATH_LEGACY);
      if (leg) sid = leg[1];
    }
    if (sid) {
      sid = sid.toLowerCase();
      if (!env.SCREENSHOTS) {
        return jsonResponse(
          {
            error:
              "Screenshot KV not configured. Add [[kv_namespaces]] binding SCREENSHOTS in wrangler.toml.",
          },
          501
        );
      }
      const pack = await env.SCREENSHOTS.getWithMetadata(sid, {
        type: "arrayBuffer",
      });
      const blob = pack?.value;
      if (!blob) {
        return jsonResponse({ error: "Screenshot not found or expired" }, 404);
      }
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
      return jsonResponse({ error: "Missing host or URL in path" }, 400);
    }

    let target;
    try {
      target = assertPublicUrl(targetRaw);
    } catch (e) {
      return jsonResponse(
        { error: e instanceof Error ? e.message : String(e) },
        400
      );
    }

    const noShot = screenshotDisabled(url.searchParams);
    const wantFull = screenshotFullPage(url.searchParams);
    const sizeSeg = wantFull ? "full" : "viewport";

    const cacheKey = await cacheKeyRequest(request, target, wantFull, noShot);
    const cached = await cacheGet(env, cacheKey);
    if (cached) {
      return cached;
    }

    const state = createMetaState();

    try {
      const pageRes = await fetch(target, {
        redirect: "follow",
        headers: {
          "user-agent": UA,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const ct = pageRes.headers.get("content-type") || "";
      if (
        pageRes.ok &&
        (ct.includes("text/html") || ct.includes("application/xhtml"))
      ) {
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
        runtime: "cloudflare-workers",
        fetchedStatus: pageRes.status,
        fetchedContentType: ct.split(";")[0].trim() || ct,
      };

      if (!noShot && env.BROWSER) {
        try {
          const ab = await screenshotWithBrowser(env.BROWSER, target, wantFull);
          const mime = "image/png";

          if (env.SCREENSHOTS) {
            const id = randomId48();
            await env.SCREENSHOTS.put(id, ab, {
              expirationTtl: SCREENSHOT_KV_TTL_SEC,
              metadata: { contentType: mime },
            });
            const base = requestOrigin(request);
            out.screenshotUrl = `${base}/s/${sizeSeg}/${id}.png`;
            out.screenshotMime = mime;
            out.screenshotSize = sizeSeg;
          } else {
            out.screenshotBase64 = arrayBufferToBase64(ab);
            out.screenshotMime = mime;
            out.screenshotSize = sizeSeg;
          }
        } catch (shotErr) {
          const msg =
            shotErr instanceof Error ? shotErr.message : String(shotErr);
          out.screenshotError = msg;
          if (/429|rate limit exceeded/i.test(msg)) {
            out.screenshotNote =
              "Cloudflare Browser Rendering returned 429 after retries. Space out requests or check plan limits at https://developers.cloudflare.com/browser-rendering/limits/";
          }
        }
      } else if (!noShot && !env.BROWSER) {
        out.screenshotNote =
          "No BROWSER binding — add [browser] in wrangler.toml (Browser Rendering).";
      }

      const res = jsonResponse(out, 200, {}, prettyJson);
      if (shouldCachePreview(out)) {
        const toStore = res.clone();
        ctx.waitUntil(cachePut(env, cacheKey, toStore));
      }
      return res;
    } catch (err) {
      return jsonResponse(
        {
          error: err instanceof Error ? err.message : String(err),
          url: target,
        },
        500
      );
    }
  },
};
