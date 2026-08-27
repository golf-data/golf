import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("marketplace manifest uses the golf handle and required variables", async () => {
  const manifest = JSON.parse(
    await readFile(".cursor-plugin/plugin.json", "utf8"),
  ) as Record<string, unknown>;
  assert.equal(manifest.name, "golf");
  assert.equal("displayName" in manifest, false);
  assert.equal(
    (manifest.author as { name: string }).name,
    "Golf Intelligence, by Stracka",
  );
  assert.equal(manifest.logo, "assets/logo.svg");

  const variables = manifest.variables as {
    required: string[];
  };
  assert.deepEqual(variables.required, ["GI_CLIENT_ID", "GI_ACTIVE_TOKEN"]);
});

test("MCP config launches the committed bundle with plugin variables", async () => {
  const config = JSON.parse(await readFile("mcp.json", "utf8"));
  assert.equal(
    config.$schema,
    "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  );
  assert.deepEqual(config.mcpServers.golf, {
    type: "stdio",
    command: "node",
    args: ["${PLUGIN_ROOT}/dist/index.js"],
    env: {
      GI_CLIENT_ID: "${GI_CLIENT_ID}",
      GI_ACTIVE_TOKEN: "${GI_ACTIVE_TOKEN}",
    },
  });
});

test("registry manifests claim golf without displayName", async () => {
  const agent = JSON.parse(await readFile("plugin.json", "utf8"));
  assert.equal(
    agent.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  );
  assert.equal(agent.name, "golf");
  assert.equal(agent.author.name, "Golf Intelligence, by Stracka");
  assert.equal("displayName" in agent, false);

  const claude = JSON.parse(await readFile(".claude-plugin/plugin.json", "utf8"));
  assert.equal(claude.name, "golf");
  assert.equal(claude.author.name, "Golf Intelligence, by Stracka");
  assert.equal(claude.mcpServers, "./mcp.json");
  assert.equal("displayName" in claude, false);

  const server = JSON.parse(await readFile("server.json", "utf8"));
  assert.equal(server.name, "io.github.golf-data/golf");
  assert.equal(server.title, "Golf Intelligence, by Stracka");
  assert.ok(server.description.length <= 100);
  assert.equal(server.websiteUrl, "https://golfintelligence.com/");
  assert.equal(server.repository.url, "https://github.com/golf-data/golf");
  assert.equal(server.packages[0].registryType, "mcpb");
  assert.equal(
    server.packages[0].identifier,
    "https://github.com/golf-data/golf/releases/download/v1.0.0/golf.mcpb",
  );
  assert.match(server.packages[0].fileSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    server.packages[0].environmentVariables.map((item: { name: string }) => item.name),
    ["GI_CLIENT_ID", "GI_ACTIVE_TOKEN"],
  );
});

test("MCPB manifest keeps the golf handle and stdio Node entry", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(manifest.name, "golf");
  assert.equal(manifest.author.name, "Golf Intelligence, by Stracka");
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "dist/index.js");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.deepEqual(manifest.server.mcp_config.args, [
    "${__dirname}/dist/index.js",
  ]);
});

test("committed bundle starts and exposes all Golf Intelligence tools", async () => {
  const client = new Client({ name: "golf-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "get_course_group_detail",
        "get_course_group_gps",
        "get_course_group_scorecard",
        "get_green_slope_image",
        "search_course_groups",
      ],
    );
    const refused = await client.callTool({
      name: "get_course_group_detail",
      arguments: { PublicId: "example", confirm_spend: false },
    });
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.content), /costs 3 credits/);
  } finally {
    await client.close();
  }
});
