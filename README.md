# gitsync — GitHub ⇄ Azure DevOps Repo Sync

Keeps a GitHub repo and an Azure DevOps Repos repo in sync, for as many repo pairs
("connections") as you want, with a small web GUI to manage connections and watch
sync logs. **GitHub is treated as the source of truth** — Azure DevOps is meant to
mirror it, and anything Azure DevOps has that GitHub doesn't requires your explicit
approval before it touches anything (see "How syncing works" below).

- Polls both sides on a configurable interval per connection (no webhooks, no inbound
  exposure required).
- Pushes GitHub → Azure DevOps automatically whenever GitHub is ahead. Pauses and
  asks you to decide whenever Azure DevOps has changes GitHub doesn't.
- Single Docker image, single SQLite file + local git mirrors on one volume, PATs
  encrypted at rest, single-user login for the GUI.

## Running it on Unraid

1. Create a folder for this app's config, e.g. `/mnt/user/appdata/gitsync/`.
2. Create `docker-compose.yml` in that folder with the contents below. This uses a
   bind mount to `/mnt/user/appdata/GithubAzureSync` for the app's data — change that
   path if you'd rather use a different folder, or swap it for a Docker-managed named
   volume like the one in the repo's own `docker-compose.yml` if you don't need to
   browse the data directly:
   ```yaml
   services:
     gitsync:
       image: ghcr.io/karlmit/git-azure-repo-sync:latest
       container_name: gitsync
       restart: unless-stopped
       ports:
         - "3012:3012"
       env_file:
         - .env
       environment:
         PORT: "3012"
         HOST: "0.0.0.0"
         DB_PATH: "/data/app.db"
         MIRROR_ROOT: "/data/mirrors"
         PUID: "${PUID:-1000}"
         PGID: "${PGID:-1000}"
         NOTIFY_WEBHOOK_URL: "${NOTIFY_WEBHOOK_URL:-}"
         APP_BASE_URL: "${APP_BASE_URL:-}"
       volumes:
         - /mnt/user/appdata/GithubAzureSync:/data
       healthcheck:
         test: ["CMD", "node", "-e", "fetch('http://localhost:3012/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
         interval: 30s
         timeout: 5s
         retries: 3
   ```
   This bind-mounts `/mnt/user/appdata/GithubAzureSync` directly rather than using a
   Docker-managed named volume, so you can browse the SQLite database and git mirrors
   from the Unraid file browser. The container starts as root, `chown`s that folder to
   `PUID:PGID`, then drops to that user before running anything — so it works
   regardless of what the folder was owned by beforehand, no manual `chown` needed.
   `PUID`/`PGID` default to `1000:1000`; set them to `99`/`100` in your `.env` (below)
   instead if you'd rather match the `nobody:users` ownership your other shares
   already use.
3. In that **same folder**, create a file named `.env` next to `docker-compose.yml`
   (`docker-compose.yml` won't start without it — `env_file: [.env]` expects it to
   exist there). See [Environment variables](#environment-variables) below for the
   full list and what each one does — `APP_USERNAME`, `APP_PASSWORD`, and
   `ENCRYPTION_KEY` are required, everything else is optional.

   (If you'd rather start from the repo's own template instead of typing it out by
   hand: `curl -O https://raw.githubusercontent.com/Karlmit/Git-Azure-Repo-Sync/main/.env.example`,
   then `mv .env.example .env` and fill in the placeholders.)
4. From that folder, run:
   ```
   docker compose up -d
   ```
5. Browse to `http://<your-unraid-ip>:3012`, log in, and click **Add Connection** to
   wire up a GitHub repo and an Azure DevOps repo. You'll need a PAT for each side:
   - GitHub: a personal access token with `repo` scope.
   - Azure DevOps: a PAT with `Code (Read & Write)` scope.

### Environment variables

Everything gitsync reads from `.env`. Only the first three are required:

```
APP_USERNAME=choose-a-username
APP_PASSWORD=choose-a-strong-password
ENCRYPTION_KEY=paste-the-output-of-the-command-below-here

PUID=1000
PGID=1000

NOTIFY_WEBHOOK_URL=
APP_BASE_URL=

LOG_LEVEL=info
DEFAULT_POLL_INTERVAL_MINUTES=2
LOG_RETENTION_DAYS=30
LOG_MAX_ROWS_PER_CONNECTION=2000
```

- **`APP_USERNAME` / `APP_PASSWORD`** *(required)* — login for the gitsync web GUI.
- **`ENCRYPTION_KEY`** *(required)* — a 32-byte key, base64-encoded. Generate one
  with `openssl rand -base64 32` and paste the exact output, with no extra quotes.
  This encrypts the GitHub/Azure DevOps PATs you'll enter later, at rest in the
  SQLite database.
- **`PUID` / `PGID`** *(optional, default `1000`/`1000`)* — only matters if you're
  using a bind mount for `/data`. The container starts as root, `chown`s that
  folder to this user, then drops to it before running anything, so a bind mount
  works regardless of what it was owned by beforehand. Set these to `99`/`100` if
  you'd rather match the `nobody:users` ownership your other Unraid shares use.
- **`NOTIFY_WEBHOOK_URL`** *(optional)* — when set, gitsync sends an HTTP POST here
  the moment a ref newly needs your approval (once per new pause, not repeatedly
  while it stays unresolved). See "Getting notified when something needs approval"
  below for the request format and example setups.
- **`APP_BASE_URL`** *(optional)* — e.g. `http://192.168.1.66:3012`, wherever this
  instance is reachable on your LAN. When set, notifications include a direct link
  to the connection that needs attention. Update this if that IP ever changes.
- **`LOG_LEVEL`** *(optional, default `info`)* — `debug`, `info`, `warn`, or `error`.
- **`DEFAULT_POLL_INTERVAL_MINUTES`** *(optional, default `2`)* — how often a newly
  created connection polls, until you change it per-connection in the GUI.
- **`LOG_RETENTION_DAYS`** *(optional, default `30`)* — sync log rows older than
  this get pruned daily.
- **`LOG_MAX_ROWS_PER_CONNECTION`** *(optional, default `2000`)* — a hard cap on
  log rows kept per connection, checked after every sync.

### Getting updates

New versions are published as GitHub Releases and pushed to
`ghcr.io/karlmit/git-azure-repo-sync` under both a version tag and `:latest`. To pick
up a new release:

```
docker compose pull && docker compose up -d
```

Unraid's own Docker UI "check for updates" also detects new images for containers
running the `:latest` tag, if you'd rather update from there.

## Local development

```
npm install
npm run dev:backend    # Fastify API on :3012 (needs APP_USERNAME/APP_PASSWORD/ENCRYPTION_KEY env vars)
npm run dev:frontend   # Vite dev server, proxies /api to :3012
```

Run the backend test suite (spins up throwaway local bare git repos, no network or
real credentials needed):

```
npm test
```

## Cutting a release

1. Bump `version` in `packages/backend/package.json` to match the tag you're about
   to cut (kept as local dev metadata; the actual shipped image version comes from
   the git tag itself).
2. Commit that change.
3. Tag and push:
   ```
   git tag v1.2.0
   git push origin v1.2.0
   ```
4. `.github/workflows/release.yml` builds the image, pushes
   `ghcr.io/karlmit/git-azure-repo-sync:1.2.0` and `:latest`, and publishes a GitHub
   Release with auto-generated notes. No secrets need to be configured — it uses the
   automatically provided `GITHUB_TOKEN`.

## How syncing works

GitHub is authoritative. For each branch/tag, on every poll:

- **If GitHub is ahead or equal, Azure DevOps is updated automatically** — this
  covers a new commit, a brand-new GitHub branch, or GitHub deleting a branch it
  used to have (that deletion propagates to Azure DevOps too). No confirmation
  needed, since nothing on Azure DevOps is ever at risk of being lost this way.
- **If Azure DevOps has anything GitHub doesn't, or is missing something GitHub
  still has — nothing is pushed automatically.** This covers four cases, all
  treated identically: Azure DevOps is cleanly ahead (someone pushed there directly
  while you were working from GitHub), the two sides have truly diverged (including
  totally unrelated histories — e.g. a brand-new Azure DevOps repo that
  auto-created its own initial commit), a branch exists only on Azure DevOps and
  has never been seen before, or Azure DevOps lost a branch that GitHub still has
  (accidentally or otherwise). In every case, nothing is touched on either side,
  the connection's status flips to `conflict`, and it shows up under "Needs your
  decision" on the connection's detail page with both sides' commit context (SHA,
  timestamp, message, or "doesn't exist"/"deleted" as appropriate) shown side by
  side. You choose: **make GitHub match Azure DevOps** (pulling Azure DevOps's
  version in, or deleting from GitHub if Azure DevOps doesn't have it), or **make
  Azure DevOps match GitHub** (pushing GitHub's version over it, restoring it if
  Azure DevOps deleted it, or deleting it from Azure DevOps if GitHub never had it).
  Only then does anything get pushed. If the two sides resolve themselves before you
  get to it (e.g. someone fast-forwards one onto the other outside gitsync), the
  pending conflict just disappears on the next poll — nothing to clean up.

This direction was a deliberate design choice after an early version auto-resolved
divergence by picking whichever side had the most recent commit *timestamp* —
which sounds reasonable until one side is a freshly created, essentially-empty repo
whose auto-generated initial commit is chronologically newer than real work sitting
on the other side. Timestamps can't tell "real work" from "placeholder commit," and
a purely symmetric model has no natural notion of which side to trust more, so
gitsync now treats GitHub as ground truth and never silently discards anything from
it — a human always makes that call for anything arriving from Azure DevOps.

## Getting notified when something needs approval

Set `NOTIFY_WEBHOOK_URL` in your `.env` to get pinged the moment a ref newly needs
your decision, instead of only finding out next time you happen to open the app.
It fires once per new pause, not repeatedly on every poll while something stays
unresolved — so it won't spam you for as long as an item sits waiting.

gitsync sends an HTTP POST to that URL with a JSON body:

```json
{ "message": "<b>gitsync:</b> connection \"Helpy\" needs your decision on 1 ref: ..." }
```

`message` is HTML — a short summary naming the connection and, for each newly
paused ref, its GitHub and Azure DevOps state (commit message, short SHA,
timestamp, or "doesn't exist"/"deleted" as appropriate). This is intentionally
generic so it can feed almost any automation that accepts an HTTP-triggered
webhook with an HTML string, e.g.:

- A **Power Automate** cloud flow with an HTTP "When a HTTP request is received"
  (or the newer direct-invoke) trigger, feeding the `message` field straight into
  a "Post a message to myself/a channel (HTML)" Teams action — this is the exact
  setup this feature was originally built against.
- A Slack or Discord incoming webhook (you'd need a small transform step, since
  those expect their own JSON shape rather than a raw HTML string).
- Anything else that can receive a JSON POST.

Also set `APP_BASE_URL` (e.g. `http://192.168.1.66:3012`, your Unraid box's LAN IP
and the port from `docker-compose.yml`) to have the message include a link straight
to the connection that needs attention, instead of having to go find it yourself.
Update it if that IP ever changes.

If the webhook call fails (unreachable, wrong URL, auth rejected), that failure is
logged as a warning on the connection but never fails the sync itself — a broken
notification target can't block syncing.

## Security notes

- PATs are encrypted at rest (AES-256-GCM) and are never returned by the API once
  saved — only a "is a PAT set" boolean.
- The GUI requires login; nothing in `/api/*` is reachable without a valid session,
  except `/api/health` and `/api/login` themselves.
- `.env`, `secrets/`, and `data/` are gitignored — never commit real credentials or
  the SQLite database to this repo.
