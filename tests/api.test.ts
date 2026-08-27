import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_URL, GolfIntelligenceClient } from "../src/api.js";
import { requireSpendConfirmation } from "../src/spend.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("exchanges the Active Token and caches the bearer token", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    if (String(input) === AUTH_URL) {
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    return jsonResponse({ courses: [] });
  };
  const client = new GolfIntelligenceClient(
    { clientId: "client-id", activeToken: "active-token" },
    fetchMock,
  );

  await client.request("POST", "/courses/searchCourseGroups", {
    body: { keywords: "St Andrews", rows: 5, offset: 0 },
  });
  await client.request("GET", "/courses/getCourseGroupScorecard", {
    query: { PublicId: "course-id" },
  });

  assert.equal(calls.length, 3);
  const authBody = new URLSearchParams(String(calls[0].init?.body));
  assert.deepEqual(Object.fromEntries(authBody), {
    grant_type: "client_credentials",
    code: "active-token",
    client_id: "client-id",
  });
  assert.equal(
    (calls[1].init?.headers as Record<string, string>).Authorization,
    "Bearer access-token",
  );
  assert.equal(
    (calls[2].init?.headers as Record<string, string>).Authorization,
    "Bearer access-token",
  );
  assert.match(calls[2].input, /PublicId=course-id/);
});

test("refreshes authentication once after a 401", async () => {
  let authCalls = 0;
  let apiCalls = 0;
  const fetchMock: typeof fetch = async (input) => {
    if (String(input) === AUTH_URL) {
      authCalls += 1;
      return jsonResponse({ access_token: `access-${authCalls}` });
    }
    apiCalls += 1;
    return apiCalls === 1
      ? jsonResponse({ error: "expired" }, 401)
      : jsonResponse({ ok: true });
  };
  const client = new GolfIntelligenceClient(
    { clientId: "client-id", activeToken: "active-token" },
    fetchMock,
  );

  assert.deepEqual(
    await client.request("GET", "/courses/getCourseGroupDetail"),
    { ok: true },
  );
  assert.equal(authCalls, 2);
  assert.equal(apiCalls, 2);
});

test("paid calls require explicit spend confirmation", () => {
  assert.throws(
    () => requireSpendConfirmation(false, 3, "get_course_group_detail"),
    /costs 3 credits.*confirm_spend=true/,
  );
  assert.doesNotThrow(() =>
    requireSpendConfirmation(true, 3, "get_course_group_detail"),
  );
});
