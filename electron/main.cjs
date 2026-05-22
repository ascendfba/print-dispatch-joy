const { app, BrowserWindow, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// The desktop app is a thin shell around the live published web app.
// Every time you click Publish → Update in Lovable, the desktop app
// picks up the new version on next launch (or Ctrl+R refresh) — no reinstall.
//
// Override at runtime with:  DISPATCH_URL=https://your-domain.com  DispatchConsole.exe
const APP_URL = process.env.DISPATCH_URL || "https://start.ascendfba.co.uk";

function getPrintLogPath() {
  try {
    return path.join(app.getPath("userData"), "print-debug.log");
  } catch {
    return path.join(os.tmpdir(), "dispatch-print-debug.log");
  }
}

function writePrintLog(event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...details,
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    fs.mkdirSync(path.dirname(getPrintLogPath()), { recursive: true });
    fs.appendFileSync(getPrintLogPath(), line, "utf8");
  } catch (e) {
    console.error("write print log failed", e);
  }
  console.log("print-debug", entry);
}

// Chromium's print stack expects pageSize in microns. 1pt = 352.778 microns.
function ptToMicrons(pt) {
  return Math.round(pt * 352.778);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Always fetch the freshest published build — never serve a stale cached
  // HTML/JS bundle. This means every time the user opens the desktop app
  // (or logs in, which triggers a reload from the renderer), they get the
  // latest code without needing a new GitHub release of the shell.
  win.webContents.session.clearCache().finally(() => {
    win.loadURL(APP_URL, { extraHeaders: "pragma: no-cache\n" });
  });
}

// Tell Chromium not to cache HTTP responses for this shell. The web app is
// the source of truth; we always want the newest version.
app.commandLine.appendSwitch("disable-http-cache");

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: list installed printers ----
ipcMain.handle("printers:list", async (event) => {
  const wc = event.sender;
  try {
    const list = await wc.getPrintersAsync();
    writePrintLog("printers:list", { printers: list.map((p) => p.name) });
    return list.map((p) => p.name);
  } catch (e) {
    writePrintLog("printers:list:error", { error: String(e) });
    console.error("list printers failed", e);
    return [];
  }
});

ipcMain.handle("printers:getPrintLogPath", async () => getPrintLogPath());

ipcMain.handle("printers:debugLog", async (_evt, payload) => {
  writePrintLog("renderer", payload && typeof payload === "object" ? payload : { payload });
  return { ok: true, logPath: getPrintLogPath() };
});

// ---- IPC: silent print a PDF buffer to a named printer ----
ipcMain.handle("printers:printPdf", async (_evt, payload) => {
  const { base64, printerName, silent, pageSize } = payload || {};
  if (!base64 || !printerName) {
    return { ok: false, error: "Missing base64 or printerName" };
  }
  const tmp = path.join(
    os.tmpdir(),
    `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.writeFileSync(tmp, Buffer.from(base64, "base64"));
  // Passing this means labels print at their real size, not scaled to A4.
  const printPageSize =
    pageSize && pageSize.widthPt > 0 && pageSize.heightPt > 0
      ? {
          width: ptToMicrons(pageSize.widthPt),
          height: ptToMicrons(pageSize.heightPt),
        }
      : undefined;
  writePrintLog("printPdf:start", {
    printerName,
    silent: !!silent,
    pageSize,
    chromiumPageSize: printPageSize,
    byteLength: Buffer.byteLength(base64, "base64"),
  });
  return await new Promise((resolve) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, plugins: true },
    });
    w.webContents.on("did-finish-load", () => {
      w.webContents.print(
        {
          silent: !!silent,
          deviceName: printerName,
          color: true,
          printBackground: true,
          margins: { marginType: "none" },
          scaleFactor: 100,
          ...(printPageSize ? { pageSize: printPageSize } : {}),
        },
        (success, failureReason) => {
          try {
            w.close();
          } catch {}
          try {
            fs.unlinkSync(tmp);
          } catch {}
          writePrintLog("printPdf:finish", { printerName, success, failureReason: failureReason || null });
          if (success) resolve({ ok: true, logPath: getPrintLogPath() });
          else resolve({ ok: false, error: failureReason || "Print failed", logPath: getPrintLogPath() });
        },
      );
    });
    w.loadFile(tmp).catch((e) => {
      try {
        w.close();
      } catch {}
      writePrintLog("printPdf:load-error", { printerName, error: String(e) });
      resolve({ ok: false, error: String(e), logPath: getPrintLogPath() });
    });
  });
});

// ---- IPC: silent print already-rasterized label pages ----
ipcMain.handle("printers:printRasterPages", async (_evt, payload) => {
  const { pages, printerName, silent } = payload || {};
  if (!Array.isArray(pages) || pages.length === 0 || !printerName) {
    return { ok: false, error: "Missing pages or printerName" };
  }

  const safePages = pages
    .filter((page) => page && page.pngBase64 && page.widthPt > 0 && page.heightPt > 0)
    .map((page) => ({
      pngBase64: String(page.pngBase64),
      widthPt: Number(page.widthPt),
      heightPt: Number(page.heightPt),
    }));

  if (safePages.length === 0) {
    return { ok: false, error: "No printable pages" };
  }

  writePrintLog("printRasterPages:start", {
    printerName,
    silent: !!silent,
    pageCount: safePages.length,
    firstPageSize: { widthPt: safePages[0].widthPt, heightPt: safePages[0].heightPt },
  });

  const pageCss = safePages
    .map(
      (page, index) => `
        <section class="label-page" style="width:${page.widthPt}pt;height:${page.heightPt}pt;${index === safePages.length - 1 ? "" : "break-after: page;"}">
          <img src="data:image/png;base64,${page.pngBase64}" />
        </section>`,
    )
    .join("");

  const first = safePages[0];
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: ${first.widthPt}pt ${first.heightPt}pt; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; }
          .label-page { margin: 0; padding: 0; background: #fff; overflow: hidden; page-break-inside: avoid; }
          .label-page img { display: block; width: 100%; height: 100%; object-fit: contain; background: #fff; }
        </style>
      </head>
      <body>${pageCss}</body>
      <script>
        window.__labelsReady = Promise.all(
          Array.from(document.images).map((img) =>
            img.decode ? img.decode().catch(() => undefined) : Promise.resolve(),
          ),
        ).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      </script>
    </html>`;

  return await new Promise((resolve) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, plugins: false },
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        w.close();
      } catch {}
      resolve(result);
    };

    w.webContents.on("did-finish-load", async () => {
      try {
        await w.webContents.executeJavaScript("window.__labelsReady", true);
      } catch {}
      w.webContents.print(
        {
          silent: !!silent,
          deviceName: printerName,
          color: true,
          printBackground: true,
          margins: { marginType: "none" },
          scaleFactor: 100,
          pageSize: { width: ptToMicrons(first.widthPt), height: ptToMicrons(first.heightPt) },
        },
        (success, failureReason) => {
          writePrintLog("printRasterPages:finish", {
            printerName,
            success,
            failureReason: failureReason || null,
          });
          if (success) finish({ ok: true, logPath: getPrintLogPath() });
          else finish({ ok: false, error: failureReason || "Print failed", logPath: getPrintLogPath() });
        },
      );
    });

    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((e) => {
      writePrintLog("printRasterPages:load-error", { printerName, error: String(e) });
      finish({ ok: false, error: String(e), logPath: getPrintLogPath() });
    });
  });
});

// ---- IPC: Mintsoft fetch (no CORS) ----
ipcMain.handle("mintsoft:fetch", async (_evt, payload) => {
  const { baseUrl, path: urlPath, method = "GET", headers = {}, body } = payload || {};
  if (!baseUrl || !urlPath) throw new Error("Missing baseUrl/path");
  const target = baseUrl.replace(/\/$/, "") + urlPath;
  return await new Promise((resolve, reject) => {
    const req = net.request({ method, url: target });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, String(v));
    const chunks = [];
    let contentType = "";
    let status = 0;
    req.on("response", (res) => {
      status = res.statusCode;
      const ct = res.headers["content-type"];
      contentType = Array.isArray(ct) ? ct[0] : ct || "";
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status, contentType, body: buf.toString("base64") });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body && !["GET", "HEAD"].includes(method.toUpperCase())) req.write(body);
    req.end();
  });
});
