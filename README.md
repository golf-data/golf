# Golf Intelligence, by Stracka

> Golf Intelligence, by Stracka. Proprietary StrackaGolf course data for
> developers building a golf app, updated daily. Search is free. Scorecards,
> GPS, and 3D greens are available via API.

Golf Intelligence provides proprietary StrackaGolf course data, updated daily.
Learn more at [golfintelligence.com](https://golfintelligence.com/).

This repository is the installable Cursor / Grok Bot plugin with handle
`golf`. The Cursor marketplace application source is the public GitHub URL:

**https://github.com/golf-data/golf**

Marketplace reviewers can submit that URL at
[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). The
catalog title is **Golf Intelligence, by Stracka**.

The bundled `mcp.json` connects to the hosted MCP at
`https://mcp.golfintelligence.com/mcp` over Streamable HTTP, so installing the
plugin never depends on a local Node build. Your console credentials travel as
the `X-GI-Client-ID` and `X-GI-Active-Token` headers, filled from the plugin
variables declared in `.cursor-plugin/plugin.json`.

Earlier releases launched `node` against a plugin-relative `dist/index.js`.
Cursor does not expand the Agent Plugins `${PLUGIN_ROOT}` variable, so that
placeholder reached Node literally and the connector failed with
`Cannot find module '.../${PLUGIN_ROOT}/dist/index.js'`. The hosted connector
removes that failure mode entirely.

`mcp.stdio.json` keeps the local stdio server for offline and development use.
It is not auto-discovered; copy its `golf` entry into `.cursor/mcp.json` (using
`${workspaceFolder}` in a checkout) or point `mcpServers` at it. Any local
stdio config must use `${CURSOR_PLUGIN_ROOT}`, never `${PLUGIN_ROOT}`. The
committed `dist/index.js` bundle ships in the repository and in the MCPB
package, so the stdio path works without running a build first.

The official MCP Registry name is **`io.github.golf-data/golf`**. The registry
does not accept a bare `golf` name. Cursor, Agent Plugins, and Claude Code
plugin handles remain `golf`.

## Get API access

Sign in at console.golfintelligence.com without a password: enter your email on
the login page, request a verification code, then enter the code after it is
sent. Create an API Account and configure the plugin's two required variables:

- `GI_CLIENT_ID`: your Client ID
- `GI_ACTIVE_TOKEN`: your Active Token

The Active Token is exchanged for a short-lived bearer token. It is **not** a
bearer token; do not paste a bearer token into `GI_ACTIVE_TOKEN`.

Use credentials from your own console account. This project does not provide
demo tokens.

Plans are monthly and can be upgraded or downgraded self-serve in the console:

- **Tester:** $49/month for 100 credits/month.
- **Starter:** $399/month for 10,000 credits/month.

For billing, credits, plans, login, or credential help, email
[support@golfintelligence.com](mailto:support@golfintelligence.com). For course
data updates, email
[data@golfintelligence.com](mailto:data@golfintelligence.com).

## Tools and credits

Always search first. `search_course_groups` is free. Before every paid call,
the user must explicitly confirm the stated cost; the server refuses paid tools
unless `confirm_spend=true`.

| Tool | What it returns | Credits |
| --- | --- | ---: |
| `search_course_groups` | Course-group search results | 0 |
| `get_course_group_scorecard` | Scorecard data | 1 |
| `get_course_group_gps` | Mapped course geometry and coordinates | 2 |
| `get_course_group_detail` | Detailed course-group data | 3 |
| `get_green_slope_image` | Portrait or square green slope image | 1 |

## Authentication

The local stdio server and legacy per-user HTTP credential headers exchange the
configured credentials with:

```text
POST https://api.golfintelligence.com/auth/authenticateToken
grant_type=client_credentials
code=<GI_ACTIVE_TOKEN>
client_id=<GI_CLIENT_ID>
```

It sends the returned `access_token` as `Authorization: Bearer <access_token>`,
caches it only in memory, and refreshes once after an HTTP 401. Credentials are
never logged.

The hosted MCP additionally implements OAuth 2.1 authorization-code flow with
S256 PKCE for ChatGPT. Its dedicated authorization page accepts each user's own
console Client ID and Active Token, validates them with Golf Intelligence, and
binds that account to encrypted access and refresh tokens. See
[docs/OPENAI-CHATGPT-OAUTH.md](docs/OPENAI-CHATGPT-OAUTH.md) for discovery URLs,
OpenAI portal settings, reviewer steps, and deployment secrets.

## Streamable HTTP

The hosted MCP is available via the official MCP Streamable HTTP transport at:

```text
https://mcp.golfintelligence.com/mcp
```

The production HTTP entrypoint serves that transport at `/mcp` and a health
check at `/health`. For OpenAI Apps domain verification it also serves
`GET /.well-known/openai-apps-challenge` as `text/plain` when
`OPENAI_APPS_CHALLENGE_TOKEN` (or `OPENAI_APPS_CHALLENGE`) is set; otherwise
that path returns 404. Start the HTTP server locally with:

```bash
npm run build
PORT=3000 npm run start:http
```

It binds to `0.0.0.0:$PORT`. The existing `node dist/index.js` stdio entrypoint
and all plugin packages remain unchanged.

The HTTP service accepts Golf Intelligence identity in either of these forms:

1. An OAuth bearer token issued by this service after the user signs in with
   their own GI account.
2. Legacy `X-GI-Client-ID` and `X-GI-Active-Token` headers supplied together on
   every MCP request by existing plugin installs.

There is deliberately no server-wide `GI_CLIENT_ID` / `GI_ACTIVE_TOKEN`
fallback. The HTTP entrypoint ignores those environment variables, so an
anonymous caller cannot inherit a deployment account or spend its credits.
Missing or invalid OAuth returns HTTP 401 with an OAuth protected-resource
challenge. The Active Token is an exchange credential and must not be sent as
an `Authorization: Bearer` value.

Every tool explicitly advertises these MCP annotations:

- `readOnlyHint: true` — each tool only retrieves course data.
- `openWorldHint: false` — no tool writes to public or external systems.
- `destructiveHint: false` — no tool deletes, overwrites, publishes, or sends
  anything.
- `idempotentHint: true` for free search.
- `idempotentHint: false` for paid tools because every repeated paid invocation
  can consume credits again.

These sentences can also be used as the annotation justifications in the
OpenAI submission form. Paid lookups still require `confirm_spend=true` at the
same credit costs documented above.

### Container deployment

`Dockerfile` builds both transports without embedding credentials.
`fly.toml` configures a small Fly.io service and checks `/health`. Before the
first deploy, confirm that the globally unique Fly app name is available (or
change `app`), then configure the OAuth secrets documented in
`docs/OPENAI-CHATGPT-OAUTH.md` and deploy. At minimum:

```bash
fly secrets set OAUTH_ENCRYPTION_KEY="$(openssl rand -base64 32)"
fly secrets set OAUTH_ISSUER=https://mcp.golfintelligence.com
fly secrets set OPENAI_APPS_CHALLENGE_TOKEN=...
fly deploy
```

Do not configure a shared GI account for hosted HTTP callers. If
`GI_CLIENT_ID` / `GI_ACTIVE_TOKEN` exist for a separate bootstrap or stdio
workflow, they do not authorize HTTP requests.

Set `OPENAI_APPS_CHALLENGE_TOKEN` to the token shown in OpenAI Platform domain
verification. Do not commit that token. After deploy,
`GET https://mcp.golfintelligence.com/.well-known/openai-apps-challenge`
should return the token as `text/plain`.

Tool names and descriptions are baked into the deployed bundle, so the hosted
MCP keeps serving the previous copy until it is redeployed. Redeploy before
refreshing the marketplace listing, and follow `docs/RELEASE.md` for the full
order across Fly, the marketplace, and the MCP Registry.

## Repository layout

- `.cursor-plugin/plugin.json` — Cursor marketplace manifest and required variables
- `plugin.json` — Agent Plugins open-standard manifest (handle `golf`)
- `.claude-plugin/plugin.json` — Claude Code / Cowork plugin manifest (handle `golf`)
- `server.json` — official MCP Registry metadata (`io.github.golf-data/golf`)
- `manifest.json` — MCPB bundle manifest for the stdio Node server
- `.github/workflows/publish-mcp.yml` — publishes `io.github.golf-data/golf` to the official MCP Registry via GitHub OIDC
- `mcp.json` — bundled `golf` connector pointing at the hosted MCP endpoint
- `mcp.stdio.json` — optional local stdio configuration for offline development
- `skills/golf/SKILL.md` — workflow and spend-confirmation guidance
- `docs/SMOKE-CHECKLIST.md` — post-deploy and post-publish verification steps
- `docs/RELEASE.md` — Fly redeploy, GitHub release, and registry publish runbook
- `src/` — TypeScript MCP server and API client
- `dist/index.js` — committed stdio ESM bundle used by installers
- `dist/http.js` — committed Streamable HTTP ESM bundle used by the container
- `Dockerfile` and `fly.toml` — production HTTP container and Fly.io service

For development with Node.js 18 or newer:

```bash
npm install
npm test
npm run build
npm run pack:mcpb
```

`pack:mcpb` uses the official `@anthropic-ai/mcpb pack` CLI to produce `golf.mcpb` and writes its SHA-256 into `server.json`. GitHub Releases host that asset at `https://github.com/golf-data/golf/releases/download/v1.0.2/golf.mcpb`.

The plugin code is available under the MIT License. Golf Intelligence API data
remains subject to the terms at
[golfintelligence.com](https://golfintelligence.com/).
