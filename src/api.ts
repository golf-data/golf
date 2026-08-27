export const API_BASE_URL = "https://api.golfintelligence.com";
export const AUTH_URL = `${API_BASE_URL}/auth/authenticateToken`;

export type Fetch = typeof globalThis.fetch;

export type Credentials = {
  clientId: string;
  activeToken: string;
};

export class GolfIntelligenceClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly credentials: Credentials,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  async request(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const url = new URL(path, API_BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken();
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      if (response.status === 401 && attempt === 0) {
        this.clearAccessToken();
        continue;
      }

      return parseResponse(response);
    }

    throw new Error("Golf Intelligence request failed after authentication retry.");
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      (this.accessTokenExpiresAt === 0 || Date.now() < this.accessTokenExpiresAt)
    ) {
      return this.accessToken;
    }

    const { clientId, activeToken } = this.credentials;
    if (!clientId || !activeToken) {
      throw new Error(
        "Configure GI_CLIENT_ID and GI_ACTIVE_TOKEN from your Golf Intelligence API Account.",
      );
    }

    const form = new URLSearchParams({
      grant_type: "client_credentials",
      code: activeToken,
      client_id: clientId,
    });
    const response = await this.fetchImpl(AUTH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      throw new Error(`Golf Intelligence authentication failed (${response.status}).`);
    }

    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error(
        "Golf Intelligence authentication response did not include an access token.",
      );
    }

    this.accessToken = payload.access_token;
    if (
      typeof payload.expires_in === "number" &&
      Number.isFinite(payload.expires_in) &&
      payload.expires_in > 0
    ) {
      // Refresh one minute early, but preserve short-lived test/development tokens.
      const lifetimeMs = payload.expires_in * 1_000;
      this.accessTokenExpiresAt =
        Date.now() + Math.max(1_000, lifetimeMs - 60_000);
    }
    return this.accessToken;
  }

  private clearAccessToken(): void {
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Golf Intelligence API request failed (${response.status}).`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}
