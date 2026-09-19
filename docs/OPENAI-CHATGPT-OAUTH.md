# ChatGPT OAuth operations

This runbook configures the hosted `golf` MCP for ChatGPT Developer Mode. It
does not cover submitting the app to OpenAI.

## Public endpoints

Use these production URLs:

| Purpose | URL |
| --- | --- |
| MCP server | `https://mcp.golfintelligence.com/mcp` |
| Protected resource metadata | `https://mcp.golfintelligence.com/.well-known/oauth-protected-resource/mcp` |
| Root metadata compatibility | `https://mcp.golfintelligence.com/.well-known/oauth-protected-resource` |
| Authorization server metadata | `https://mcp.golfintelligence.com/.well-known/oauth-authorization-server` |
| Authorization endpoint | `https://mcp.golfintelligence.com/oauth/authorize` |
| Token endpoint | `https://mcp.golfintelligence.com/oauth/token` |
| Dynamic registration | `https://mcp.golfintelligence.com/oauth/register` |

The canonical OAuth resource and token audience are both
`https://mcp.golfintelligence.com/mcp`. The only scope is `golf:read`.
Authorization uses the code flow with mandatory S256 PKCE. Access tokens last
one hour; refresh tokens last 30 days.

## OpenAI app configuration

In ChatGPT Developer Mode, create the MCP app with:

- Server URL: `https://mcp.golfintelligence.com/mcp`
- Authentication: OAuth
- Client registration: Dynamic client registration (recommended)
- Scope: `golf:read`

No OAuth client ID or client secret is needed when dynamic registration is
selected. ChatGPT registers a public client at `/oauth/register`, uses
`token_endpoint_auth_method=none`, and protects the code exchange with PKCE.
Discovery supplies the authorization and token endpoint URLs.

For a predefined client instead, set all of the following Fly secrets and enter
the same client ID and secret in the OpenAI app configuration:

```text
OAUTH_CLIENT_ID=<random stable client ID>
OAUTH_CLIENT_SECRET=<random stable client secret>
OAUTH_REDIRECT_URIS=<exact comma-separated callback URI allowlist>
```

ChatGPT shows a production callback in the app management page with this form:

```text
https://chatgpt.com/connector/oauth/{callback_id}
```

Copy the exact displayed URI into `OAUTH_REDIRECT_URIS`. Do not guess the
`callback_id`. Existing published apps may continue to use the legacy callback
`https://chatgpt.com/connector_platform_oauth_redirect`; allowlist it only when
the app actually uses it. The token endpoint supports
`client_secret_basic` and `client_secret_post` when
`OAUTH_CLIENT_SECRET` is configured.

Do not point OpenAI at `api.golfintelligence.com` discovery. The MCP host is
the OAuth authorization server for this connector and performs the GI
credential exchange behind the OAuth boundary.

## Reviewer sign-in

Create or choose a dedicated GI API Account with an intentional review credit
limit. Give the reviewer these two console values through the approved secure
review channel:

1. Client ID
2. Active Token

When ChatGPT opens the Golf Intelligence authorization page, the reviewer
enters those values and selects **Authorize ChatGPT**. The service validates
the pair directly with GI. No console login, email verification code, or code
forwarding is involved.

To restrict a review deployment to specific accounts, set a comma-separated
allowlist:

```text
OAUTH_ALLOWED_GI_CLIENT_IDS=<review Client ID>,<second allowed Client ID>
```

Leave this secret unset for general availability so every user can connect
their own valid GI API Account. The allowlist contains Client IDs only; never
put Active Tokens in it.

## Fly secrets and deploy

Generate the required encryption key once and retain it in the deployment
secret store:

```bash
fly secrets set \
  OAUTH_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  OAUTH_ISSUER="https://mcp.golfintelligence.com"
```

`OAUTH_ENCRYPTION_KEY` must decode to exactly 32 bytes. It encrypts OAuth
authorization codes, access tokens, refresh tokens, and dynamic client
registrations. Rotating it immediately invalidates all of those values and
requires users to reconnect.

Optional or existing secrets:

```text
OAUTH_CLIENT_ID                 # only for predefined-client mode
OAUTH_CLIENT_SECRET             # only for confidential predefined clients
OAUTH_REDIRECT_URIS             # required with OAUTH_CLIENT_ID
OAUTH_ALLOWED_GI_CLIENT_IDS     # optional temporary review allowlist
OPENAI_APPS_CHALLENGE_TOKEN     # existing OpenAI domain verification
```

Do not use global `GI_CLIENT_ID` or `GI_ACTIVE_TOKEN` as hosted MCP
credentials. The HTTP server intentionally ignores them. If they remain in the
Fly application for a separate administrative purpose, anonymous MCP requests
still receive HTTP 401 and cannot use that account.

Deploy without changing the existing app name or public domain:

```bash
fly deploy
```

The service binds to `0.0.0.0:$PORT`, and the existing
`GET /.well-known/openai-apps-challenge` route remains active.

## Post-deploy verification

Check discovery and the unauthenticated boundary before configuring ChatGPT:

```bash
curl -fsS https://mcp.golfintelligence.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://mcp.golfintelligence.com/.well-known/oauth-authorization-server
curl -i https://mcp.golfintelligence.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The first two calls return JSON. The third returns HTTP 401 and a
`WWW-Authenticate` header pointing at the protected-resource metadata.

Complete one real reviewer connection in ChatGPT after merge and deployment.
Then verify, with explicit spend confirmation for each paid call:

1. `search_course_groups`
2. `get_course_group_scorecard` with `confirm_spend=true`
3. `get_course_group_gps` with `confirm_spend=true`
4. `get_course_group_detail` with `confirm_spend=true`
5. `get_green_slope_image` with `confirm_spend=true`

Search is idempotent and costs no credits. A retry or repeated invocation of a
paid tool may consume credits again, so paid tools advertise
`idempotentHint: false`.
