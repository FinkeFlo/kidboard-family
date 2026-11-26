import {
  PARENT_LOCKOUT_SECONDS,
  PARENT_SESSION_HEADER,
  WORKER_UPSTREAM_BUDGET_MS,
} from "@kidboard/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient, REQUEST_TIMEOUT_MS } from "./apiClient";
import {
  agendaFixture,
  allFailedAgenda,
  configFixture,
  createFakeFetch,
  TEST_TOKEN,
  TODAY,
} from "./testing.test-utils";

const RANGE = { from: TODAY, days: 8 };

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createApiClient", () => {
  it("fetches and validates /api/config (defaults applied)", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", {
      status: 200,
      body: { calendars: [{ id: "family", kind: "events" }] },
    });
    const api = createApiClient({ fetch: fake.fetch });

    const config = await api.getConfig();

    expect(config.refreshMinutes).toBe(60);
    expect(config.locale).toBe("auto");
    expect(config.editor).toBe(false);
    expect(fake.calls[0]?.url).toBe("/api/config");
  });

  it("reads the editor flag and ignores unknown top-level config keys", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", {
      status: 200,
      body: {
        calendars: [{ id: "family", kind: "events" }],
        editor: true,
        laterFeature: { on: true },
      },
    });
    const api = createApiClient({ fetch: fake.fetch });

    const config = await api.getConfig();

    expect(config.editor).toBe(true);
    expect(config).not.toHaveProperty("laterFeature");
  });

  it("requests /api/agenda with from and days and returns the parsed body", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", { status: 200, body: agendaFixture() });
    const api = createApiClient({
      fetch: fake.fetch,
      baseUrl: "https://kb.test",
    });

    const agenda = await api.getAgenda(RANGE);

    expect(agenda.events[0]?.title).toBe("Swimming");
    expect(fake.calls[0]?.url).toBe(
      `https://kb.test/api/agenda?from=${TODAY}&days=8`,
    );
    expect(fake.calls[0]?.init?.cache).toBe("no-store");
  });

  it("sends the token as Bearer header and never in the URL", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", { status: 200, body: configFixture() });
    const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });

    await api.getConfig();

    const call = fake.calls[0];
    expect(call?.url).not.toContain(TEST_TOKEN);
    expect(new Headers(call?.init?.headers).get("Authorization")).toBe(
      `Bearer ${TEST_TOKEN}`,
    );
  });

  it("sends no Authorization header without a token", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", { status: 200, body: configFixture() });
    await createApiClient({ fetch: fake.fetch, token: "" }).getConfig();

    expect(new Headers(fake.calls[0]?.init?.headers).has("Authorization")).toBe(
      false,
    );
  });

  it.each([
    [400, "bad-request"],
    [401, "unauthorized"],
    [404, "http"],
    [500, "server"],
    [502, "upstream"],
    [503, "http"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", {
      status,
      body: { error: "x", message: "y" },
    });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(RANGE),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status, path: "/api/agenda" });
  });

  it("treats the 502 body (all sources failed) as an error, not as data", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", { status: 502, body: allFailedAgenda() });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(RANGE),
    );

    expect(error).toMatchObject({ kind: "upstream", status: 502 });
  });

  it("rejects a schema-invalid 200 response", async () => {
    const fake = createFakeFetch();
    const broken = { ...agendaFixture(), events: [{ id: "e1" }] };
    fake.setReplies("/api/agenda", { status: 200, body: broken });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(RANGE),
    );

    expect(error).toMatchObject({ kind: "invalid-response", status: 200 });
  });

  it("rejects a config that violates the shared schema", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", {
      status: 200,
      body: { calendars: [], timeZone: "Mars/Valles" },
    });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getConfig(),
    );

    expect(error).toMatchObject({ kind: "invalid-response" });
  });

  it("accepts a config without calendars (app entries only)", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", {
      status: 200,
      body: configFixture({ calendars: [] }),
    });
    const config = await createApiClient({ fetch: fake.fetch }).getConfig();

    expect(config.calendars).toEqual([]);
    expect(config.timeZone).toBe("Europe/Berlin");
  });

  it("rejects non-JSON bodies", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", { raw: "<html>captive portal</html>" });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getConfig(),
    );

    expect(error).toMatchObject({ kind: "invalid-response" });
  });

  it("rejects an agenda for a different range than requested", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", {
      status: 200,
      body: agendaFixture({ range: { from: "2026-11-23", to: "2026-12-01" } }),
    });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(RANGE),
    );

    expect(error).toMatchObject({ kind: "invalid-response" });
  });

  it("maps fetch failures to network errors without leaking details", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", "network-error");
    const error = await rejection(
      createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }).getConfig(),
    );

    expect(error).toMatchObject({ kind: "network" });
    expect(String(error)).not.toContain(TEST_TOKEN);
  });

  it("times out after timeoutMs and aborts the request", async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", "hang");
    const promise = rejection(
      createApiClient({ fetch: fake.fetch, timeoutMs: 5000 }).getAgenda(RANGE),
    );

    await vi.advanceTimersByTimeAsync(4999);
    expect(fake.calls[0]?.init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await promise).toMatchObject({ kind: "timeout" });
    expect(fake.calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it("uses a default timeout above the worker's upstream budget", async () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(WORKER_UPSTREAM_BUDGET_MS);
    expect(WORKER_UPSTREAM_BUDGET_MS).toBe(11_000);

    vi.useFakeTimers();
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", "hang");
    const promise = rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(RANGE),
    );

    await vi.advanceTimersByTimeAsync(WORKER_UPSTREAM_BUDGET_MS + 1000);
    expect(fake.calls[0]?.init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    expect(await promise).toMatchObject({ kind: "timeout" });
  });

  it("passes a caller cancellation through as an abort, not an ApiError", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/agenda", "hang");
    const controller = new AbortController();
    const promise = rejection(
      createApiClient({ fetch: fake.fetch }).getAgenda(
        RANGE,
        controller.signal,
      ),
    );
    controller.abort();

    const error = await promise;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });

  it("rejects with an abort (not an ApiError) when the signal is already aborted", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/config", "hang");
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).getConfig(controller.signal),
    );

    expect(error).not.toBeInstanceOf(ApiError);
    expect(fake.calls[0]?.init?.signal?.aborted).toBe(true);
  });
});

describe("parent lock calls (ADR-0013)", () => {
  /** Synthetic session token (not a real signature). */
  const SESSION = "v1.1795000000.TESTONLY-not-a-signature";
  const EXPIRES = "2026-11-22T11:15:00.000Z";

  it("posts the PIN as JSON with the access token and returns the session", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/unlock", {
      status: 200,
      body: { token: SESSION, expiresAt: EXPIRES },
    });
    const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });

    await expect(api.unlockParent("123456")).resolves.toEqual({
      kind: "unlocked",
      token: SESSION,
      expiresAt: Date.parse(EXPIRES),
    });
    const call = fake.calls[0];
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.body).toBe(JSON.stringify({ pin: "123456" }));
    expect(call?.url).not.toContain("123456");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("maps 403 wrong_pin to the attempts left", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/unlock", {
      status: 403,
      body: { error: "wrong_pin", message: "Wrong PIN", attemptsLeft: 3 },
    });
    await expect(
      createApiClient({ fetch: fake.fetch }).unlockParent("000000"),
    ).resolves.toEqual({ kind: "wrong-pin", attemptsLeft: 3 });
  });

  it("reads the lockout length from Retry-After first, then the body, then 15 min", async () => {
    const fake = createFakeFetch();
    fake.setReplies(
      "/api/parent/unlock",
      {
        status: 429,
        body: { error: "parent_lockout", retryAfterSeconds: 60 },
        headers: { "Retry-After": "840" },
      },
      {
        status: 429,
        body: { error: "parent_lockout", retryAfterSeconds: 61 },
        headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
      },
      { raw: "busy", status: 429 },
    );
    const api = createApiClient({ fetch: fake.fetch });
    await expect(api.unlockParent("000000")).resolves.toEqual({
      kind: "lockout",
      retryAfterSeconds: 840,
    });
    await expect(api.unlockParent("000000")).resolves.toEqual({
      kind: "lockout",
      retryAfterSeconds: 61,
    });
    await expect(api.unlockParent("000000")).resolves.toEqual({
      kind: "lockout",
      retryAfterSeconds: PARENT_LOCKOUT_SECONDS,
    });
  });

  it.each([
    [401, "unauthorized"],
    [404, "http"],
    [500, "server"],
  ] as const)("throws HTTP %i as ApiError %s", async (status, kind) => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/unlock", { status, body: { error: "x" } });
    const error = await rejection(
      createApiClient({ fetch: fake.fetch }).unlockParent("123456"),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status });
    // Never the PIN in the message.
    expect((error as Error).message).not.toContain("123456");
  });

  it("rejects malformed success and wrong-PIN bodies", async () => {
    const fake = createFakeFetch();
    fake.setReplies(
      "/api/parent/unlock",
      { status: 200, body: { token: "", expiresAt: EXPIRES } },
      { status: 403, body: { error: "parent_locked" } },
    );
    const api = createApiClient({ fetch: fake.fetch });
    expect(await rejection(api.unlockParent("123456"))).toMatchObject({
      kind: "invalid-response",
      status: 200,
    });
    expect(await rejection(api.unlockParent("123456"))).toMatchObject({
      kind: "invalid-response",
      status: 403,
    });
  });

  it("checks a session with the parent header; 403 means locked", async () => {
    const fake = createFakeFetch();
    fake.setReplies(
      "/api/parent/session",
      { status: 200, body: { expiresAt: EXPIRES } },
      { status: 403, body: { error: "parent_locked" } },
      { status: 401, body: { error: "unauthorized" } },
    );
    const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
    await expect(api.getParentSession(SESSION)).resolves.toEqual({
      expiresAt: Date.parse(EXPIRES),
    });
    const headers = new Headers(fake.calls[0]?.init?.headers);
    expect(headers.get(PARENT_SESSION_HEADER)).toBe(SESSION);
    expect(headers.get("Authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(fake.calls[0]?.init?.method).toBeUndefined();
    await expect(api.getParentSession(SESSION)).resolves.toBeNull();
    expect(await rejection(api.getParentSession(SESSION))).toMatchObject({
      kind: "unauthorized",
    });
  });

  it("reports a network failure of the unlock as ApiError network", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/unlock", "network-error");
    expect(
      await rejection(
        createApiClient({ fetch: fake.fetch }).unlockParent("123456"),
      ),
    ).toMatchObject({ kind: "network", path: "/api/parent/unlock" });
  });
});
