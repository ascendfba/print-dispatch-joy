const { app, BrowserWindow, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// The desktop app is a thin shell around the live published web app.
// Every time you click Publish → Update in Lovable, the desktop app
// picks up the new version on next launch (or Ctrl+R refresh) — no reinstall.
//
// Override at runtime with:  DISPATCH_URL=https://your-domain.com  DispatchConsole.exe
const APP_URL =
  process.env.DISPATCH_URL ||
  "https://start.ascendfba.co.uk";

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
  win.loadURL(APP_URL);
  // Ctrl+R / F5 reloads to pick up the latest published build.
}

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
    return list.map((p) => p.name);
  } catch (e) {
    console.error("list printers failed", e);
    return [];
  }
});

// ---- IPC: silent print a PDF buffer to a named printer ----
ipcMain.handle("printers:printPdf", async (_evt, payload) => {
  const { base64, printerName, silent } = payload || {};
  if (!base64 || !printerName) {
    return { ok: false, error: "Missing base64 or printerName" };
  }
  const tmp = path.join(os.tmpdir(), `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmp, Buffer.from(base64, "base64"));
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
          color: false,
          printBackground: false,
        },
        (success, failureReason) => {
          try { w.close(); } catch {}
          try { fs.unlinkSync(tmp); } catch {}
          if (success) resolve({ ok: true });
          else resolve({ ok: false, error: failureReason || "Print failed" });
        },
      );
    });
    w.loadFile(tmp).catch((e) => {
      try { w.close(); } catch {}
      resolve({ ok: false, error: String(e) });
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
      try { w.close(); } catch {}
      resolve(result);
    };

    w.webContents.on("did-finish-load", () => {
      w.webContents.print(
        {
          silent: !!silent,
          deviceName: printerName,
          color: false,
          printBackground: true,
          margins: { marginType: "none" },
          scaleFactor: 100,
        },
        (success, failureReason) => {
          if (success) finish({ ok: true });
          else finish({ ok: false, error: failureReason || "Print failed" });
        },
      );
    });

    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((e) => {
      finish({ ok: false, error: String(e) });
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