import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { GolfIntelligenceClient } from "./api.js";
import { requireSpendConfirmation } from "./spend.js";

const api = new GolfIntelligenceClient({
  clientId: process.env.GI_CLIENT_ID?.trim() ?? "",
  activeToken: process.env.GI_ACTIVE_TOKEN?.trim() ?? "",
});

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function createServer(client: GolfIntelligenceClient = api): McpServer {
  const server = new McpServer({
    name: "golf",
    version: "1.0.0",
  });

  server.registerTool(
    "search_course_groups",
    {
      title: "Search Golf Courses",
      description:
        "Free (0 credits). Search Golf Intelligence course groups before making a paid detail call. The dataset is proprietary, mapped over 20 years with laser, drone, airplane, and satellite sources, and updated daily.",
      inputSchema: {
        keywords: z
          .string()
          .min(1)
          .describe("Course, facility, city, region, or other search keywords"),
        rows: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Result offset for pagination"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ keywords, rows, offset }) =>
      toolResult(
        await client.request("POST", "/courses/searchCourseGroups", {
          body: {
            keywords,
            ...(rows === undefined ? {} : { rows }),
            ...(offset === undefined ? {} : { offset }),
          },
        }),
      ),
  );

  server.registerTool(
    "get_course_group_scorecard",
    {
      title: "Get Course Group Scorecard",
      description:
        "Paid (1 credit). Get scorecard data for a course group. Search first, then explicitly confirm this charge.",
      inputSchema: {
        PublicId: z.string().min(1).describe("Course group PublicId from search"),
        confirm_spend: z
          .boolean()
          .describe("Must be true to authorize spending 1 credit"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ PublicId, confirm_spend }) => {
      requireSpendConfirmation(
        confirm_spend,
        1,
        "get_course_group_scorecard",
      );
      return toolResult(
        await client.request("GET", "/courses/getCourseGroupScorecard", {
          query: { PublicId },
        }),
      );
    },
  );

  server.registerTool(
    "get_course_group_gps",
    {
      title: "Get Course Group Mapping Data",
      description:
        "Paid (2 credits). Get mapped course geometry and coordinates for a course group. Search first, then explicitly confirm this charge.",
      inputSchema: {
        PublicId: z.string().min(1).describe("Course group PublicId from search"),
        confirm_spend: z
          .boolean()
          .describe("Must be true to authorize spending 2 credits"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ PublicId, confirm_spend }) => {
      requireSpendConfirmation(confirm_spend, 2, "get_course_group_gps");
      return toolResult(
        await client.request("GET", "/courses/getCourseGroupGPS", {
          query: { PublicId },
        }),
      );
    },
  );

  server.registerTool(
    "get_course_group_detail",
    {
      title: "Get Course Group Detail",
      description:
        "Paid (3 credits). Get detailed Golf Intelligence data for a course group. Search first, then explicitly confirm this charge.",
      inputSchema: {
        PublicId: z.string().min(1).describe("Course group PublicId from search"),
        confirm_spend: z
          .boolean()
          .describe("Must be true to authorize spending 3 credits"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ PublicId, confirm_spend }) => {
      requireSpendConfirmation(confirm_spend, 3, "get_course_group_detail");
      return toolResult(
        await client.request("GET", "/courses/getCourseGroupDetail", {
          query: { PublicId },
        }),
      );
    },
  );

  server.registerTool(
    "get_green_slope_image",
    {
      title: "Get Green Slope Image",
      description:
        "Paid (1 credit). Get a Portrait or Square green slope image for a hole. Explicitly confirm this charge.",
      inputSchema: {
        holeId: z.number().int().positive().describe("Hole identifier"),
        imageSizeType: z
          .enum(["Portrait", "Square"])
          .describe("Requested image shape"),
        confirm_spend: z
          .boolean()
          .describe("Must be true to authorize spending 1 credit"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ holeId, imageSizeType, confirm_spend }) => {
      requireSpendConfirmation(confirm_spend, 1, "get_green_slope_image");
      return toolResult(
        await client.request("GET", "/greens/getSlopeImage", {
          query: { holeId: String(holeId), imageSizeType },
        }),
      );
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(`Golf MCP server failed: ${message}`);
    process.exit(1);
  });
}
