# Release and redeploy runbook

Three surfaces serve this plugin, and each one is published separately. A
change merged to `main` reaches users only after all three are refreshed.

| Surface | What users see | How it updates |
| --- | --- | --- |
| Fly.io hosted MCP | Live tool names and descriptions | `fly deploy` |
| Cursor marketplace | Listing copy and the connector config | Marketplace publish of the repo |
| Official MCP Registry | `io.github.golf-data/golf` metadata | GitHub release triggers the publish workflow |

`package.json` is the single source of version truth. `npm run pack:mcpb`
derives the release asset URL and rewrites `server.json` from it, so bump
`package.json` first and let packaging follow.

## 1. Redeploy the Fly hosted MCP first

Tool descriptions are baked into the deployed bundle, so the hosted server
keeps serving old copy until it is redeployed. This must happen before the
listing is refreshed.

```bash
fly deploy --app golf-intelligence-mcp
```

Then confirm the deployment is current and clean:

```bash
curl -sS https://mcp.golfintelligence.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep -Eio 'laser|drone|airplane|satellite'
```

That must print nothing, and `initialize` must report a `serverInfo.version`
matching `package.json`. See `docs/SMOKE-CHECKLIST.md` for the full pass.

## 2. Publish the GitHub release and the registry entry

The registry serves whatever was last published, independent of `main`. Cut a
release so the publish workflow runs:

```bash
git tag v1.0.2
git push origin v1.0.2
```

Create the GitHub release for that tag. On publish, `.github/workflows/publish-mcp.yml`:

1. Fails fast if the tag does not match the `package.json` version.
2. Builds and packs `golf.mcpb`, which rewrites `server.json` with the release
   asset URL and its real SHA-256.
3. Uploads `golf.mcpb` to the release.
4. Authenticates with GitHub OIDC and runs `mcp-publisher publish`.

Because the workflow re-packs before publishing, the hash it publishes always
matches the asset it uploaded. The `fileSha256` committed in the repository is
a snapshot of the last local pack and is expected to be replaced at release
time.

Verify afterwards:

```bash
curl -sS "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.golf-data/golf"
```

Check that `version` is the released version, `_meta` shows `isLatest`, and
the `description` contains no capture-method wording.

## 3. Refresh the Cursor marketplace listing

Submit the repository at
[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). The
handle stays `golf` and the catalog title stays **Golf Intelligence, by
Stracka**. After the listing updates, follow the reinstall steps in
`docs/SMOKE-CHECKLIST.md`: an existing install must be removed before
reinstalling, because the cached clone still holds the previous connector
config.
