import type { IncomingHttpHeaders, Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { GolfIntelligenceClient, type Credentials } from "./api.js";
import { createServer } from "./index.js";

export const CLIENT_ID_HEADER = "x-gi-client-id";
export const ACTIVE_TOKEN_HEADER = "x-gi-active-token";
export const OPENAI_APPS_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
export const DEFAULT_OPENAI_APPS_CHALLENGE =
  "Bpx9YLscvKWkLtCgGhBfgWLF7Kk3xGAyr6Rnva2PyIk";

type HttpAppOptions = {
  env?: NodeJS.ProcessEnv;
  clientFactory?: (credentials: Credentials) => GolfIntelligenceClient;
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
  const envClient = clientFactory({
    clientId: env.GI_CLIENT_ID?.trim() ?? "",
    activeToken: env.GI_ACTIVE_TOKEN?.trim() ?? "",
  });
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get(OPENAI_APPS_CHALLENGE_PATH, (_req: Request, res: Response) => {
    const challenge =
      env.OPENAI_APPS_CHALLENGE?.trim() || DEFAULT_OPENAI_APPS_CHALLENGE;
    res.status(200).type("text/plain").send(challenge);
  });

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
      const client = requestCredentials
        ? clientFactory(requestCredentials)
        : envClient;
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
