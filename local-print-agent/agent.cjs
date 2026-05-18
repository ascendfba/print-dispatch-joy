#!/usr/bin/env node
/**
 * Tiny local print agent
 * ----------------------
 * Exposes the list of printers installed on this machine over HTTP so the
 * Dispatch web app can populate its printer dropdowns without packaging
 * Electron or paying for PrintNode.
 *
 * Usage:
 *   node agent.cjs               # listens on http://127.0.0.1:9911
 *   PORT=9000 node agent.cjs     # override port
 *
 * Endpoints:
 *   GET  /printers   -> { printers: string[] }
 *   GET  /health     -> { ok: true }
 *
 * No dependencies. Works on Node 18+.
 */
const http = require("http");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT || 9911);
// Allowed origins for CORS. Add your published / preview URLs here.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function listPrinters() {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd;
    if (platform === "win32") {
      // PowerShell — works on Win10/11 without WMIC.
      cmd =
        'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"';
    } else if (platform === "darwin" || platform === "linux") {
      cmd = "lpstat -p 2>/dev/null | awk '{print $2}'";
    } else {
      return resolve([]);
    }
    exec(cmd, { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve([]);
      const names = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(Array.from(new Set(names)));
    });
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, platform: process.platform }));
  }
  if (req.method === "GET" && req.url === "/printers") {
    try {
      const printers = await listPrinters();
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ printers }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  }
  res.statusCode = 404;
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[print-agent] listening on http://127.0.0.1:${PORT}`);
  console.log(`[print-agent] platform: ${process.platform}`);
});