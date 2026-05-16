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
  "https://project--484fae32-a6a4-4c64-8416-14ca1d53c6c9.lovable.app";

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
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    w.webContents.on("did-finish-load", () => {
      w.webContents.print(
        {
          silent: !!silent,
          deviceName: printerName,
          printBackground: true,
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