import { absolutizeUrl } from "./url-utils.js";

/**
 * @param {Response} res
 * @param {string} pageUrl
 */
export async function consumeHtmlMeta(res, pageUrl, state) {
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
    });

  const transformed = rewriter.transform(res);
  await transformed.text();
}

/** @param {Record<string, any>} s */
export function pickTitle(s) {
  return (
    s.ogTitle ||
    s.twitterTitle ||
    (s.docTitle && s.docTitle.trim()) ||
    null
  );
}

/** @param {Record<string, any>} s */
export function pickDescription(s) {
  return (
    s.ogDescription ||
    s.twitterDescription ||
    s.metaDescription ||
    null
  );
}

/** @param {Record<string, any>} s @param {string} pageUrl */
export function pickImage(s, pageUrl) {
  const raw = s.ogImage || s.twitterImage;
  return absolutizeUrl(pageUrl, raw);
}

/** @param {string} pageUrl @param {Record<string, any>} s */
export function pickDomain(pageUrl, s) {
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

/** @param {Record<string, any>} s @param {string} pageUrl */
export function pickFavicon(s, pageUrl) {
  const href = s.faviconHref || s.appleTouch || null;
  return absolutizeUrl(pageUrl, href);
}

/** @param {string | null} themeColor */
export function hexAccent(themeColor) {
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

/** Fresh meta-extraction state */
export function createMetaState() {
  return {
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
}
