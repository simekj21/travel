# Travel

Photo gallery site for travel.avalax.eu — vanilla JS/CSS frontend backed by a
small PHP API, no build step, no framework, no package.json.

## Stack & layout

- `index.html` — single page, all UI markup lives here.
- `js/app.js` — all frontend logic (single IIFE, no modules/bundler).
- `js/countries.js`, `js/world-map-data.js` — static country list / SVG map path data.
- `css/style.css` — all styling.
- `api/*.php` — backend endpoints (photos, tags, events, settings, auth, upload, import, delete). No framework, plain PHP files.
- `data/*.json` — runtime state (photos, tags, events, settings). Not in git (server-only, see `.gitignore`) except empty `.gitkeep`.
- `uploads/originals/`, `uploads/thumbs/` — uploaded images. Not in git.
- `actions/` — import source for **Travel mode**: one subfolder per "akce" (event/trip), imported via the file-management panel.
- `photos/` — import source for **Photo mode**: flat folder of images, imported directly (no event grouping).
- `api/config.php` — admin PIN hash + secret, **is** committed to git (already existed before; don't add real secrets to other tracked files).

The site has two modes (`platformSettings.siteMode`, toggled in the admin config panel): **Travel** (map, events, tags, country filter, admin folder-based import from `actions/`) and **Photo** (hero layout, flat import from `photos/`, most filters hidden).

## Dev workflow

- Work happens on a feature branch (e.g. `claude/travel-*`), commit there as usual.
- **Deploy = push to `main`.** There is no PR-gate for deploys — `.github/workflows/deploy.yml` runs on every push to `main` and FTP-deploys the whole repo (minus `uploads/originals`, `uploads/thumbs`, `actions/`, `photos/`, and the `data/*.json` runtime files) to travel.avalax.eu via `SamKirkland/FTP-Deploy-Action`. Credentials are in repo secrets (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`).
- Standard flow once a change is committed and tested locally: push the feature branch, then fast-forward `main` to it (`git push origin <branch>:main`) to trigger the live deploy — same as merging directly, no PR needed unless the user asks for one explicitly.
- `index.html` contains a `__BUILD__` placeholder for cache-busting asset URLs; the deploy workflow replaces it with the commit SHA. Locally/in dev it's just left as the literal string.

## Testing locally

No test suite. To eyeball changes: run `php -S 127.0.0.1:PORT` from the repo root (the PHP API reads/writes `data/*.json` and `uploads/`), then drive it with a headless browser (Playwright via `NODE_PATH=$(npm root -g) node script.js`, `/opt/pw-browsers/chromium`). Seed `data/photos.json` with a couple of fake records (see `api/upload.php` for the record shape) if you need photos to test filtering/map behavior — delete the seeded file and any test uploads again afterwards so nothing fake gets deployed.
