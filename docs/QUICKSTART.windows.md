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

## Boot

7. From the repo root:
   ```powershell
   docker compose up -d
   ```
   First boot pulls the LibreChat image plus MongoDB, MeiliSearch, and
   the optional RAG API + vector store. Allow 1–3 minutes the first
   time.
8. Tail the API logs while it starts:
   ```powershell
   docker compose logs -f api
   ```
   Wait for `Server listening on all interfaces at port 3080`.

---

## Use it

9. Open <http://localhost:3080> in a browser. Register the first user
   — that account becomes the admin.
10. Open a chat, pick a model from the endpoint dropdown, and confirm
    a basic round-trip works.

---

## Verify the Perplexity-migration features

Once a basic chat works, verify the v0.9.0 surfaces:

| Feature | How to verify |
|---|---|
| **Capability gating** (Phase 2) | Select a vision-capable model — image-attach affordance appears; select a text-only model — it disappears. |
| **Council mode** (Phase 4) | In `librechat.yaml`, set `interface.council: true`, then `docker compose restart api`. The composer shows a "Council" toggle and per-leg model picker. |
| **Citations** (Phase 5) | Any web-search or file-search tool call now persists `sources[]` on the assistant message; UI shows clickable inline anchors and a sources panel. |
| **GitHub first-class** (Phase 7) | Add a `kind: 'github'` MCP server to `librechat.yaml.mcpServers` (commented example provided). The chat composer shows a "GitHub Context" picker; `get_file_contents` and friends emit `kindSpecific.kind: 'github'` citations. |

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
