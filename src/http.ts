import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Request, Response } from "express";
import { GolfIntelligenceClient, type Credentials } from "./api.js";
import { createServer } from "./index.js";
import { OAuthError, OAuthService } from "./oauth.js";

export const CLIENT_ID_HEADER = "x-gi-client-id";
export const ACTIVE_TOKEN_HEADER = "x-gi-active-token";

type HttpAppOptions = {
  env?: NodeJS.ProcessEnv;
  clientFactory?: (credentials: Credentials) => GolfIntelligenceClient;
  oauthService?: OAuthService;
};

class CredentialHeaderError extends Error {}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    throw new CredentialHeaderError(`${name} must be sent exactly once.`);
  }
  return value?.trim();
}

export function credentialsFromHeaders(
  headers: IncomingHttpHeaders,
): Credentials | undefined {
  const hasClientId = Object.hasOwn(headers, CLIENT_ID_HEADER);
  const hasActiveToken = Object.hasOwn(headers, ACTIVE_TOKEN_HEADER);
  if (!hasClientId && !hasActiveToken) {
    return undefined;
  }

  const clientId = headerValue(headers, CLIENT_ID_HEADER);
  const activeToken = headerValue(headers, ACTIVE_TOKEN_HEADER);
  if (!clientId || !activeToken) {
    throw new CredentialHeaderError(
      `${CLIENT_ID_HEADER} and ${ACTIVE_TOKEN_HEADER} must be provided together.`,
    );
  }
  return { clientId, activeToken };
}

export function createHttpApp(options: HttpAppOptions = {}) {
  const env = options.env ?? process.env;
  const clientFactory =
    options.clientFactory ??
    ((credentials: Credentials) => new GolfIntelligenceClient(credentials));
  const oauth = options.oauthService ?? new OAuthService(env);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  // Public, credential-free submission recording; never serve the OAuth data volume.
  app.use("/demo", express.static(resolve("public/demo"), {
    dotfiles: "deny", index: "index.html", fallthrough: false,
    setHeaders: res => { res.setHeader("X-Content-Type-Options", "nosniff"); },
  }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  const metadata = (_req: Request, res: Response) => {
    res
      .status(200)
      .set("Cache-Control", "public, max-age=300")
      .json(oauth.protectedResourceMetadata());
  };
  app.get("/.well-known/oauth-protected-resource", metadata);
  app.get("/.well-known/oauth-protected-resource/mcp", metadata);

  const authorizationMetadata = (_req: Request, res: Response) => {
    res
      .status(200)
      .set("Cache-Control", "public, max-age=300")
      .json(oauth.authorizationServerMetadata());
  };
  app.get("/.well-known/oauth-authorization-server", authorizationMetadata);
  app.get("/.well-known/oauth-authorization-server/mcp", authorizationMetadata);

  app.post("/oauth/register", (req: Request, res: Response) => {
    try {
      res
        .status(201)
        .set("Cache-Control", "no-store")
        .json(oauth.registerClient(req.body));
    } catch (error) {
      sendOAuthError(res, error);
    }
  });

  app.get("/oauth/authorize", (req: Request, res: Response) => {
    try {
      const { requestToken, request } = oauth.createAuthorizationRequest(
        req.query as Record<string, unknown>,
      );
      // Browsers can apply form-action to the redirect after the form POST.
      // Only allow the callback origin after OAuth redirect validation succeeds.
      const callbackOrigin = new URL(request.redirectUri).origin;
      // OpenAI's draft scanner relays the ChatGPT callback back to the platform.
      // Keep this exception limited to the validated ChatGPT callback origin.
      const formDestinations = callbackOrigin === "https://chatgpt.com"
        ? `${callbackOrigin} https://platform.openai.com`
        : callbackOrigin;
      res
        .status(200)
        .set("Cache-Control", "no-store")
        .set("Pragma", "no-cache")
        .set(
          "Content-Security-Policy",
          `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formDestinations}; frame-ancestors 'none'; base-uri 'none'`,
        )
        .type("html")
        .send(authorizationPage(requestToken));
    } catch (error) {
      sendAuthorizationError(res, error);
    }
  });

  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    const requestToken = bodyString(req.body, "authorization_request");
    try {
      const clientId = bodyString(req.body, "gi_client_id");
      const activeToken = bodyString(req.body, "gi_active_token");
      if (!requestToken || !clientId || !activeToken) {
        throw new OAuthError(
          "invalid_request",
          "Client ID and Active Token are required.",
        );
      }
      const credentials = { clientId, activeToken };
      try {
        await clientFactory(credentials).authenticate();
      } catch {
        throw new OAuthError(
          "access_denied",
          "The Client ID or Active Token was not accepted.",
          401,
        );
      }
      const result = oauth.completeAuthorization(requestToken, credentials);
      const redirect = new URL(result.redirectUri);
      redirect.searchParams.set("code", result.code);
      if (result.state) redirect.searchParams.set("state", result.state);
      redirect.searchParams.set("iss", oauth.config.issuer);
      res
        .status(302)
        .set("Cache-Control", "no-store")
        .redirect(redirect.toString());
    } catch (error) {
      if (requestToken && error instanceof OAuthError) {
        try {
          res
            .status(302)
            .set("Cache-Control", "no-store")
            .redirect(oauth.authorizationErrorRedirect(requestToken, error));
          return;
        } catch {
          // An invalid request envelope has no trusted redirect target.
        }
      }
      sendAuthorizationError(res, error);
    }
  });

  app.post("/oauth/token", (req: Request, res: Response) => {
    try {
      res
        .status(200)
        .set("Cache-Control", "no-store")
        .set("Pragma", "no-cache")
        .json(oauth.exchangeToken(bodyRecord(req.body), req));
    } catch (error) {
      sendOAuthError(res, error);
    }
  });

  app.get(
    "/.well-known/openai-apps-challenge",
    (_req: Request, res: Response) => {
      const token =
        env.OPENAI_APPS_CHALLENGE_TOKEN?.trim() ||
        env.OPENAI_APPS_CHALLENGE?.trim();
      if (!token) {
        res.status(404).end();
        return;
      }
      res.status(200).type("text/plain").send(token);
    },
  );

  app.post("/mcp", async (req: Request, res: Response) => {
    let server: ReturnType<typeof createServer> | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await Promise.allSettled([transport?.close(), server?.close()]);
    };

    try {
      const requestCredentials = credentialsFromHeaders(req.headers);
      const bearerToken = bearerTokenFromHeaders(req.headers);
      if (requestCredentials && bearerToken) {
        throw new CredentialHeaderError(
          "Use either OAuth bearer authentication or GI credential headers, not both.",
        );
      }
      let credentials = requestCredentials;
      if (bearerToken) {
        credentials = oauth.verifyAccessToken(bearerToken).credentials;
      }
      if (!credentials) {
        sendMcpUnauthorized(res, oauth);
        return;
      }
      oauth.assertCredentialsAllowed(credentials);
      const client = clientFactory(credentials);
      server = createServer(client);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.once("close", () => void cleanup());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      await cleanup();
      if (!res.headersSent) {
        const badCredentials = error instanceof CredentialHeaderError;
        if (error instanceof OAuthError && error.status === 401) {
          sendMcpUnauthorized(res, oauth, error.message, true);
          return;
        }
        if (error instanceof OAuthError) {
          res.status(error.status).json({
            jsonrpc: "2.0",
            error: { code: -32003, message: error.message },
            id: null,
          });
          return;
        }
        res.status(badCredentials ? 400 : 500).json({
          jsonrpc: "2.0",
          error: {
            code: badCredentials ? -32600 : -32603,
            message: badCredentials
              ? error.message
              : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: unknown, res: {
    status: (code: number) => { json: (body: unknown) => void };
  }) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

function bearerTokenFromHeaders(
  headers: IncomingHttpHeaders,
): string | undefined {
  const value = headerValue(headers, "authorization");
  if (!value) return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  if (!match) {
    throw new CredentialHeaderError(
      "Authorization must contain exactly one Bearer token.",
    );
  }
  return match[1];
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bodyString(value: unknown, name: string): string {
  const field = bodyRecord(value)[name];
  return typeof field === "string" ? field.trim() : "";
}

function sendMcpUnauthorized(
  res: Response,
  oauth: OAuthService,
  detail = "OAuth authentication is required.",
  invalidToken = false,
): void {
  const metadataUrl = `${oauth.config.issuer}/.well-known/oauth-protected-resource/mcp`;
  const challenge =
    `Bearer resource_metadata="${metadataUrl}", ` +
    `scope="golf:read"` +
    (invalidToken
      ? `, error="invalid_token", error_description="${detail.replaceAll('"', "'")}"`
      : "");
  res
    .status(401)
    .set("WWW-Authenticate", challenge)
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: detail },
      id: null,
    });
}

function sendOAuthError(res: Response, error: unknown): void {
  const oauthError =
    error instanceof OAuthError
      ? error
      : new OAuthError("server_error", "OAuth request failed.", 500);
  res
    .status(oauthError.status)
    .set("Cache-Control", "no-store")
    .set("Pragma", "no-cache")
    .json({
      error: oauthError.error,
      error_description: oauthError.message,
    });
}

function sendAuthorizationError(res: Response, error: unknown): void {
  const oauthError =
    error instanceof OAuthError
      ? error
      : new OAuthError("server_error", "Authorization failed.", 500);
  res
    .status(oauthError.status)
    .set("Cache-Control", "no-store")
    .set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    )
    .type("html")
    .send(errorPage(oauthError.message));
}

function authorizationPage(requestToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Golf Intelligence</title>
  <style>
    body{font:16px system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#17201b}
    label{display:block;font-weight:600;margin-top:1rem}input{box-sizing:border-box;width:100%;padding:.7rem;margin-top:.35rem}
    button{margin-top:1.5rem;padding:.75rem 1rem;background:#176b43;color:white;border:0;border-radius:.25rem}
    p{line-height:1.5}.note{color:#526057;font-size:.9rem}
  </style>
</head>
<body>
  <main>
    <h1>Connect Golf Intelligence</h1>
    <p>Sign in with the Client ID and Active Token from your Golf Intelligence API Account. Calls made through ChatGPT use that account and its credits.</p>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="authorization_request" value="${escapeHtml(requestToken)}">
      <label for="gi_client_id">Client ID</label>
      <input id="gi_client_id" name="gi_client_id" required autocomplete="username">
      <label for="gi_active_token">Active Token</label>
      <input id="gi_active_token" name="gi_active_token" type="password" required autocomplete="current-password">
      <button type="submit">Authorize ChatGPT</button>
    </form>
    <p class="note">Your credentials are validated with Golf Intelligence and bound to encrypted OAuth tokens. They are not logged.</p>
  </main>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golf Intelligence authorization error</title>
<style>body{font:16px system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#17201b}</style>
</head><body><main><h1>Authorization failed</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function configuredPort(): number {
  const value = process.env.PORT?.trim() || "3000";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${value}.`);
  }
  return port;
}

export async function startHttpServer(
  port = configuredPort(),
  host = "0.0.0.0",
): Promise<HttpServer> {
  const app = createHttpApp();
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, host, () => resolve(httpServer));
    httpServer.once("error", reject);
  });
}

async function main(): Promise<void> {
  const port = configuredPort();
  const httpServer = await startHttpServer(port);
  console.log(`Golf MCP Streamable HTTP server listening on 0.0.0.0:${port}`);

  const shutdown = () => {
    httpServer.close((error) => {
      if (error) {
        console.error(`Golf MCP HTTP shutdown failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(`Golf MCP HTTP server failed: ${message}`);
    process.exit(1);
  });
}
