import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AUTH_URL,
  GolfIntelligenceClient,
  type Credentials,
} from "../src/api.js";
import {
  ACTIVE_TOKEN_HEADER,
  CLIENT_ID_HEADER,
  createHttpApp,
  credentialsFromHeaders,
} from "../src/http.js";

const OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

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
    env: { OAUTH_ENCRYPTION_KEY },
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
        idempotentHint: tool.name === "search_course_groups",
      });
      assert.deepEqual(
        (tool as { _meta?: { securitySchemes?: unknown } })._meta
          ?.securitySchemes,
        [{ type: "oauth2", scopes: ["golf:read"] }],
      );
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
    OAUTH_ENCRYPTION_KEY,
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
    OAUTH_ENCRYPTION_KEY,
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

test("OAuth discovery, PKCE, refresh, and account-bound tool calls work", async () => {
  const apiPaths: string[] = [];
  const credentialsSeen: Credentials[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    if (String(input) === AUTH_URL) {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("client_id"), "user-client");
      assert.equal(form.get("code"), "user-active-token");
      return Response.json({ access_token: "gi-api-token", expires_in: 3600 });
    }
    const url = new URL(String(input));
    apiPaths.push(url.pathname);
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer gi-api-token",
    );
    return Response.json({ path: url.pathname });
  };
  const redirectUri = "https://chatgpt.com/connector/oauth/test-callback";
  const stateDirectory = mkdtempSync(join(tmpdir(), "golf-oauth-"));
  const oauthEnv = {
    OAUTH_ENCRYPTION_KEY,
    OAUTH_CLIENT_ID: "chatgpt-client",
    OAUTH_REDIRECT_URIS: redirectUri,
    OAUTH_STATE_FILE: join(stateDirectory, "state.json"),
    GI_CLIENT_ID: "must-not-be-used",
    GI_ACTIVE_TOKEN: "must-not-be-used",
  };
  const app = createHttpApp({
    env: oauthEnv,
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
  const verifier = "pkce-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  try {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      const metadata = (await response.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      assert.equal(metadata.resource, "https://mcp.golfintelligence.com/mcp");
      assert.deepEqual(metadata.authorization_servers, [
        "https://mcp.golfintelligence.com",
      ]);
    }
    const serverMetadata = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server`,
    );
    assert.equal(serverMetadata.status, 200);
    assert.deepEqual(
      (await serverMetadata.json() as { code_challenge_methods_supported: string[] })
        .code_challenge_methods_supported,
      ["S256"],
    );
    const rejectedRegistration = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    });
    assert.equal(rejectedRegistration.status, 400);
    const acceptedRegistration = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://chatgpt.com/connector/oauth/test-callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(acceptedRegistration.status, 201);
    const oauthClientId = (
      await acceptedRegistration.json() as { client_id: string }
    ).client_id;
    assert.match(oauthClientId, /^gi1\./);

    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: oauthClientId,
      redirect_uri: redirectUri,
      resource: "https://mcp.golfintelligence.com/mcp",
      scope: "golf:read",
      state: "chatgpt-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const authorizePage = await fetch(authorizeUrl);
    assert.equal(authorizePage.status, 200);
    assert.equal(
      authorizePage.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com https://platform.openai.com; frame-ancestors 'none'; base-uri 'none'",
    );
    const invalidAuthorizeUrl = new URL(authorizeUrl);
    invalidAuthorizeUrl.searchParams.set("redirect_uri", "https://evil.example/callback");
    const invalidAuthorizePage = await fetch(invalidAuthorizeUrl);
    assert.equal(invalidAuthorizePage.status, 400);
    assert.ok(!invalidAuthorizePage.headers.get("content-security-policy")?.includes("evil.example"));
    const html = await authorizePage.text();
    const requestToken = /name="authorization_request" value="([^"]+)"/.exec(
      html,
    )?.[1];
    assert.ok(requestToken);

    const consent = await fetch(`${baseUrl}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        authorization_request: requestToken,
        gi_client_id: "user-client",
        gi_active_token: "user-active-token",
      }),
      redirect: "manual",
    });
    assert.equal(consent.status, 302);
    const callback = new URL(consent.headers.get("location")!);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), "chatgpt-state");
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: oauthClientId,
        redirect_uri: redirectUri,
        resource: "https://mcp.golfintelligence.com/mcp",
        code,
        code_verifier: verifier,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    assert.equal(tokens.expires_in, 3600);

    const replay = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: oauthClientId,
        redirect_uri: redirectUri,
        resource: "https://mcp.golfintelligence.com/mcp",
        code,
        code_verifier: verifier,
      }),
    });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json() as { error: string }).error, "invalid_grant");

    const refreshResponse = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: oauthClientId,
        resource: "https://mcp.golfintelligence.com/mcp",
        refresh_token: tokens.refresh_token,
      }),
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = (await refreshResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const client = new Client({ name: "oauth-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${refreshed.access_token}` },
        },
      },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 5);
      await client.callTool({
        name: "search_course_groups",
        arguments: { keywords: "St Andrews" },
      });
      const refused = await client.callTool({
        name: "get_course_group_detail",
        arguments: { PublicId: "course", confirm_spend: false },
      });
      assert.equal(refused.isError, true);
      for (const [name, argumentsValue] of [
        [
          "get_course_group_scorecard",
          { PublicId: "course", confirm_spend: true },
        ],
        ["get_course_group_gps", { PublicId: "course", confirm_spend: true }],
        ["get_course_group_detail", { PublicId: "course", confirm_spend: true }],
        [
          "get_green_slope_image",
          { holeId: 1, imageSizeType: "Portrait", confirm_spend: true },
        ],
      ] as const) {
        const result = await client.callTool({ name, arguments: argumentsValue });
        assert.equal(result.isError, undefined);
      }
    } finally {
      await client.close();
    }

    assert.deepEqual(apiPaths, [
      "/courses/searchCourseGroups",
      "/courses/getCourseGroupScorecard",
      "/courses/getCourseGroupGPS",
      "/courses/getCourseGroupDetail",
      "/greens/getSlopeImage",
    ]);

    const refreshReplay = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: oauthClientId,
        resource: "https://mcp.golfintelligence.com/mcp",
        refresh_token: tokens.refresh_token,
      }),
    });
    assert.equal(refreshReplay.status, 400);
    assert.equal(
      (await refreshReplay.json() as { error: string }).error,
      "invalid_grant",
    );

    const restartedApp = createHttpApp({ env: oauthEnv });
    const restartedServer = await new Promise<
      ReturnType<typeof restartedApp.listen>
    >((resolve) => {
      const listening = restartedApp.listen(0, "127.0.0.1", () =>
        resolve(listening),
      );
    });
    try {
      const restartedPort = (restartedServer.address() as AddressInfo).port;
      const revokedFamily = await fetch(
        `http://127.0.0.1:${restartedPort}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: oauthClientId,
            resource: "https://mcp.golfintelligence.com/mcp",
            refresh_token: refreshed.refresh_token,
          }),
        },
      );
      assert.equal(revokedFamily.status, 400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        restartedServer.close((error?: Error) =>
          error ? reject(error) : resolve(),
        );
      });
    }

    assert.ok(
      credentialsSeen.length > 0 &&
        credentialsSeen.every(
          (value) =>
            value.clientId === "user-client" &&
            value.activeToken === "user-active-token",
        ),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => (error ? reject(error) : resolve()));
    });
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test("missing or invalid OAuth never falls back to global GI environment credentials", async () => {
  const credentialsSeen: Credentials[] = [];
  const app = createHttpApp({
    env: {
      OAUTH_ENCRYPTION_KEY,
      GI_CLIENT_ID: "global-client",
      GI_ACTIVE_TOKEN: "global-token",
      OAUTH_ALLOWED_GI_CLIENT_IDS: "allowed-review-client",
    },
    clientFactory: (credentials) => {
      credentialsSeen.push(credentials);
      return new GolfIntelligenceClient(credentials);
    },
  });
  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = httpServer.address() as AddressInfo;
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_course_group_detail",
        arguments: { PublicId: "course", confirm_spend: true },
      },
    }),
  };
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/mcp`, request);
    assert.equal(missing.status, 401);
    assert.match(
      missing.headers.get("www-authenticate") ?? "",
      /oauth-protected-resource\/mcp/,
    );

    const invalid = await fetch(`http://127.0.0.1:${port}/mcp`, {
      ...request,
      headers: {
        ...request.headers,
        Authorization: "Bearer not-a-valid-token",
      },
    });
    assert.equal(invalid.status, 401);

    const disallowedHeaders = await fetch(`http://127.0.0.1:${port}/mcp`, {
      ...request,
      headers: {
        ...request.headers,
        [CLIENT_ID_HEADER]: "other-client",
        [ACTIVE_TOKEN_HEADER]: "other-token",
      },
    });
    assert.equal(disallowedHeaders.status, 403);
    assert.equal(credentialsSeen.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
});
