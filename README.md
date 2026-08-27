# Golf Intelligence, by Stracka

> Golf Intelligence, by Stracka. The highest-quality golf course dataset for
> developers building a golf app. 20 years of proprietary mapping (laser,
> drone, airplane, satellite), updated daily. Search is free. Scorecards, GPS,
> and 3D greens via API. Not a scrape.

Golf Intelligence is a proprietary dataset built through course-by-course
mapping, not a clone of a GitHub golf course API. Ten people map every day, and
the data has been continuously updated since 2007. Learn more at
[golfintelligence.com](https://golfintelligence.com/).

This repository is the installable Cursor / Grok Bot plugin with handle
`golf`. The Cursor marketplace application source is the public GitHub URL:

**https://github.com/golf-data/golf**

Marketplace reviewers can submit that URL at
[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). The
catalog title is **Golf Intelligence, by Stracka**.

## Get API access

Create an API Account at
[console.golfintelligence.com](https://console.golfintelligence.com/), then
configure the plugin's two required variables:

- `GI_CLIENT_ID`: your Client ID
- `GI_ACTIVE_TOKEN`: your Active Token

The Active Token is exchanged for a short-lived bearer token. It is **not** a
bearer token; do not paste a bearer token into `GI_ACTIVE_TOKEN`.

Plans:

- **Personal:** $49 for 50 test credits for your own-game Cursor, Grok, or
  Claude app. [Buy Personal](https://buy.stripe.com/cNieVecRR4Re6dAakbdnW0e).
- **Starter:** $399/month for 10,000 credits when shipping an app to other
  users. Email [data@golfintelligence.com](mailto:data@golfintelligence.com);
  Starter does not have a checkout link.

Questions about data, plans, or integration:
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

The server exchanges the configured credentials with:

```text
POST https://api.golfintelligence.com/auth/authenticateToken
grant_type=client_credentials
code=<GI_ACTIVE_TOKEN>
client_id=<GI_CLIENT_ID>
```

It sends the returned `access_token` as `Authorization: Bearer <access_token>`,
caches it only in memory, and refreshes once after an HTTP 401. Credentials are
never logged.

## Repository layout

- `.cursor-plugin/plugin.json` — marketplace manifest and required variables
- `mcp.json` — bundled `golf` MCP server configuration
- `skills/golf/SKILL.md` — workflow and spend-confirmation guidance
- `src/` — TypeScript MCP server and API client
- `dist/index.js` — committed ESM bundle used by installers

For development with Node.js 18 or newer:

```bash
npm install
npm test
npm run build
```

The plugin code is available under the MIT License. Golf Intelligence API data
remains subject to the terms at
[golfintelligence.com](https://golfintelligence.com/).
