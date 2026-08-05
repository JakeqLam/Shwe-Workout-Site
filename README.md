# Plu's Workout Tracker

A local-first workout tracker with:

- The pastel kawaii single-page interface in `docs/index.html`
- A zero-dependency Node.js web server
- A local SQLite database in `data/workouts.db`
- Automatic migration of existing browser-saved workouts into SQLite
- Browser draft/checklist recovery
- JSON backup/restore and CSV export
- Optional GitHub Pages hosting for the static frontend

## Recommended first setup: local app + local SQLite

### Requirements

Install **Node.js 24 LTS**. Node.js 22.16 or newer also works.

This project uses Node's built-in `node:sqlite` module, so there is no `npm install` step and no external database service.

### Start on this computer only

Open PowerShell in this folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

Then open:

```text
http://127.0.0.1:3000
```

The first saved workout creates:

```text
data\workouts.db
```

### Allow another device on the same Wi-Fi

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -Lan
```

Find the host computer's IPv4 address:

```powershell
ipconfig
```

On the other device, open:

```text
http://YOUR-PC-IP:3000
```

For example:

```text
http://192.168.1.123:3000
```

Windows Firewall may ask whether Node.js can accept private-network connections. Allow **Private networks** only.

No router port forwarding is needed for same-Wi-Fi access.

## Data behavior

When the local server is available, the page shows **SQLite database connected** and saves workouts through the API.

The following remain in browser storage because they are temporary/per-device UI state:

- The currently checked exercise boxes
- An unfinished form draft
- A cached copy of workouts for fallback/export

On the first database connection, existing workouts from the earlier local-storage version are merged into SQLite automatically.

## Back up the database file

Stop the server, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backup-database.ps1
```

A timestamped copy is written into `backups\`.

The webpage's **Back up data** button also exports portable JSON.

## API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Server/database status |
| `GET` | `/api/workouts` | List workouts |
| `POST` | `/api/workouts` | Save one workout |
| `DELETE` | `/api/workouts/:id` | Delete one workout |
| `DELETE` | `/api/workouts` | Delete all workouts |
| `POST` | `/api/workouts/import` | Merge or replace from a backup |

## GitHub Pages

GitHub Pages can host the `docs` folder because the frontend is plain HTML, CSS, and JavaScript.

1. Create a GitHub repository and place this project in it.
2. Push the repository to GitHub.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select your main branch and the `/docs` folder.
6. Save.

With the default `docs/config.js`, the GitHub Pages version intentionally uses **browser-only storage**. That gives you a hosted static copy immediately, but it does not connect to the SQLite database.

### Connecting GitHub Pages to SQLite later

A GitHub Pages site is HTTPS. It cannot reliably call a plain HTTP API running only on a home computer. To connect the Pages frontend to SQLite later:

1. Put this API behind an **HTTPS** address using a private VPN or secure tunnel.
2. Add authentication before exposing it outside the home network.
3. Set `apiBaseUrl` in `docs/config.js`:

```js
window.PLUS_TRACKER_CONFIG = {
  apiBaseUrl: "https://your-secure-api.example.com",
  useDatabase: true
};
```

4. Start the API with the GitHub Pages origin allowed:

```powershell
$env:ALLOWED_ORIGIN="https://YOUR-GITHUB-USERNAME.github.io"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -Lan
```

Do **not** port-forward this unauthenticated API directly to the public internet.

## Repository layout

```text
plus-workout-tracker-local/
├── server.mjs
├── package.json
├── start-local.ps1
├── backup-database.ps1
├── README.md
├── docs/
│   ├── .nojekyll
│   ├── config.js
│   └── index.html
├── data/
│   └── .gitkeep
└── backups/
    └── .gitkeep
```
