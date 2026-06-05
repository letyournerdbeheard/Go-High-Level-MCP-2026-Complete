# SOP — Adding GoHighLevel MCP Servers per Client Location

**Purpose:** Stand up one GHL MCP server *per client location* so each one carries its own
Location ID and API token. Once configured, you never specify a location ID in chat — the
server injects it automatically for every tool call.

**Applies to:** Claude Desktop **chat** and **Cowork**. ⚠️ **These read two different config
files.** To make a location available in both surfaces you must register it in **both places**
(§2). This is the most common mistake — a location added to only one file shows up in only one
surface.

**Owner:** Justin James
**Last updated:** 2026-05-30

---

## 1. How this works (read once)

- The MCP server reads four environment variables from its config entry:
  `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_BASE_URL`, `GHL_API_VERSION`.
- It **requires** `GHL_API_KEY` and `GHL_LOCATION_ID` at startup — it will not boot without them
  (`src/server.ts`).
- Every tool call falls back to the entry's `GHL_LOCATION_ID` when the call doesn't pass an
  explicit `locationId` (`src/clients/ghl-api-client.ts`). **That is the whole point** — bake the
  location into the server entry and you stop repeating it.

**Design rule:** one location = one named server entry, registered in **both** config files
(§2). Do not try to make a single entry serve multiple locations.

---

## 2. The two config files (this is the key fact)

Desktop **chat** and **Cowork** are different runtimes and read MCP servers from different files:

| Surface | Config file | How to edit it |
|---------|-------------|----------------|
| **Desktop chat** | `~/Library/Application Support/Claude/claude_desktop_config.json` → top-level `"mcpServers"` | Edit JSON by hand (§5.2) |
| **Cowork** (runs on the Claude Code engine) | `~/.claude.json` → top-level `"mcpServers"` (the **user / global** scope) | Use the `claude mcp` CLI (§5.3) — preferred — or edit JSON by hand |

Both currently contain a working entry named `ghlcrm` (Location `bQONxNtyJCe3rQsSibFG`). Leave
those alone; you'll add **siblings** in each file.

Two differences to be aware of between the files:
- The **Cowork** (`~/.claude.json`) entry includes `"type": "stdio"` and, in your setup,
  `"GHL_TOOL_PROFILE": "full"`. The **chat** entry omits `type`.
- Cowork's **user scope** (`~/.claude.json` top-level `mcpServers`) makes the server available in
  **every** Cowork session regardless of folder. That's what you want for client locations — do
  not use project scope for these.

> **Always back up both files before editing:**
> ```bash
> cp ~/Library/Application\ Support/Claude/claude_desktop_config.json \
>    ~/Library/Application\ Support/Claude/claude_desktop_config.backup.json
> cp ~/.claude.json ~/.claude.backup.json
> ```

---

## 3. Per-client prerequisites (gather before editing)

For **each** client location, collect:

| Item | Where to get it |
|------|-----------------|
| **Location ID** | GHL sub-account → Settings → Business Profile (or the URL: `.../location/<LOCATION_ID>/...`) |
| **API token (Private Integration Token)** | In the *client's* sub-account → Settings → Private Integrations → create a token with the scopes you need |

**Token guidance:**
- A Private Integration Token (PIT) is scoped to the sub-account it's created in. The cleanest,
  most isolated setup is **one PIT per client location**.
- If you use an agency-level token that already has access to multiple sub-accounts, you can reuse
  the same `GHL_API_KEY` across entries and only change `GHL_LOCATION_ID`. Per-client PITs are
  preferred for blast-radius and offboarding (revoke one client without touching the others).

---

## 4. Naming convention

Use a stable, readable prefix so the tools are easy to tell apart in chat/Cowork:

```
ghlcrm-<client-slug>
```

Examples: `ghlcrm-acme`, `ghlcrm-diane-forster`, `ghlcrm-bright-dental`.

- Lowercase, hyphenated, no spaces.
- The entry name becomes the tool namespace (e.g. tools appear as `ghlcrm-acme` tools), so pick
  something you'll recognize mid-conversation.
- Keep the original `ghlcrm` for your own account.

---

## 5. Procedure — add one location

Repeat this whole section for each new client.

### 5.1 Build the server once (only needed after a code update)

```bash
cd /Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete
npm install
npm run build
```

All location entries share the same compiled `dist/server.js` — you do **not** build per client.

### 5.2 Register for **Desktop chat** — edit `claude_desktop_config.json`

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and add a sibling entry
inside `"mcpServers"`. Example adding `ghlcrm-acme`:

```json
{
  "mcpServers": {
    "ghlcrm": {
      "command": "node",
      "args": ["/Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/dist/server.js"],
      "env": {
        "GHL_API_KEY": "<your-own-account-token>",
        "GHL_LOCATION_ID": "bQONxNtyJCe3rQsSibFG",
        "GHL_BASE_URL": "https://services.leadconnectorhq.com",
        "GHL_API_VERSION": "2021-07-28"
      }
    },
    "ghlcrm-acme": {
      "command": "node",
      "args": ["/Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/dist/server.js"],
      "env": {
        "GHL_API_KEY": "<acme-private-integration-token>",
        "GHL_LOCATION_ID": "<acme-location-id>",
        "GHL_BASE_URL": "https://services.leadconnectorhq.com",
        "GHL_API_VERSION": "2021-07-28"
      }
    }
  }
}
```

Notes:
- **Comma between entries.** A missing/extra comma is the #1 cause of "no MCP servers loaded."
  Validate after editing: `python3 -m json.tool < ~/Library/Application\ Support/Claude/claude_desktop_config.json > /dev/null && echo OK`
- Keep `command`/`args` identical across entries. Only `GHL_API_KEY` and `GHL_LOCATION_ID` change.
- Leave the rest of the file (`coworkUserFilesPath`, `preferences`, etc.) untouched.

### 5.3 Register for **Cowork** — use the `claude mcp` CLI (preferred)

This writes to `~/.claude.json` user/global scope, which every Cowork session reads. Run from any
directory:

```bash
claude mcp add ghlcrm-acme -s user \
  -e GHL_API_KEY="<acme-private-integration-token>" \
  -e GHL_LOCATION_ID="<acme-location-id>" \
  -e GHL_BASE_URL="https://services.leadconnectorhq.com" \
  -e GHL_API_VERSION="2021-07-28" \
  -e GHL_TOOL_PROFILE="full" \
  -- node /Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/dist/server.js
```

- `-s user` is required so the server is global (all Cowork sessions), matching how `ghlcrm` is
  set up. Do **not** use the default `local`/project scope for client locations.
- Verify it landed: `claude mcp list` should show `ghlcrm-acme ... ✓ Connected`.
- To remove later: `claude mcp remove ghlcrm-acme -s user`.

> **Manual alternative:** if you can't use the CLI, hand-edit `~/.claude.json` and add the same
> sibling under the top-level `"mcpServers"`, including `"type": "stdio"`. Back up first
> (`cp ~/.claude.json ~/.claude.backup.json`) and validate with
> `python3 -m json.tool < ~/.claude.json > /dev/null && echo OK`.

### 5.4 (Optional) Add the MCP Apps server for this location

Only if you want the interactive **app panels** (contact workspace, pipeline board, etc.) scoped
to that client. The apps server is a separate binary at `mcp-apps/dist/main.js`. Register it the
same way in **whichever surface(s)** you want it — chat (§5.2-style JSON entry named
`ghlcrm-acme-apps`) and/or Cowork (CLI below).

```bash
# one-time build of the apps bundle (Node 20+ required)
npm run apps:install
npm run apps:build

# Cowork registration:
claude mcp add ghlcrm-acme-apps -s user \
  -e GHL_API_KEY="<acme-private-integration-token>" \
  -e GHL_LOCATION_ID="<acme-location-id>" \
  -e GHL_BASE_URL="https://services.leadconnectorhq.com" \
  -e GHL_API_VERSION="2021-07-28" \
  -- node /Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/mcp-apps/dist/main.js
```

If you only need tool calls (not the visual app panels), skip this step.

### 5.5 Restart / reload

- **Desktop chat:** **fully quit** Claude Desktop (⌘Q — not just close the window) and reopen it.
  MCP servers load at launch.
- **Cowork:** start a **new** Cowork session (or restart the app). Servers added via
  `claude mcp add` are picked up by new sessions.

---

## 6. Verify

Do this for each new location, in **both** surfaces:

**In Desktop chat:**
1. Open the MCP / tools indicator and confirm the new server name (e.g. `ghlcrm-acme`) is listed
   and connected (green).
2. Ask: *"Using ghlcrm-acme, search for 5 contacts."* Confirm it returns **that client's** data
   without you supplying a location ID.

**In Cowork:**
1. Run `claude mcp list` — confirm the new server shows `✓ Connected`.
2. Start a **new** Cowork session and confirm the same server appears in available tools.
3. Run the same read-only check (e.g. list contacts or run a location health check).

**Cross-check isolation:** run the same query against two different location servers and confirm
the results differ (i.e. you're not accidentally hitting one location for all of them).

Optional CLI smoke test from the repo (read-only), pointing at a specific location:

```bash
GHL_API_KEY="<token>" GHL_LOCATION_ID="<location-id>" \
  npx ghl-mcp test-tool search_contacts '{"pageLimit":1}'
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| **Works in chat but not Cowork (or vice-versa)** | Registered in only one config file | Add it to the **other** file too — chat = `claude_desktop_config.json` (§5.2), Cowork = `claude mcp add -s user` (§5.3) |
| Cowork server only in some sessions/folders | Added at project/`local` scope instead of `user` | Re-add with `-s user`; remove the project-scoped copy |
| No GHL servers appear at all | JSON syntax error (comma/brace) | Validate with `python3 -m json.tool`; restore from backup if needed |
| One server missing/red | Bad token or wrong Location ID for that entry | Re-copy PIT and Location ID from that sub-account |
| Server fails to start | Missing `GHL_API_KEY` or `GHL_LOCATION_ID` | Both are required; fill them in |
| Returns another client's data | Tool call passed an explicit `locationId`, or wrong ID in `env` | Don't pass `locationId` in chat; verify the entry's `GHL_LOCATION_ID` |
| 401 / auth errors | Token revoked, expired, or wrong scopes | Recreate the Private Integration Token with needed scopes |
| Apps panels blank but tools work | Apps server not built or not added | Run `npm run apps:build`; add the `*-apps` entry |
| Chat changes not taking effect | Claude Desktop not fully restarted | ⌘Q and relaunch |
| Cowork changes not taking effect | Old session still open | Start a new Cowork session; confirm with `claude mcp list` |

---

## 8. Offboarding a client

Remove from **both** files:

1. Quit Claude Desktop.
2. **Chat:** remove the client's `ghlcrm-<slug>` (and `-apps`) entry from `claude_desktop_config.json`.
3. **Cowork:** `claude mcp remove ghlcrm-<slug> -s user` (and the `-apps` entry if added).
4. Revoke the client's Private Integration Token inside their GHL sub-account.
5. Relaunch Claude Desktop / start a new Cowork session and confirm the entries are gone
   (`claude mcp list`).

---

## 9. Quick reference — copy/paste templates

**Chat** — paste into `claude_desktop_config.json` under `"mcpServers"`:

```json
"ghlcrm-<client-slug>": {
  "command": "node",
  "args": ["/Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/dist/server.js"],
  "env": {
    "GHL_API_KEY": "<client-private-integration-token>",
    "GHL_LOCATION_ID": "<client-location-id>",
    "GHL_BASE_URL": "https://services.leadconnectorhq.com",
    "GHL_API_VERSION": "2021-07-28"
  }
}
```

**Cowork** — run in a terminal:

```bash
claude mcp add ghlcrm-<client-slug> -s user \
  -e GHL_API_KEY="<client-private-integration-token>" \
  -e GHL_LOCATION_ID="<client-location-id>" \
  -e GHL_BASE_URL="https://services.leadconnectorhq.com" \
  -e GHL_API_VERSION="2021-07-28" \
  -e GHL_TOOL_PROFILE="full" \
  -- node /Users/lynbh/Development/temp/Go-High-Level-MCP-2026-Complete/dist/server.js
```

Optional add-ons per entry:
- `"GHL_TOOL_PROFILE": "curated"` (or `-e GHL_TOOL_PROFILE="curated"`) — expose only the 32
  high-level CRM workflow tools instead of the full ~834-tool surface. Good for keeping client
  sessions focused.
