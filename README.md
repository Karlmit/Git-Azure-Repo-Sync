# gitsync — GitHub ⇄ Azure DevOps Repo Sync

Keeps a GitHub repo and an Azure DevOps Repos repo in sync in both directions, for as
many repo pairs ("connections") as you want, with a small web GUI to manage
connections and watch sync logs.

- Polls both sides on a configurable interval per connection (no webhooks, no inbound
  exposure required).
- Fast-forwards cleanly when one side is simply behind; if the two sides have
  genuinely diverged, it force-pushes whichever side has the most recent commit over
  the other and logs it clearly (last-write-wins, by design — see below).
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
   exist there). It needs exactly these three keys:
   ```
   APP_USERNAME=choose-a-username
   APP_PASSWORD=choose-a-strong-password
   ENCRYPTION_KEY=paste-the-output-of-the-command-below-here
   ```
   - `APP_USERNAME` / `APP_PASSWORD` — login for the gitsync web GUI.
   - `ENCRYPTION_KEY` — a 32-byte key, base64-encoded. Generate one with:
     ```
     openssl rand -base64 32
     ```
     This encrypts the GitHub/Azure DevOps PATs you'll enter later, at rest in the
     SQLite database. Paste the exact output as the value, with no extra quotes.

   Optionally add `PUID=99` and `PGID=100` if you're using a bind mount and want it
   owned by Unraid's usual `nobody:users` instead of the `1000:1000` default.

   (If you'd rather start from the repo's own template instead of typing the above
   by hand: `curl -O https://raw.githubusercontent.com/Karlmit/Git-Azure-Repo-Sync/main/.env.example`,
   then `mv .env.example .env` and fill in the placeholders.)
4. From that folder, run:
   ```
   docker compose up -d
   ```
5. Browse to `http://<your-unraid-ip>:3012`, log in, and click **Add Connection** to
   wire up a GitHub repo and an Azure DevOps repo. You'll need a PAT for each side:
   - GitHub: a personal access token with `repo` scope.
   - Azure DevOps: a PAT with `Code (Read & Write)` scope.

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

## How conflicts are handled

For each branch/tag, on every poll:

- If one side is a clean fast-forward of the other, it's fast-forwarded — no data
  loss possible.
- If the two sides have diverged (including totally unrelated histories), whichever
  side has the more recently committed change wins and is force-pushed over the
  other side. This is logged as a `FORCE-OVERWRITE` entry in that connection's log,
  naming which side won and why, so it's never silent.

This is intentionally simple rather than attempting an automatic merge. If you need
finer-grained conflict resolution, treat a `conflict` status badge as a signal to go
look at the log and reconcile manually before it happens again.

## Security notes

- PATs are encrypted at rest (AES-256-GCM) and are never returned by the API once
  saved — only a "is a PAT set" boolean.
- The GUI requires login; nothing in `/api/*` is reachable without a valid session,
  except `/api/health` and `/api/login` themselves.
- `.env`, `secrets/`, and `data/` are gitignored — never commit real credentials or
  the SQLite database to this repo.
