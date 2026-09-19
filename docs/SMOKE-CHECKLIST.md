# Golf Intelligence MCP smoke checklist

Run this after deploying the hosted MCP and after publishing a new plugin
version to the Cursor marketplace. Use credentials from your own API Account at
console.golfintelligence.com; there are no demo tokens.

## 1. Hosted endpoint is up

```bash
curl -sS https://mcp.golfintelligence.com/health
```

Expect `{"status":"ok"}`.

## 2. `initialize` over Streamable HTTP

```bash
curl -sS https://mcp.golfintelligence.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-GI-Client-ID: $GI_CLIENT_ID" \
  -H "X-GI-Active-Token: $GI_ACTIVE_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "smoke", "version": "1.0.0" }
    }
  }'
```

Expect a result containing `serverInfo.name` of `golf` and a `tools`
capability. `serverInfo.version` must match the version in `package.json`; an
older version means the deployment is stale and is still serving retired tool
descriptions.

## 3. `tools/list` returns all five tools

```bash
curl -sS https://mcp.golfintelligence.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-GI-Client-ID: $GI_CLIENT_ID" \
  -H "X-GI-Active-Token: $GI_ACTIVE_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Expect `search_course_groups`, `get_course_group_scorecard`,
`get_course_group_gps`, `get_course_group_detail`, and
`get_green_slope_image`, each with `readOnlyHint: true`.

An incomplete credential pair must fail fast: sending only `X-GI-Client-ID`
returns HTTP 400 with `must be provided together`.

The served descriptions must also match the approved copy. This must print
nothing:

```bash
curl -sS https://mcp.golfintelligence.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' \
  | grep -Eio 'laser|drone|airplane|satellite'
```

## 4. Free search works end to end

Call `search_course_groups` with `{"keywords":"St Andrews"}` and confirm
results come back with no credit charge. Paid tools must refuse without
`confirm_spend=true`.

## 5. Cursor marketplace install

1. Remove any previously installed `golf` plugin, then reinstall it from the
   marketplace so the cached clone is replaced.
2. Set the `GI_CLIENT_ID` and `GI_ACTIVE_TOKEN` plugin variables under
   Plugins → Configure.
3. Confirm the connector loads with no `Cannot find module` error and that the
   five tools appear. A load error mentioning `${PLUGIN_ROOT}` means the old
   cached stdio clone is still in place.

## 6. Local stdio fallback (optional)

```bash
npm run build
GI_CLIENT_ID=... GI_ACTIVE_TOKEN=... node dist/index.js
```

The process should start and stay connected over stdio.
