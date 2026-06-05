# Security Review — Go-High-Level-MCP-2026-Complete

**Reviewer:** Claude Code, on behalf of Justin James
**Date:** 2026-05-30
**Method:** Static source review of the whole repo, **plus** a dynamic network-egress
test of the built server + clients in a network-isolated Docker sandbox with dummy
credentials (see "Dynamic analysis" below).
**Scope:** Whole repo — `src/` runtime, `mcp-apps/` subproject, `scripts/`, both
`package.json` + lockfiles, `.github/` CI, and the large generated JSON/HTML artifacts.

---

## Verdict

**SAFE TO RUN — with conditions.**

I found **no malware, no backdoors, no data-exfiltration mechanism, and no obfuscated
or download-and-execute code.** Every outbound network call in the source goes to a
legitimate GoHighLevel or Google (Firebase) endpoint. Credentials are read from
environment variables / a local `.env` and are sent only to GoHighLevel. There is no
telemetry, analytics, or "phone home."

The caveats that drop this from an unconditional pass are *hygiene and provenance*
issues, not malice: leftover artifacts from the original author's personal environment,
an undocumented internal GHL API path, one moderate transitive dependency CVE, and the
generic risk of running any unaudited third-party code with a live API key. All are
addressed in **Recommendations** below.

A dynamic sandbox run (below) **confirmed the static conclusion at the network layer**:
when actually executed with dummy credentials, the server and all three client paths
reached out to only `services.leadconnectorhq.com` and `securetoken.googleapis.com`
(Google/Firebase), both over HTTPS/443, and nothing else.

---

## Dynamic analysis (sandboxed runtime observation)

To catch any exfiltration that static review could miss (e.g. traffic the code makes but
doesn't log), I built and ran the project inside a disposable, network-monitored Docker
container — harness lives in a sibling dir, `../ghl-mcp-sandbox/`, leaving this repo
untouched.

**Setup:**
- `node:20-bookworm-slim`; `npm ci` from the lockfile; `npm run build`.
- **Dummy credentials only** (`GHL_API_KEY=dummy-key`, etc.) — no real secret was ever
  present in the container, so even successful egress could leak nothing.
- `tcpdump` captured all DNS queries and TCP SYNs for the duration.
- Exercised: (1) the real server `dist/main.js` (runs `testConnection()` on boot), and
  (2) a harness driving all three outbound code paths — the main public API client, the
  workflow-builder **v2-JWT** refresh path, and the workflow-builder **Firebase** refresh
  path.
- Container hardening: Docker default capability set (no `SYS_ADMIN`/`NET_ADMIN`),
  `--memory 512m --pids-limit 256`, **no host bind mounts** (artifacts pulled via
  `docker cp`).

**Observed egress (the entire list):**

| Destination | Resolved IP (owner) | Port | Triggered by |
|-------------|---------------------|------|--------------|
| `services.leadconnectorhq.com` | 172.64.153.218 (Cloudflare, fronting GHL) | 443 | main API `testConnection` / contacts call; workflow JWT refresh (`/auth/refresh`) |
| `securetoken.googleapis.com` | 142.251.32.170 (Google) | 443 | workflow-builder Firebase token refresh |

- **DNS:** only those two names were ever queried. No other domain, no IP-literal connect.
- **Ports:** every TCP SYN went to **:443**. No plaintext, no odd ports, no beaconing.
- The endpoints returned genuine auth errors (`401 Invalid JWT`, `400 API key not valid`),
  proving the traffic reached the real GHL/Google services.

**Caveat on coverage:** because dummy creds can't complete a token exchange, the flow
never advanced to `backend.leadconnectorhq.com/workflow` (the internal API of Finding #4)
— that host is only reached *after* a valid token. Static analysis already confirmed it is
the sole remaining hardcoded host, so the combined static+dynamic picture is complete.

**Reproduce:** `cd ../ghl-mcp-sandbox && ./run.sh` (prints a PASS/FLAG verdict and writes
raw capture to `cap/`). Cleanup: `docker rmi ghl-mcp-sandbox:latest` and delete the
`ghl-mcp-sandbox/` dir.

---

## Findings

| # | Severity | File:line | Issue | Fix |
|---|----------|-----------|-------|-----|
| 1 | Low | [workflow-builder-client.ts:100](src/clients/workflow-builder-client.ts:100) | Hardcoded fallback to a stranger's home dir: `process.env.HOME \|\| '/Users/jakeshore'`. Provenance smell, not exploitable (path won't exist on your machine). | Replace with `os.homedir()`; drop the literal. |
| 2 | Low | [workflow-builder-client.ts:126-127](src/clients/workflow-builder-client.ts:126) | Hardcoded fallback `locationId`/`userId` (the original author's GHL IDs: `DZEpRd43MxUJKdtrev9t`, `8Uy3ls0B517vLO2tSNva`). If you ever ran a workflow tool without setting these, calls would target the author's account, not yours. | Remove the fallbacks; require the env vars. |
| 3 | Low | [workflow-builder-client.ts:248-266](src/clients/workflow-builder-client.ts:248) | `persistToken()` rewrites rotated GHL/Firebase refresh tokens back into a `.env` file on disk. Local-only (no network side-channel), and a no-op unless the target file already exists — but plaintext long-lived tokens on disk can leak via backup/git. | Acceptable if `.env` is git-ignored (it is). Be aware tokens get written; rotate if leaked. |
| 4 | Low | [workflow-builder-client.ts:84](src/clients/workflow-builder-client.ts:84), [getHeaders/refresh](src/clients/workflow-builder-client.ts:148) | Uses an **undocumented internal** GHL API (`backend.leadconnectorhq.com/workflow`) authenticated via reverse-engineered Firebase / v2-JWT token exchange. Not malicious, but using a private API may violate GHL Terms and risk account suspension; it also requires storing long-lived refresh tokens. | See "Workflow-builder path" below. Disable/avoid unless you specifically need workflow create/edit. |
| 5 | Moderate | both lockfiles (`qs` 6.x via `express`) | Transitive `qs` DoS — `qs.stringify` can crash on null/undefined entries in comma-format arrays ([GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26)). DoS only; no data exposure. | `npm audit fix` in repo root and in `mcp-apps/`. |
| 6 | Info | [main.ts:92-98](src/main.ts:92), [execute-route.ts:54-61](src/execute-route.ts:54) | The HTTP `/mcp` and execute routes accept a per-request `x-ghl-access-token` / `x-ghl-location-id` header (multi-tenant by design). The token is forwarded only to GHL. Fine for localhost; risky if the port is exposed to a network. | Bind to localhost; never expose the port publicly without auth in front. |
| 7 | Info | [main.ts:75-77](src/main.ts:75) | CORS allow-list includes `chatgpt.com` + `chat.openai.com` (expected for an MCP server used by those clients). Inbound only — does not send data there. | No action; remove the entries if you won't use those clients. |
| 8 | Info | [scan-ghl-api-coverage.mjs:10](scripts/scan-ghl-api-coverage.mjs:10), [:30](scripts/scan-ghl-api-coverage.mjs:30) | Dev/CI API-drift script `git clone`s `github.com/GoHighLevel/highlevel-api-docs` and fetches GHL changelog pages. Runs **only** via `npm run scan:ghl-api` / the scheduled GitHub Action — **not** part of the server runtime. | No action if you don't run `scan:ghl-api`. The cloned content is data, never executed. |

---

## What I verified clean (the three things you cared about)

### 1. No malware / nefarious code
- **No dynamic code execution in the server runtime.** `src/` contains **zero**
  `eval`, `new Function`, `vm`, `child_process`, `exec*`, or `spawn`.
- `child_process` appears in exactly two **dev-only** scripts and is benign:
  - [ghl-mcp.mjs:185,278](scripts/ghl-mcp.mjs:185) — `spawnSync('npm', ['run', …], {shell:false})` with static args (no user input).
  - [scan-ghl-api-coverage.mjs:88](scripts/scan-ghl-api-coverage.mjs:88) — `execFileSync('git', …)` to clone the GHL docs repo.
- All `import()` calls are **local** file loads of the project's own compiled `dist/`
  output ([mcp-apps/server.ts:698](mcp-apps/server.ts:698), [ghl-mcp.mjs:283](scripts/ghl-mcp.mjs:283)) — no remote module loading.
- **No TLS verification disabling** anywhere (`rejectUnauthorized` / `NODE_TLS_*` absent).
- **No** committed binaries, native `.node` addons, `.wasm`, or minified/obfuscated blobs.
- **No** lifecycle install hooks (`preinstall`/`postinstall`/`prepare`) — only a local
  TypeScript transpile (`build-server.mjs`, pure `ts.transpileModule`).

### 2. No data exfiltration
Complete inventory of outbound hosts found in **source** (test fixtures and lockfile
funding URLs excluded):

| Host | Purpose | Legit? |
|------|---------|--------|
| `services.leadconnectorhq.com` | Primary GHL public API | ✅ GHL |
| `backend.leadconnectorhq.com/workflow` | GHL internal workflow API (Finding #4) | ✅ GHL (private) |
| `securetoken.googleapis.com` | Firebase token refresh for GHL workflow auth | ✅ Google/GHL |
| `app.gohighlevel.com`, `marketplace.gohighlevel.com`, `ideas.gohighlevel.com` | UI deep-links / dev-script doc sources | ✅ GHL |
| `chatgpt.com`, `chat.openai.com` | CORS **inbound** allow-list (not a destination) | ✅ MCP clients |
| `localhost` / `0.0.0.0` | Local server bind | ✅ local |

No third-party host, no IP literal, no webhook, no analytics/telemetry endpoint.
`mcp-apps/` makes **no** remote outbound calls at all. `example.com` / `test.com`
appear only in `tests/` mocks.

### 3. Credentials stay under your control
- Env vars read are all expected: `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_BASE_URL`,
  `GHL_API_VERSION`, `GHL_TOOL_PROFILE`, `PORT`/`MCP_SERVER_PORT`/`GHL_MCP_APPS_PORT`,
  `LOG_LEVEL`, `HOME`. No surprises.
- **No** access to `~/.ssh`, `~/.aws`, keychains, browser cookies/Login Data, shell rc
  files, `/etc`, crontab, or any startup-persistence location. The only home-dir
  reference is Finding #1.
- The GHL token is sent only as `Authorization: Bearer …` to `leadconnectorhq.com`
  ([enhanced-ghl-client.ts:120](src/enhanced-ghl-client.ts:120), [ghl-api-client.ts:464](src/clients/ghl-api-client.ts:464)).
- **No secret values are logged.** The single token-related log line
  ([ghl-api-client.ts:1551](src/clients/ghl-api-client.ts:1551)) prints
  `"Access token updated"` with no value.
- The only runtime filesystem write is the `.env` token persistence of Finding #3;
  every other write is dev-script build output into `dist/` and `docs/`.

---

## Workflow-builder path (Finding #4) — recommendation

The file [src/clients/workflow-builder-client.ts](src/clients/workflow-builder-client.ts)
and its tools ([src/tools/workflow-builder-tools.ts](src/tools/workflow-builder-tools.ts))
are the only part touching an undocumented GHL API and reverse-engineered auth. Good news:
the client is **lazily instantiated** — it's only constructed when you actually invoke a
workflow-builder tool ([workflow-builder-tools.ts:55](src/tools/workflow-builder-tools.ts:55)),
and it throws cleanly if the extra Firebase/JWT creds aren't set. So on a normal setup it
stays dormant and cannot run the personal-env code path.

- If you only need standard CRM operations (contacts, campaigns, etc.): **don't set**
  `GHL_REFRESH_TOKEN` / `GHL_FIREBASE_*`, and avoid the `workflow_*` create/edit tools.
  The path then never executes.
- If you want to be certain: delete `workflow-builder-client.ts` + `workflow-builder-tools.ts`
  and remove their registration. The rest of the server is independent.
- Understand the tradeoff if you do use it: possible GHL ToS violation / account
  suspension risk, plus long-lived refresh tokens written to disk.

---

## Recommendations (safe-run checklist)

1. **`npm audit fix`** in the repo root and in `mcp-apps/` to clear the `qs` DoS (Finding #5).
2. **Install with `npm ci`**, not `npm install`, so you get exactly the audited lockfile
   versions. Optionally review `node_modules` offline before first run.
3. **Bind to localhost only**; never expose the MCP port to a network (Finding #6).
4. **Start with a low-privilege / sub-account GHL API key** and confirm behavior before
   using a key with broad access. Rotate the key if you later stop trusting the tool.
5. **Decide on the workflow-builder path** per the section above; leave its extra creds
   unset unless you need it.
6. **Keep `.env` git-ignored** (it is) so persisted tokens (Finding #3) don't get committed.
7. Optionally clean up Findings #1–#2 (the `jakeshore` / hardcoded-ID artifacts) so the
   code can't ever fall back to the author's identifiers.

---

## Residual risk

- **Runtime behavior — substantially mitigated.** The dynamic sandbox observed live
  egress and saw only GHL + Google/Firebase on :443. Two gaps remain: (a) dummy creds
  couldn't drive the post-auth `backend.leadconnectorhq.com/workflow` path (covered by
  static review instead), and (b) the test exercised the network code paths but not every
  one of the 834 tools — a tool that only phones home under specific runtime input/state
  is unlikely given the static findings but not 100% excluded. Re-run `../ghl-mcp-sandbox/run.sh`
  against any specific tool you're unsure about.
- **Supply-chain risk is not eliminated.** I reviewed the declared dependencies and
  lockfiles, but did not audit the actually-resolved `node_modules` tree, and a dependency
  version could be compromised after this lockfile was authored. `npm ci` + the offline
  review in step 2 mitigates this.
- Re-review if you pull updates: the trust verdict applies to the current commit only.

---

## Appendix — reproduce the key scans yourself

```sh
# Outbound hosts in source (excludes lockfiles/node_modules/dist):
grep -rEoh "https?://[^ '\")]+" --include='*.ts' --include='*.mjs' --include='*.html' . \
  | grep -vE '/(node_modules|dist)/' | sed -E 's#(https?://[^/]+).*#\1#' | sort | uniq -c | sort -rn

# Dynamic execution / shelling (expect hits only in scripts/*.mjs):
grep -rnE "\beval\b|new Function|child_process|execSync|execFile|\bspawn\b|node:vm" \
  --include='*.ts' --include='*.mjs' . | grep -vE '/(node_modules|dist)/'

# TLS-verification bypass (expect none):
grep -rnE "rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED" --include='*.ts' --include='*.mjs' .

# Secret logging (expect only "Access token updated", no values):
grep -rniE "console\.(log|error|warn)|stderr\.write" src/ | grep -iE "token|apikey|secret|bearer"

# Dependency CVEs (no install needed):
npm audit --package-lock-only && (cd mcp-apps && npm audit --package-lock-only)
```
