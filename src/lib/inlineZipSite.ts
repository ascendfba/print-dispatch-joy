import JSZip from "jszip";

/**
 * Take a ZIP of a static site and produce a single self-contained HTML string
 * by inlining CSS, JS, and images (as data URIs) referenced by relative paths.
 * Returns the inlined HTML and the index file name used.
 */
export async function inlineZipSite(file: File): Promise<{ html: string; indexPath: string }> {
  const zip = await JSZip.loadAsync(file);

  // Find index.html (shallowest match wins).
  const indexEntry = Object.values(zip.files)
    .filter((f) => !f.dir && /(^|\/)index\.html?$/i.test(f.name))
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0];

  if (!indexEntry) {
    throw new Error("No index.html found in the ZIP.");
  }

  const baseDir = indexEntry.name.includes("/")
    ? indexEntry.name.slice(0, indexEntry.name.lastIndexOf("/") + 1)
    : "";

  const indexHtml = await indexEntry.async("string");

  // Build a map of all other files (relative to baseDir) for lookups.
  const fileMap = new Map<string, JSZip.JSZipObject>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name === indexEntry.name) continue;
    const rel = entry.name.startsWith(baseDir) ? entry.name.slice(baseDir.length) : entry.name;
    fileMap.set(normalize(rel), entry);
  }

  const resolved = await Promise.all(
    [...fileMap.entries()].map(async ([path, entry]) => {
      const mime = mimeFor(path);
      const isText = isTextMime(mime);
      if (isText) {
        return { path, mime, text: await entry.async("string"), dataUrl: null as string | null };
      }
      const blob = await entry.async("blob");
      const dataUrl = await blobToDataUrl(new Blob([blob], { type: mime }));
      return { path, mime, text: null as string | null, dataUrl };
    }),
  );

  const byPath = new Map(resolved.map((r) => [r.path, r]));

  // CSS files may reference url(...) — inline those too.
  for (const item of resolved) {
    if (item.mime === "text/css" && item.text) {
      item.text = inlineCssUrls(item.text, item.path, byPath);
    }
  }

  let html = indexHtml;

  // <link rel="stylesheet" href="x.css"> → <style>...</style>
  html = html.replace(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi,
    (tag) => {
      const href = attr(tag, "href");
      if (!href || isAbsolute(href)) return tag;
      const item = byPath.get(normalize(href));
      if (!item || item.text == null) return tag;
      return `<style>\n${item.text}\n</style>`;
    },
  );

  // <script src="x.js"> → <script>...</script>
  html = html.replace(
    /<script\b([^>]*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, _pre, src) => {
      if (isAbsolute(src)) return tag;
      const item = byPath.get(normalize(src));
      if (!item || item.text == null) return tag;
      return `<script>\n${item.text}\n</script>`;
    },
  );

  // src="..." and href="..." for non-html assets → data URL
  html = html.replace(
    /\s(src|href)=["']([^"']+)["']/gi,
    (full, attrName, url) => {
      if (isAbsolute(url) || url.startsWith("#")) return full;
      const item = byPath.get(normalize(url));
      if (!item) return full;
      if (item.dataUrl) return ` ${attrName}="${item.dataUrl}"`;
      if (item.text != null && item.mime === "text/css") {
        // Should already be handled by the stylesheet replacement, but just in case.
        return ` ${attrName}="data:text/css;base64,${btoa(unescape(encodeURIComponent(item.text)))}"`;
      }
      return full;
    },
  );

  // Inline url(...) inside <style> blocks in the index HTML.
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) => {
    return `<style>${inlineCssUrls(css, "", byPath)}</style>`;
  });

  return { html, indexPath: indexEntry.name };
}

function inlineCssUrls(
  css: string,
  cssPath: string,
  byPath: Map<string, { mime: string; text: string | null; dataUrl: string | null }>,
) {
  const baseDir = cssPath.includes("/") ? cssPath.slice(0, cssPath.lastIndexOf("/") + 1) : "";
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, url) => {
    if (isAbsolute(url) || url.startsWith("data:")) return full;
    const resolved = normalize(baseDir + url);
    const item = byPath.get(resolved);
    if (item?.dataUrl) return `url("${item.dataUrl}")`;
    return full;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return m ? m[1] : null;
}

function isAbsolute(url: string) {
  return /^([a-z]+:)?\/\//i.test(url) || url.startsWith("data:") || url.startsWith("mailto:");
}

function normalize(p: string): string {
  // Resolve ./ and ../ segments and strip leading ./ or /.
  const parts: string[] = [];
  for (const seg of p.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    txt: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}

function isTextMime(mime: string) {
  return (
    mime.startsWith("text/") ||
    mime === "application/javascript" ||
    mime === "application/json"
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}