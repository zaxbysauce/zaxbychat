# Windows 11 + Docker Quickstart

A self-contained walkthrough for getting zaxbychat running on a fresh
Windows 11 machine with Docker Desktop. For deeper context on what
ships in the container and how to register external inference
endpoints, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Prerequisites (one-time)

1. Install **Docker Desktop for Windows** from
   <https://www.docker.com/products/docker-desktop/>. Enable the
   **WSL 2** backend during setup (Docker Desktop will prompt).
   Verify in PowerShell:
   ```powershell
   docker --version
   docker compose version
   ```
2. Install **Git for Windows**: <https://git-scm.com/download/win>.

---

## Clone and configure

3. From PowerShell, somewhere you keep code:
   ```powershell
   git clone https://github.com/zaxbysauce/zaxbychat.git
   cd zaxbychat
   ```
4. Create the env file from the template:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Open `.env` in any editor and set, at minimum:
   - `HOST=localhost`
   - `PORT=3080`
   - `MONGO_URI=mongodb://mongodb:27017/LibreChat`
     (use the service name `mongodb`, not `127.0.0.1`, when running
     under Docker Compose)
   - `CREDS_KEY=` and `CREDS_IV=` — generate values with this
     PowerShell snippet:
     ```powershell
     -join ((48..57) + (97..102) | Get-Random -Count 64 | % {[char]$_})  # CREDS_KEY (32 bytes hex)
     -join ((48..57) + (97..102) | Get-Random -Count 32 | % {[char]$_})  # CREDS_IV  (16 bytes hex)
     ```
   - `JWT_SECRET=` and `JWT_REFRESH_SECRET=` — any long random strings.
   - At least one model API key, e.g. `OPENAI_API_KEY=sk-...` or
     `ANTHROPIC_API_KEY=sk-ant-...`.
6. Create the runtime config from the template:
   ```powershell
   Copy-Item librechat.example.yaml librechat.yaml
   ```
   For a basic test, the defaults work — the OpenAI / Anthropic /
   Google endpoints come up automatically once their `*_API_KEY` env
   vars are set. For first-class GitHub citations, uncomment the
   `mcpServers.github:` block (see `librechat.example.yaml`) and set
   `GITHUB_PAT` in `.env`.

---

## Build the zaxbychat image

> **Critical:** The default `docker-compose.yml` pulls
> `registry.librechat.ai/danny-avila/librechat-dev:latest` — that's
> upstream LibreChat, **not** zaxbychat. To run the
> Perplexity-migration code (council mode, GitHub first-class,
> normalized citations, etc.) you must build from source via a
> `docker-compose.override.yml` that points the `api` service at the
> local `Dockerfile`. The override also mounts `librechat.yaml` into
> the container — without it, none of the runtime config you put in
> `librechat.yaml` is visible to the running app.

7. Create `docker-compose.override.yml` with the local-build directive
   and the `librechat.yaml` mount:
   ```powershell
   @"
   services:
     api:
       image: zaxbychat
       build:
         context: .
         target: node
       volumes:
       - type: bind
         source: ./librechat.yaml
         target: /app/librechat.yaml
   "@ | Out-File -Encoding utf8 -FilePath docker-compose.override.yml
   ```

## Boot

8. Build and start (first build takes 5–15 minutes; subsequent builds
   are cached):
   ```powershell
   docker compose build api
   docker compose up -d
   ```
   First run also pulls MongoDB, MeiliSearch, and the optional RAG API
   + vector store images.
9. Tail the API logs while it starts:
   ```powershell
   docker compose logs -f api
   ```
   Wait for `Server listening on all interfaces at port 3080`.

---

## Use it

10. Open <http://localhost:3080> in a browser. Register the first user
    — that account becomes the admin.
11. Open a chat, pick a model from the endpoint dropdown, and confirm
    a basic round-trip works.

### Confirm you're running zaxbychat (not upstream LibreChat)

```powershell
docker compose exec api cat /app/CHANGELOG.md | Select-Object -First 3
```

The first line should be `# Changelog`; line 3 should mention the
Perplexity-style migration. If you see "No such file or directory" or
upstream-LibreChat content, your `docker-compose.override.yml` is not
being picked up — confirm it's in the repo root next to
`docker-compose.yml`, then `docker compose down && docker compose build api && docker compose up -d`.

---

## Enable and verify the Perplexity-migration features

Most surfaces are activated by entries in `librechat.yaml`. Reload
after every edit with `docker compose restart api`.

| Feature | How to enable | How to verify |
|---|---|---|
| **Custom AI providers** (always available) | `endpoints.custom: [{ name: "...", apiKey: "${MY_KEY}", baseURL: "https://...", models: { default: ["model-id"] } }]`. Standard LibreChat behavior; not migration-specific. | The endpoint name appears in the model dropdown. |
| **Capability-aware UI + pre-Run gate** (Phase 2) | Add `modelSpecs.list[*].capabilities: ["vision","tools","structured_output","web_search","file_search","actions","execute_code"]` per model. See `librechat.example.yaml` for a sample modelSpec. | Select a vision-capable spec — image-attach appears; select a text-only spec — it disappears. Sending a vision part to a non-vision model returns an error. |
| **Council mode** (Phase 4) | `interface.council: true` in `librechat.yaml`. | Composer gains a "Council" toggle; flipping it on reveals strategy + model pickers (up to three legs). |
| **Web-search citations** (Phase 5) | `webSearch.searchProvider: serper` (or `searxng`) plus `SERPER_API_KEY` in `.env`. | Ask a question requiring web search; assistant message shows clickable inline `[1]`-style anchors and a sources panel. |
| **File-search citations** (Phase 5) | The bundled `rag_api` service is started by default; ensure `endpoints.agents.capabilities` includes `file_search`. Upload a file, attach it to a chat. | Same as web — sources panel shows file id + page numbers. |
| **GitHub first-class** (Phase 7) | Uncomment the `mcpServers.github:` block in `librechat.example.yaml`, set `GITHUB_PAT` in `.env`. | Composer surfaces a "GitHub Context" picker; selecting a repo/file/PR/issue and asking a grounded question produces `kindSpecific.kind: 'github'` citations. |
| **Retrieval donor ports** (Phase 6) | No runtime activation — these are library modules under `packages/api/src/retrieval/`, intentionally not wired into any active call path. They're available for future composition. | `docker compose exec api ls /app/packages/api/dist/retrieval/` shows `fusion.js`, `prompt.js`, `documents.js`, `schema.js`, `query.js`. |

---

## Common operations

| Task | Command |
|---|---|
| Stop everything | `docker compose down` |
| Stop and wipe data | `docker compose down -v` *(deletes Mongo + Meili volumes)* |
| Pull a newer image and restart | `docker compose pull && docker compose up -d` |
| Restart only the API after config changes | `docker compose restart api` |
| Tail all service logs | `docker compose logs -f` |

---

## Gotchas on Windows

- **WSL 2 backend is required.** Hyper-V backend will not bring up the
  bundled MongoDB cleanly.
- **Line endings.** If you edited `.env` in a Windows editor that
  converted to CRLF, `docker compose` is usually fine, but
  PowerShell-pasted secrets sometimes pick up trailing CR. If a
  service complains about an env var, re-paste in `notepad.exe`.
- **Port 3080 must be free.** If something else is using it, set
  `PORT=3090` in `.env` and `docker compose down && docker compose up -d`.
- **WSL filesystem performance.** Keep the repo on the WSL filesystem
  (e.g. `\\wsl$\Ubuntu\home\<you>\zaxbychat`) for faster bind-mount
  performance; less critical for runtime use than for build.
