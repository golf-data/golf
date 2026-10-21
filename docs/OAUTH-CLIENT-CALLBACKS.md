# OAuth dynamic-registration callbacks

`POST /oauth/register` only accepts these redirect URIs. Everything else returns `invalid_redirect_uri`.

| Client | Allowed redirect URI(s) | Source |
|---|---|---|
| ChatGPT | `https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/*` | OpenAI Apps SDK auth docs (unchanged from 1.0.2) |
| Claude | `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` | Anthropic, "Building custom connectors via remote MCP servers" (support.claude.com) |
| Claude Code, Gemini CLI, Copilot CLI | `http://127.0.0.1`, `http://localhost`, `http://[::1]`, any port, path `/`, `/callback` or `/oauth/callback` | RFC 8252 §7.3; geminicli.com/docs/tools/mcp-server (`http://localhost:<port>/oauth/callback`) |
| GitHub Copilot (VS Code) | `https://vscode.dev/redirect`, `https://insiders.vscode.dev/redirect`, `http://127.0.0.1:33418/` | code.visualstudio.com/api/extension-guides/ai/mcp (Authorization checklist) |
| Microsoft Copilot Studio | `https://global.consent.azure-apim.net/redirect/*` | Power Platform custom connector OAuth redirect URL docs |
| Perplexity | `https://www.perplexity.ai/rest/connections/oauth_callback` | Perplexity custom remote connector docs |
| Mistral | `https://console.mistral.ai/build/connectors/debugger/oauth-callback` | docs.mistral.ai/studio/connectors/debugger |

Loopback redirects match on host and path; the port can differ between registration and authorize (RFC 8252 §7.3).

## Public sample course

`GET /sample/course/225V2ANM` (Torrey Pines South) serves a static snapshot stored in the image: scorecard, GPS and green slope data. Green images are at `/sample/course/225V2ANM/greens/hole-<1-18>.png`. No GI call is made and no credits are spent. Any other ID, and any other `/sample` path, returns the standard 401 OAuth challenge. There is no list endpoint.
