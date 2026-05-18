# Local print agent

Tiny zero-dependency HTTP server that exposes the printers installed on this
PC so the Dispatch web app can list them in **Settings → Printer**.

## Run

```bash
node agent.cjs
```

You should see:

```
[print-agent] listening on http://127.0.0.1:9911
```

Open `http://127.0.0.1:9911/printers` in your browser to verify — you'll get a
JSON list of printer names.

## Auto-start

- **Windows**: drop a shortcut to `node agent.cjs` in
  `shell:startup` (Win+R → `shell:startup`).
- **macOS**: add a `launchd` plist in `~/Library/LaunchAgents/`.
- **Linux**: add a `systemd --user` unit.

## Requirements

- Node.js 18+ installed (`node --version`).
- On macOS / Linux the `lpstat` command must be available (it ships with CUPS).
- On Windows PowerShell must be available (it is, on Win10 / Win11).

## Endpoints

| Method | Path        | Returns                                |
|--------|-------------|----------------------------------------|
| GET    | `/health`   | `{ ok: true, platform: "win32" }`      |
| GET    | `/printers` | `{ printers: ["HP LaserJet", ...] }`   |

CORS is wide-open by default. To lock it down to your published app:

```bash
ALLOW_ORIGIN=https://print-dispatch-joy.lovable.app node agent.cjs
```