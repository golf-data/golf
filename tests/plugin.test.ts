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
  assert.equal(manifest.logo, "assets/logo.svg");

  const variables = manifest.variables as {
    required: string[];
  };
  assert.deepEqual(variables.required, ["GI_CLIENT_ID", "GI_ACTIVE_TOKEN"]);
});

test("MCP config launches the committed bundle with plugin variables", async () => {
  const config = JSON.parse(await readFile("mcp.json", "utf8"));
  assert.deepEqual(config.mcpServers.golf, {
    command: "node",
    args: ["${PLUGIN_ROOT}/dist/index.js"],
    env: {
      GI_CLIENT_ID: "${GI_CLIENT_ID}",
      GI_ACTIVE_TOKEN: "${GI_ACTIVE_TOKEN}",
    },
  });
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
