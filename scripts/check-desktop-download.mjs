#!/usr/bin/env node
// Verifies the desktop app download URL returns HTTP 200.
// Run before publishing a new build:  node scripts/check-desktop-download.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/desktop-app.ts", import.meta.url), "utf8");
const match = src.match(/DESKTOP_APP_DOWNLOAD_URL\s*=\s*["'`]([^"'`]+)["'`]/);
if (!match) {
  console.error("✗ Could not find DESKTOP_APP_DOWNLOAD_URL in src/lib/desktop-app.ts");
  process.exit(2);
}
const url = match[1];
console.log(`→ Checking ${url}`);

try {
  // Follow GitHub's redirect to the actual asset.
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  if (res.status !== 200) {
    console.error(`✗ ${res.status} ${res.statusText} — release asset not reachable.`);
    console.error("  Check the tag exists, the release is published (not draft),");
    console.error("  and the filename in src/lib/desktop-app.ts matches the uploaded asset");
    console.error("  (GitHub appends .1/.2/.3 when re-uploading a same-name file).");
    process.exit(1);
  }
  const size = res.headers.get("content-length");
  console.log(`✓ 200 OK${size ? `  (${(Number(size) / 1024 / 1024).toFixed(1)} MB)` : ""}`);
} catch (e) {
  console.error(`✗ Network error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}