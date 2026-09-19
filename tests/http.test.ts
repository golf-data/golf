import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AUTH_URL, GolfIntelligenceClient } from "../src/api.js";
import {
  ACTIVE_TOKEN_HEADER,
  CLIENT_ID_HEADER,
  createHttpApp,
  credentialsFromHeaders,
} from "../src/http.js";

test("credential headers must be complete and take request credentials", () => {
  assert.equal(credentialsFromHeaders({}), undefined);
  assert.deepEqual(
    credentialsFromHeaders({
      [CLIENT_ID_HEADER]: " request-client ",
      [ACTIVE_TOKEN_HEADER]: " request-token ",
    }),
    { clientId: "request-client", activeToken: "request-token" },
  );
  assert.throws(
    () => credentialsFromHeaders({ [CLIENT_ID_HEADER]: "request-client" }),
    /must be provided together/,
  );
});

test("Streamable HTTP exposes health, tools, annotations, and header auth", async () => {
  const credentialsSeen: Array<{ clientId: string; activeToken: string }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    if (String(input) === AUTH_URL) {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("client_id"), "review-client");
      assert.equal(form.get("code"), "review-token");
      return Response.json({ access_token: "api-access-token" });
    }
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer api-access-token",
    );
    return Response.json({ courses: [] });
  };
  const app = createHttpApp({
    env: {},
    clientFactory: (credentials) => {
      credentialsSeen.push(credentials);
      return new GolfIntelligenceClient(credentials, fetchMock);
    },
  });
  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const missingChallenge = await fetch(
    `${baseUrl}/.well-known/openai-apps-challenge`,
  );
  assert.equal(missingChallenge.status, 404);

  const client = new Client({ name: "http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          [CLIENT_ID_HEADER]: "review-client",
          [ACTIVE_TOKEN_HEADER]: "review-token",
        },
      },
    },
  );

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }

    const result = await client.callTool({
      name: "search_course_groups",
      arguments: { keywords: "St Andrews" },
    });
    assert.equal(result.isError, undefined);
    const content = (
      result as { content: Array<{ type: string; text: string }> }
    ).content[0];
    assert.equal(content.type, "text");
    assert.deepEqual(JSON.parse(content.text), { courses: [] });
    assert.ok(
      credentialsSeen.some(
        ({ clientId, activeToken }) =>
          clientId === "review-client" && activeToken === "review-token",
      ),
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
});

test("OpenAI Apps domain challenge is served as text/plain from env", async () => {
  async function listen(env: NodeJS.ProcessEnv) {
    const app = createHttpApp({ env });
    const httpServer = await new Promise<ReturnType<typeof app.listen>>(
      (resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      },
    );
    const { port } = httpServer.address() as AddressInfo;
    return { httpServer, baseUrl: `http://127.0.0.1:${port}` };
  }

  async function close(
    httpServer: Awaited<ReturnType<typeof listen>>["httpServer"],
  ) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }

  const preferred = await listen({
    OPENAI_APPS_CHALLENGE_TOKEN: " preferred-token ",
    OPENAI_APPS_CHALLENGE: "fallback-token",
  });
  try {
    const response = await fetch(
      `${preferred.baseUrl}/.well-known/openai-apps-challenge`,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
    assert.equal(await response.text(), "preferred-token");
  } finally {
    await close(preferred.httpServer);
  }

  const fallback = await listen({
    OPENAI_APPS_CHALLENGE: " fallback-token ",
  });
  try {
    const response = await fetch(
      `${fallback.baseUrl}/.well-known/openai-apps-challenge`,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "fallback-token");
  } finally {
    await close(fallback.httpServer);
  }
});
