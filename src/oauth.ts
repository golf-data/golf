import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Request } from "express";
import type { Credentials } from "./api.js";

export const GOLF_SCOPE = "golf:read";
const RESOURCE_PATH = "/mcp";
const AUTH_REQUEST_LIFETIME_SECONDS = 10 * 60;
const AUTH_CODE_LIFETIME_SECONDS = 5 * 60;
const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

type TokenKind =
  | "authorization_request"
  | "authorization_code"
  | "access_token"
  | "refresh_token"
  | "dynamic_client";

type TimedPayload = {
  kind: TokenKind;
  iat: number;
  exp?: number;
};

export type AuthorizationRequest = TimedPayload & {
  kind: "authorization_request";
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  state?: string;
  codeChallenge: string;
};

type AuthorizationCode = TimedPayload & {
  kind: "authorization_code";
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  credentials: Credentials;
  subject: string;
  nonce: string;
};

export type AccessGrant = TimedPayload & {
  kind: "access_token";
  issuer: string;
  resource: string;
  scope: string;
  credentials: Credentials;
  subject: string;
  family: string;
};

type RefreshGrant = TimedPayload & {
  kind: "refresh_token";
  clientId: string;
  issuer: string;
  resource: string;
  scope: string;
  credentials: Credentials;
  subject: string;
  family: string;
  nonce: string;
};

type DynamicClient = TimedPayload & {
  kind: "dynamic_client";
  redirectUris: string[];
};

export type OAuthConfig = {
  issuer: string;
  resource: string;
  documentationUrl: string;
  staticClientId?: string;
  staticClientSecret?: string;
  staticRedirectUris: string[];
  allowedGiClientIds?: Set<string>;
};

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function requiredEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const encoded = env.OAUTH_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY must be set to a base64-encoded 32-byte key.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return key;
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") {
    throw new Error("OAUTH_ISSUER must use HTTPS.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OAUTH_ISSUER must be an origin without a path.");
  }
  return url.origin;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class OAuthService {
  readonly config: OAuthConfig;
  private readonly key: Buffer;
  private readonly stateFile?: string;
  private readonly redeemedCodes = new Map<string, number>();
  private readonly refreshFamilies = new Map<
    string,
    { currentNonce: string; expiresAt: number }
  >();
  private readonly revokedRefreshFamilies = new Map<string, number>();

  constructor(env: NodeJS.ProcessEnv) {
    this.key = requiredEncryptionKey(env);
    this.stateFile = env.OAUTH_STATE_FILE?.trim() || undefined;
    const issuer = normalizedOrigin(
      env.OAUTH_ISSUER?.trim() || "https://mcp.golfintelligence.com",
    );
    const staticClientId = env.OAUTH_CLIENT_ID?.trim() || undefined;
    const staticRedirectUris = csv(env.OAUTH_REDIRECT_URIS);
    if (staticClientId && staticRedirectUris.length === 0) {
      throw new Error(
        "OAUTH_REDIRECT_URIS is required when OAUTH_CLIENT_ID is set.",
      );
    }
    if (staticRedirectUris.some((uri) => !isAllowedStaticRedirectUri(uri))) {
      throw new Error(
        "OAUTH_REDIRECT_URIS entries must use HTTPS (or HTTP loopback for local testing).",
      );
    }
    this.config = {
      issuer,
      resource: `${issuer}${RESOURCE_PATH}`,
      documentationUrl:
        "https://github.com/golf-data/golf/blob/main/docs/OPENAI-CHATGPT-OAUTH.md",
      staticClientId,
      staticClientSecret: env.OAUTH_CLIENT_SECRET?.trim() || undefined,
      staticRedirectUris,
      allowedGiClientIds:
        csv(env.OAUTH_ALLOWED_GI_CLIENT_IDS).length > 0
          ? new Set(csv(env.OAUTH_ALLOWED_GI_CLIENT_IDS))
          : undefined,
    };
    this.loadState();
  }

  protectedResourceMetadata() {
    return {
      resource: this.config.resource,
      authorization_servers: [this.config.issuer],
      scopes_supported: [GOLF_SCOPE],
      resource_documentation: this.config.documentationUrl,
      bearer_methods_supported: ["header"],
    };
  }

  authorizationServerMetadata() {
    const methods = ["none"];
    if (this.config.staticClientSecret) {
      methods.push("client_secret_basic", "client_secret_post");
    }
    return {
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.issuer}/oauth/authorize`,
      token_endpoint: `${this.config.issuer}/oauth/token`,
      registration_endpoint: `${this.config.issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: methods,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [GOLF_SCOPE],
    };
  }

  registerClient(input: unknown) {
    if (!isRecord(input) || !Array.isArray(input.redirect_uris)) {
      throw new OAuthError("invalid_client_metadata", "redirect_uris is required.");
    }
    const redirectUris = input.redirect_uris;
    if (
      redirectUris.length === 0 ||
      redirectUris.some(
        (value) =>
          typeof value !== "string" || !isAllowedDynamicRedirectUri(value),
      )
    ) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "Dynamic registration is limited to ChatGPT callback URLs.",
      );
    }
    if (
      input.token_endpoint_auth_method !== undefined &&
      input.token_endpoint_auth_method !== "none"
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        "Dynamic clients must use token_endpoint_auth_method=none.",
      );
    }
    const clientId = this.seal("dynamic_client", {
      kind: "dynamic_client",
      iat: nowSeconds(),
      redirectUris,
    } satisfies DynamicClient);
    return {
      client_id: clientId,
      client_id_issued_at: nowSeconds(),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  createAuthorizationRequest(query: Record<string, unknown>): {
    requestToken: string;
    request: AuthorizationRequest;
  } {
    const responseType = stringValue(query.response_type);
    const clientId = stringValue(query.client_id);
    const redirectUri = stringValue(query.redirect_uri);
    const resource = stringValue(query.resource);
    const codeChallenge = stringValue(query.code_challenge);
    const codeChallengeMethod = stringValue(query.code_challenge_method);
    const requestedScope = stringValue(query.scope) || GOLF_SCOPE;

    if (responseType !== "code") {
      throw new OAuthError("unsupported_response_type", "response_type must be code.");
    }
    if (!clientId || !redirectUri) {
      throw new OAuthError("invalid_request", "client_id and redirect_uri are required.");
    }
    this.validateClientRedirect(clientId, redirectUri);
    if (resource !== this.config.resource) {
      throw new OAuthError(
        "invalid_target",
        `resource must be ${this.config.resource}.`,
      );
    }
    if (
      codeChallengeMethod !== "S256" ||
      !codeChallenge ||
      !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
    ) {
      throw new OAuthError(
        "invalid_request",
        "S256 PKCE with a valid code_challenge is required.",
      );
    }
    if (!scopeIsAllowed(requestedScope)) {
      throw new OAuthError("invalid_scope", `Only ${GOLF_SCOPE} is supported.`);
    }

    const request: AuthorizationRequest = {
      kind: "authorization_request",
      iat: nowSeconds(),
      exp: nowSeconds() + AUTH_REQUEST_LIFETIME_SECONDS,
      clientId,
      redirectUri,
      resource,
      scope: GOLF_SCOPE,
      state: stringValue(query.state) || undefined,
      codeChallenge,
    };
    return {
      request,
      requestToken: this.seal("authorization_request", request),
    };
  }

  completeAuthorization(
    requestToken: string,
    credentials: Credentials,
  ): { redirectUri: string; code: string; state?: string } {
    const request = this.open<AuthorizationRequest>(
      "authorization_request",
      requestToken,
    );
    if (request.kind !== "authorization_request") {
      throw new OAuthError("invalid_request", "Invalid authorization request.");
    }
    this.validateClientRedirect(request.clientId, request.redirectUri);
    this.assertGiClientAllowed(credentials.clientId);
    const subject = subjectFor(credentials.clientId);
    const code = this.seal("authorization_code", {
      kind: "authorization_code",
      iat: nowSeconds(),
      exp: nowSeconds() + AUTH_CODE_LIFETIME_SECONDS,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scope: request.scope,
      codeChallenge: request.codeChallenge,
      credentials,
      subject,
      nonce: randomBytes(16).toString("base64url"),
    } satisfies AuthorizationCode);
    return { redirectUri: request.redirectUri, code, state: request.state };
  }

  exchangeToken(body: Record<string, unknown>, req: Request) {
    const grantType = stringValue(body.grant_type);
    if (grantType === "authorization_code") {
      return this.exchangeAuthorizationCode(body, req);
    }
    if (grantType === "refresh_token") {
      return this.exchangeRefreshToken(body, req);
    }
    throw new OAuthError("unsupported_grant_type", "Unsupported grant_type.");
  }

  verifyAccessToken(token: string): AccessGrant {
    const grant = this.open<AccessGrant>("access_token", token);
    if (
      grant.kind !== "access_token" ||
      grant.issuer !== this.config.issuer ||
      grant.resource !== this.config.resource ||
      !scopeIsAllowed(grant.scope)
    ) {
      throw new OAuthError("invalid_token", "The access token is invalid.", 401);
    }
    if (this.revokedRefreshFamilies.has(grant.family)) {
      throw new OAuthError(
        "invalid_token",
        "The OAuth grant was revoked. Reconnect the account.",
        401,
      );
    }
    this.assertCredentialsAllowed(grant.credentials);
    return grant;
  }

  assertCredentialsAllowed(credentials: Credentials): void {
    this.assertGiClientAllowed(credentials.clientId);
  }

  authorizationErrorRedirect(
    requestToken: string,
    error: OAuthError,
  ): string {
    const request = this.open<AuthorizationRequest>(
      "authorization_request",
      requestToken,
    );
    this.validateClientRedirect(request.clientId, request.redirectUri);
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("error", error.error);
    redirect.searchParams.set("error_description", error.message);
    if (request.state) redirect.searchParams.set("state", request.state);
    redirect.searchParams.set("iss", this.config.issuer);
    return redirect.toString();
  }

  private exchangeAuthorizationCode(
    body: Record<string, unknown>,
    req: Request,
  ) {
    const codeValue = stringValue(body.code);
    const clientId = stringValue(body.client_id) || basicClient(req)?.clientId || "";
    const redirectUri = stringValue(body.redirect_uri);
    const resource = stringValue(body.resource);
    const verifier = stringValue(body.code_verifier);
    if (!codeValue || !clientId || !redirectUri || !verifier) {
      throw new OAuthError(
        "invalid_request",
        "code, client_id, redirect_uri, and code_verifier are required.",
      );
    }
    this.authenticateTokenClient(clientId, body, req);
    const code = this.open<AuthorizationCode>("authorization_code", codeValue);
    if (
      code.kind !== "authorization_code" ||
      code.clientId !== clientId ||
      code.redirectUri !== redirectUri ||
      code.resource !== resource ||
      !pkceMatches(verifier, code.codeChallenge)
    ) {
      throw new OAuthError("invalid_grant", "The authorization code is invalid.");
    }
    this.consumeAuthorizationCode(code.nonce, code.exp ?? 0);
    return this.issueTokens(
      clientId,
      code.credentials,
      code.subject,
      code.scope,
      code.resource,
    );
  }

  private exchangeRefreshToken(body: Record<string, unknown>, req: Request) {
    const refreshToken = stringValue(body.refresh_token);
    const clientId = stringValue(body.client_id) || basicClient(req)?.clientId || "";
    const resource = stringValue(body.resource);
    if (!refreshToken || !clientId) {
      throw new OAuthError(
        "invalid_request",
        "refresh_token and client_id are required.",
      );
    }
    this.authenticateTokenClient(clientId, body, req);
    const grant = this.open<RefreshGrant>("refresh_token", refreshToken);
    if (
      grant.kind !== "refresh_token" ||
      grant.clientId !== clientId ||
      grant.issuer !== this.config.issuer ||
      grant.resource !== resource
    ) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid.");
    }
    this.assertCredentialsAllowed(grant.credentials);
    this.rotateRefreshFamily(grant);
    return this.issueTokens(
      clientId,
      grant.credentials,
      grant.subject,
      grant.scope,
      grant.resource,
      grant.family,
    );
  }

  private issueTokens(
    clientId: string,
    credentials: Credentials,
    subject: string,
    scope: string,
    resource: string,
    refreshFamily = randomBytes(16).toString("base64url"),
  ) {
    const issuedAt = nowSeconds();
    const refreshNonce = randomBytes(16).toString("base64url");
    const refreshExpiry = issuedAt + REFRESH_TOKEN_LIFETIME_SECONDS;
    this.refreshFamilies.set(refreshFamily, {
      currentNonce: refreshNonce,
      expiresAt: refreshExpiry,
    });
    const accessToken = this.seal("access_token", {
      kind: "access_token",
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS,
      issuer: this.config.issuer,
      resource,
      scope,
      credentials,
      subject,
      family: refreshFamily,
    } satisfies AccessGrant);
    const refreshToken = this.seal("refresh_token", {
      kind: "refresh_token",
      iat: issuedAt,
      exp: issuedAt + REFRESH_TOKEN_LIFETIME_SECONDS,
      clientId,
      issuer: this.config.issuer,
      resource,
      scope,
      credentials,
      subject,
      family: refreshFamily,
      nonce: refreshNonce,
    } satisfies RefreshGrant);
    this.persistState();
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
      refresh_token: refreshToken,
      scope,
    };
  }

  private authenticateTokenClient(
    clientId: string,
    body: Record<string, unknown>,
    req: Request,
  ): void {
    if (clientId === this.config.staticClientId) {
      const expected = this.config.staticClientSecret;
      if (!expected) return;
      const supplied =
        basicClient(req, clientId)?.secret || stringValue(body.client_secret);
      if (!supplied || !safeEqual(supplied, expected)) {
        throw new OAuthError("invalid_client", "Client authentication failed.", 401);
      }
      return;
    }
    const dynamicClient = this.open<DynamicClient>("dynamic_client", clientId);
    if (dynamicClient.kind !== "dynamic_client") {
      throw new OAuthError("invalid_client", "Unknown OAuth client.", 401);
    }
  }

  private validateClientRedirect(clientId: string, redirectUri: string): void {
    if (clientId === this.config.staticClientId) {
      if (!this.config.staticRedirectUris.includes(redirectUri)) {
        throw new OAuthError("invalid_request", "redirect_uri is not allowlisted.");
      }
      return;
    }
    const client = this.open<DynamicClient>("dynamic_client", clientId);
    if (
      client.kind !== "dynamic_client" ||
      !client.redirectUris.includes(redirectUri)
    ) {
      throw new OAuthError("invalid_request", "redirect_uri is not registered.");
    }
  }

  private assertGiClientAllowed(clientId: string): void {
    const allowed = this.config.allowedGiClientIds;
    if (allowed && !allowed.has(clientId)) {
      throw new OAuthError(
        "access_denied",
        "This Golf Intelligence Client ID is not enabled for review.",
        403,
      );
    }
  }

  private rotateRefreshFamily(grant: RefreshGrant): void {
    const now = nowSeconds();
    for (const [family, state] of this.refreshFamilies) {
      if (state.expiresAt <= now) this.refreshFamilies.delete(family);
    }
    for (const [family, expiry] of this.revokedRefreshFamilies) {
      if (expiry <= now) this.revokedRefreshFamilies.delete(family);
    }
    if (this.revokedRefreshFamilies.has(grant.family)) {
      throw new OAuthError(
        "invalid_grant",
        "This refresh token family was revoked. Reconnect the account.",
      );
    }
    const state = this.refreshFamilies.get(grant.family);
    if (state && state.currentNonce !== grant.nonce) {
      this.refreshFamilies.delete(grant.family);
      this.revokedRefreshFamilies.set(grant.family, grant.exp ?? now);
      this.persistState();
      throw new OAuthError(
        "invalid_grant",
        "Refresh token reuse was detected. Reconnect the account.",
      );
    }
    // On a process restart, accept the still-valid encrypted token once and
    // establish its family state before rotating it.
    if (!state) {
      this.refreshFamilies.set(grant.family, {
        currentNonce: grant.nonce,
        expiresAt: grant.exp ?? now,
      });
    }
  }

  private consumeAuthorizationCode(nonce: string, expiresAt: number): void {
    const now = nowSeconds();
    for (const [key, expiry] of this.redeemedCodes) {
      if (expiry <= now) this.redeemedCodes.delete(key);
    }
    if (this.redeemedCodes.has(nonce)) {
      throw new OAuthError("invalid_grant", "The authorization code was already used.");
    }
    this.redeemedCodes.set(nonce, expiresAt);
    this.persistState();
  }

  private loadState(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as {
        redeemedCodes?: Array<[string, number]>;
        refreshFamilies?: Array<
          [string, { currentNonce: string; expiresAt: number }]
        >;
        revokedRefreshFamilies?: Array<[string, number]>;
      };
      for (const [nonce, expiry] of parsed.redeemedCodes ?? []) {
        this.redeemedCodes.set(nonce, expiry);
      }
      for (const [family, state] of parsed.refreshFamilies ?? []) {
        this.refreshFamilies.set(family, state);
      }
      for (const [family, expiry] of parsed.revokedRefreshFamilies ?? []) {
        this.revokedRefreshFamilies.set(family, expiry);
      }
    } catch {
      throw new Error(
        `OAuth state file ${this.stateFile} is unreadable or invalid; refusing to start.`,
      );
    }
  }

  private persistState(): void {
    if (!this.stateFile) return;
    const directory = dirname(this.stateFile);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary =
      `${this.stateFile}.${process.pid}.` +
      `${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        redeemedCodes: [...this.redeemedCodes],
        refreshFamilies: [...this.refreshFamilies],
        revokedRefreshFamilies: [...this.revokedRefreshFamilies],
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporary, this.stateFile);
  }

  private seal(kind: TokenKind, value: object): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(kind));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `gi1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
  }

  private open<T extends TimedPayload>(kind: TokenKind, token: string): T {
    try {
      const [version, ivValue, encryptedValue, tagValue, extra] = token.split(".");
      if (version !== "gi1" || !ivValue || !encryptedValue || !tagValue || extra) {
        throw new Error("Malformed token");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(ivValue, "base64url"),
      );
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64url")),
        decipher.final(),
      ]);
      const payload = JSON.parse(plaintext.toString("utf8")) as T;
      if (
        payload.kind !== kind ||
        typeof payload.iat !== "number" ||
        (payload.exp !== undefined && payload.exp <= nowSeconds())
      ) {
        throw new Error("Expired or invalid token");
      }
      return payload;
    } catch {
      const errorName = kind === "access_token" ? "invalid_token" : "invalid_grant";
      const status = kind === "access_token" ? 401 : 400;
      throw new OAuthError(errorName, "The supplied token is invalid or expired.", status);
    }
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedDynamicRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && (
      url.pathname.startsWith("/connector/oauth/") ||
      url.pathname === "/connector_platform_oauth_redirect"
    );
  } catch {
    return false;
  }
}

function isAllowedStaticRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" && Boolean(url.hostname)) ||
      (url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
    );
  } catch {
    return false;
  }
}

function scopeIsAllowed(scope: string): boolean {
  const scopes = scope.split(/\s+/).filter(Boolean);
  return scopes.length === 1 && scopes[0] === GOLF_SCOPE;
}

function subjectFor(clientId: string): string {
  return createHash("sha256")
    .update(`golf-intelligence:${clientId}`)
    .digest("base64url");
}

function pkceMatches(verifier: string, expectedChallenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(actual, expectedChallenge);
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function basicClient(
  req: Request,
  expectedClientId?: string,
): { clientId: string; secret: string } | undefined {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return undefined;
    const suppliedId = decodeURIComponent(decoded.slice(0, separator));
    if (expectedClientId && suppliedId !== expectedClientId) return undefined;
    return {
      clientId: suppliedId,
      secret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}
