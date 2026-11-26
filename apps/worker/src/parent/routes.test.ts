import {
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import type { Env } from "../env";
import { MAX_PARENT_BODY_BYTES } from "./routes";
import { SERVER_SECRET_KEY } from "./session";

const PIN = "246813";
const OTHER_PIN = "975310";
const TOKEN = "TESTONLY-access-token-not-a-secret-0123456789";
const ORIGIN = "https://dev.example.test";
/** Monday 2026-03-09, 09:00 UTC. */
const NOW = Date.parse("2026-03-09T09:00:00Z");
const MINUTE = 60_000;

let consoleOutput: string[];

beforeEach(() => {
  consoleOutput = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
});

afterEach(async () => {
  // Neither the PIN nor the server secret may ever reach a log line.
  const logs = consoleOutput.join("\n");
  expect(logs).not.toContain(PIN);
  expect(logs).not.toContain(OTHER_PIN);
  vi.restoreAllMocks();
  await reset();
});

/** The editor needs an access token (ADR-0013, fail closed), so every env has one. */
function env(overrides: Partial<Env> = {}): Env {
  return {
    KIDBOARD_DATA: testEnv.KIDBOARD_DATA,
    KIDBOARD_PARENT_PIN: PIN,
    KIDBOARD_ACCESS_TOKEN: TOKEN,
    // Lets requests without an access token reach the (editor-off) behaviour under test.
    KIDBOARD_PUBLIC: "1",
    ...overrides,
  };
}

/** `init` with the access token as Bearer header, unless it names its own. */
function withAccess(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${TOKEN}`);
  }
  return { ...init, headers };
}

interface Harness {
  clock: { now: number };
  /** A request with the access token (see {@link withAccess}). */
  call: (path: string, init?: RequestInit, e?: Env) => Promise<Response>;
  /** A request exactly as given (no access token added). */
  raw: (path: string, init?: RequestInit, e?: Env) => Promise<Response>;
  unlock: (pin: unknown, e?: Env) => Promise<Response>;
}

/** A fresh app = a fresh isolate (own key cache). */
function harness(): Harness {
  const clock = { now: NOW };
  const app = createApp({ now: () => clock.now });
  const raw = async (
    path: string,
    init?: RequestInit,
    e: Env = env(),
  ): Promise<Response> =>
    app.fetch(new Request(`https://board.example.test${path}`, init), e);
  const call = (
    path: string,
    init?: RequestInit,
    e: Env = env(),
  ): Promise<Response> => raw(path, withAccess(init), e);
  return {
    clock,
    call,
    raw,
    unlock: (pin, e) =>
      call(
        "/api/parent/unlock",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        },
        e,
      ),
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json<Record<string, unknown>>();
}

async function unlockToken(h: Harness, e?: Env): Promise<string> {
  const response = await h.unlock(PIN, e);
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(typeof body.token).toBe("string");
  return String(body.token);
}

function session(h: Harness, token: string, e?: Env): Promise<Response> {
  return h.call(
    "/api/parent/session",
    { headers: { "X-KidBoard-Parent": token } },
    e,
  );
}

/** `kb_meta` rows; `[]` while the worker has not created its tables yet. */
async function metaRows(): Promise<{ key: string; value: unknown }[]> {
  const table = await testEnv.KIDBOARD_DATA.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kb_meta'",
  ).first<string>("name");
  if (table === null) {
    return [];
  }
  const { results } = await testEnv.KIDBOARD_DATA.prepare(
    "SELECT key, value FROM kb_meta ORDER BY key",
  ).all<{ key: string; value: unknown }>();
  return results;
}

describe("POST /api/parent/unlock", () => {
  it("returns a v1 session token valid for 15 minutes and never echoes the PIN", async () => {
    const h = harness();
    const response = await h.unlock(PIN);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(PIN);
    const body = JSON.parse(text) as { token: string; expiresAt: string };
    const exp = NOW / 1000 + 15 * 60;
    expect(body.expiresAt).toBe("2026-03-09T09:15:00.000Z");
    expect(body.token).toMatch(
      new RegExp(`^v1\\.${String(exp)}\\.[A-Za-z0-9_-]{43}$`),
    );
    // The server secret is generated once and kept in D1 (32 bytes, base64url).
    const rows = await metaRows();
    const secret = rows.find((r) => r.key === SERVER_SECRET_KEY);
    expect(secret?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(text).not.toContain(String(secret?.value));
  });

  it("on success deletes its own reservation and leaves D1 as it was", async () => {
    const h = harness();
    await unlockToken(h);
    const before = await metaRows();
    await unlockToken(h);
    await unlockToken(harness()); // fresh isolate: reads the stored secret
    expect(await metaRows()).toEqual(before);
    expect(before.map((r) => r.key)).toEqual([SERVER_SECRET_KEY]);
  });

  it("answers a wrong PIN with 403 wrong_pin and the attempts left", async () => {
    const h = harness();
    const response = await h.unlock(OTHER_PIN);
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({
      error: "wrong_pin",
      attemptsLeft: 4,
    });
    // Same length, prefix, digits as a number: all wrong.
    for (const guess of ["246814", "24681", "2468130", "", "REPLACE_ME"]) {
      expect((await h.unlock(guess, env())).status).not.toBe(200);
      h.clock.now += 16 * MINUTE; // keep clear of the lockout
    }
  });

  it.each([
    ["not JSON", "{pin:"],
    ["a number PIN", JSON.stringify({ pin: 246813 })],
    ["no PIN", JSON.stringify({})],
    ["extra keys", JSON.stringify({ pin: PIN, admin: true })],
    ["an overlong PIN", JSON.stringify({ pin: "1".repeat(65) })],
    ["an array", JSON.stringify([PIN])],
  ])("rejects %s with 400 without counting a failure", async (_, body) => {
    const h = harness();
    const response = await h.call("/api/parent/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "bad_request" });
    expect(
      (await metaRows()).filter((r) => r.key.startsWith("parent_fail:")),
    ).toEqual([]);
  });

  it("limits the body to 16 KB (413), by Content-Length and by streamed size", async () => {
    const h = harness();
    const big = JSON.stringify({ pin: "1".repeat(MAX_PARENT_BODY_BYTES) });
    const declared = await h.call("/api/parent/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: big,
    });
    expect(declared.status).toBe(413);
    expect(await json(declared)).toMatchObject({ error: "payload_too_large" });

    const bytes = new TextEncoder().encode(big);
    const streamed = await h.call("/api/parent/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 9000));
          controller.enqueue(bytes.slice(9000));
          controller.close();
        },
      }),
    });
    expect(streamed.status).toBe(413);

    const exact = JSON.stringify({ pin: PIN }).padEnd(
      MAX_PARENT_BODY_BYTES,
      " ",
    );
    const atLimit = await h.call("/api/parent/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: exact,
    });
    expect(atLimit.status).toBe(200);
  });

  it("still requires the access token in front of it", async () => {
    const h = harness();
    const e = env();
    const denied = await h.raw(
      "/api/parent/unlock",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: PIN }),
      },
      e,
    );
    expect(denied.status).toBe(401);
    expect(await json(denied)).toMatchObject({ error: "unauthorized" });
    // A refused request never reaches the PIN check (no failure counted).
    expect(await metaRows()).toEqual([]);

    const allowed = await h.call(
      "/api/parent/unlock",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin: PIN }),
      },
      e,
    );
    expect(allowed.status).toBe(200);
  });

  it("answers only POST", async () => {
    const response = await harness().call("/api/parent/unlock");
    expect(response.status).toBe(404);
  });
});

describe("lockout", () => {
  async function failTimes(h: Harness, n: number): Promise<Response[]> {
    const responses: Response[] = [];
    for (let i = 0; i < n; i++) {
      responses.push(await h.unlock(OTHER_PIN));
      h.clock.now += MINUTE;
    }
    return responses;
  }

  it("locks after 5 wrong PINs within 15 minutes for 15 minutes, then resets", async () => {
    const h = harness();
    const responses = await failTimes(h, 5); // at minutes 0..4
    expect(responses.slice(0, 4).map((r) => r.status)).toEqual([
      403, 403, 403, 403,
    ]);
    const attempts = await Promise.all(
      responses.slice(0, 4).map(async (r) => (await json(r)).attemptsLeft),
    );
    expect(attempts).toEqual([4, 3, 2, 1]);
    const fifth = responses[4];
    expect(fifth?.status).toBe(429);
    expect(fifth?.headers.get("Retry-After")).toBe("900");
    expect(fifth && (await json(fifth))).toMatchObject({
      error: "parent_lockout",
    });

    // Minute 5: one minute into the lockout. Even the right PIN is refused.
    const locked = await h.unlock(PIN);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBe("840");

    // Minute 18:59 (one second before the end): still locked.
    h.clock.now = NOW + 19 * MINUTE - 1000;
    const almost = await h.unlock(PIN);
    expect(almost.status).toBe(429);
    expect(almost.headers.get("Retry-After")).toBe("1");

    // Minute 19 = 15 min after the 5th failure: open, and the old failures no
    // longer count.
    h.clock.now = NOW + 19 * MINUTE;
    const wrong = await h.unlock(OTHER_PIN);
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toMatchObject({ attemptsLeft: 4 });
    expect((await h.unlock(PIN)).status).toBe(200);
  });

  it("does not lock for 5 failures spread over more than 15 minutes", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      expect((await h.unlock(OTHER_PIN)).status).toBe(403);
      h.clock.now += 4 * MINUTE; // 0, 4, 8, 12, 16 → never 5 within 15 min
    }
    expect((await h.unlock(PIN)).status).toBe(200);
  });

  it("is shared through D1 across isolates", async () => {
    const first = harness();
    await failTimes(first, 3);
    const second = harness();
    second.clock.now = first.clock.now;
    expect((await second.unlock(OTHER_PIN)).status).toBe(403);
    const fifth = await second.unlock(OTHER_PIN);
    expect(fifth.status).toBe(429);
    first.clock.now = second.clock.now;
    expect((await first.unlock(PIN)).status).toBe(429);
    expect((await harness().unlock(PIN)).status).toBe(429);
  });

  it("doubles every further lockout up to 2 hours", async () => {
    const h = harness();
    const retryAfter: string[] = [];
    for (let round = 0; round < 10; round++) {
      const last = (await failTimes(h, 5))[4];
      expect(last?.status).toBe(429);
      const seconds = Number(last?.headers.get("Retry-After"));
      retryAfter.push(String(seconds));
      // The lockout ends `seconds` after the 5th wrong PIN (one minute ago).
      h.clock.now += seconds * 1000 - MINUTE;
    }
    expect(retryAfter).toEqual(
      [900, 1800, 3600, 7200, 7200, 7200, 7200, 7200, 7200, 7200].map(String),
    );
  });

  it("a right PIN ends the escalation", async () => {
    const h = harness();
    const first = (await failTimes(h, 5))[4];
    expect(first?.headers.get("Retry-After")).toBe("900");
    h.clock.now += 900_000 - MINUTE;
    const second = (await failTimes(h, 5))[4];
    expect(second?.headers.get("Retry-After")).toBe("1800");
    h.clock.now += 1_800_000 - MINUTE;
    expect((await h.unlock(PIN)).status).toBe(200);
    const again = (await failTimes(h, 5))[4];
    expect(again?.headers.get("Retry-After")).toBe("900");
  });

  it("escalates only once for attempts that fail while the lockout runs", async () => {
    const h = harness();
    const last = (await failTimes(h, 5))[4];
    expect(last?.headers.get("Retry-After")).toBe("900");
    // Refused attempts during the lockout never raise the level.
    for (let i = 0; i < 3; i++) {
      expect((await h.unlock(OTHER_PIN)).status).toBe(429);
    }
    h.clock.now = NOW + 19 * MINUTE;
    const next = (await failTimes(h, 5))[4];
    expect(next?.headers.get("Retry-After")).toBe("1800");
  });

  it("touches D1 twice per failed attempt (reserve, settle) and once while locked", async () => {
    const h = harness();
    await unlockToken(h); // create the secret
    const spy = vi.spyOn(testEnv.KIDBOARD_DATA, "batch");
    await failTimes(h, 5);
    expect(spy).toHaveBeenCalledTimes(10);
    await h.unlock(OTHER_PIN);
    await h.unlock(PIN);
    expect(spy).toHaveBeenCalledTimes(12); // only the reservation, no PIN compare
  });

  /** Attempt rows (failures and reservations) in D1. */
  async function attemptRows(): Promise<number> {
    return (await metaRows()).filter((r) => r.key.startsWith("parent_fail:"))
      .length;
  }

  it("cannot be bypassed by a burst of parallel unlocks in one isolate", async () => {
    const h = harness();
    await unlockToken(h); // secret exists, schema ready: the burst races on the limiter only
    const responses = await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => h.unlock(String(100000 + i))),
      h.unlock(PIN),
    ]);
    const statuses = responses.map((r) => r.status);
    const wrong = statuses.filter((s) => s === 403).length;
    const ok = statuses.filter((s) => s === 200).length;
    expect(wrong).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(15);
    // Every compared wrong PIN left a row, a right one deleted its row: at most 5
    // PINs were compared.
    expect((await attemptRows()) + ok).toBeLessThanOrEqual(5);
    expect(statuses.every((s) => [200, 403, 429].includes(s))).toBe(true);
  });

  it("cannot be bypassed by parallel unlocks spread over isolates", async () => {
    await unlockToken(harness());
    const isolates = Array.from({ length: 5 }, () => harness());
    const responses = await Promise.all(
      isolates.flatMap((h, n) =>
        Array.from({ length: 4 }, (_, i) =>
          h.unlock(String(200000 + n * 10 + i)),
        ),
      ),
    );
    const statuses = responses.map((r) => r.status);
    // Without the right PIN: exactly 5 PINs compared, every one left a failure row.
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(5);
    expect(await attemptRows()).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(15);
    expect(statuses.every((s) => [403, 429].includes(s))).toBe(true);
  });

  it("with the right PIN in a parallel burst, never compares more than 5 PINs at once", async () => {
    await unlockToken(harness());
    const isolates = Array.from({ length: 5 }, () => harness());
    const responses = await Promise.all(
      isolates.flatMap((h, n) => [
        ...Array.from({ length: 4 }, (_, i) =>
          h.unlock(String(200000 + n * 10 + i)),
        ),
        ...(n === 0 ? [h.unlock(PIN)] : []),
      ]),
    );
    const statuses = responses.map((r) => r.status);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBeLessThanOrEqual(1);
    // The right PIN clears the failures settled before it, never the reservations
    // still being compared: what is left in D1 never exceeds the limit, and the
    // burst cannot test more PINs than 5 plus those that settled before a success.
    expect(await attemptRows()).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(
      ok === 1 ? 9 : 5,
    );
    expect(statuses.every((s) => [200, 403, 429].includes(s))).toBe(true);
  });

  it("a right PIN clears the wrong PINs of the window, not only its own attempt", async () => {
    const h = harness();
    const wrong = await failTimes(h, 4);
    expect(wrong.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await attemptRows()).toBe(4);
    expect((await h.unlock(PIN)).status).toBe(200);
    expect(await attemptRows()).toBe(0);
    // A fresh count of 5: 4 more wrong PINs answer 403 with 4..1 left, the 5th locks.
    const again = await failTimes(h, 5);
    const left = await Promise.all(
      again.slice(0, 4).map(async (r) => (await json(r)).attemptsLeft),
    );
    expect(left).toEqual([4, 3, 2, 1]);
    expect(again[4]?.status).toBe(429);
  });

  it("a right PIN in another isolate clears the D1 failures for every isolate", async () => {
    const first = harness();
    await failTimes(first, 4);
    const second = harness();
    second.clock.now = first.clock.now;
    expect((await second.unlock(PIN)).status).toBe(200);
    expect(await attemptRows()).toBe(0);
    first.clock.now = second.clock.now;
    expect(await json(await first.unlock(OTHER_PIN))).toMatchObject({
      attemptsLeft: 4,
    });
  });

  it("a bad body does not use up an attempt", async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      const response = await h.call("/api/parent/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(400);
    }
    expect((await h.unlock(PIN)).status).toBe(200);
  });
});

describe("unlock reservations on failures", () => {
  /** A D1 binding whose every call fails like an unavailable database. */
  function brokenDb(): D1Database {
    // Test double: only the methods the worker calls are needed, all of them fail.
    return {
      prepare: () => {
        throw new Error("D1_ERROR: unavailable");
      },
      batch: () => Promise.reject(new Error("D1_ERROR: unavailable")),
      exec: () => Promise.reject(new Error("D1_ERROR: unavailable")),
    } as unknown as D1Database;
  }

  /** The real database, except that the first `failures` reservation deletes fail. */
  function failingReleaseDb(failures: number): D1Database {
    const real = testEnv.KIDBOARD_DATA;
    let left = failures;
    // Test double around the real binding: only these three methods are used.
    return {
      prepare: (sql: string) => {
        if (
          sql.startsWith("DELETE FROM kb_meta WHERE key = ?1 OR") &&
          left > 0
        ) {
          left -= 1;
          return {
            bind: () => ({
              run: () => Promise.reject(new Error("D1_ERROR: delete failed")),
            }),
          };
        }
        return real.prepare(sql);
      },
      batch: (statements: D1PreparedStatement[]) => real.batch(statements),
      exec: (sql: string) => real.exec(sql),
    } as unknown as D1Database;
  }

  async function unlockWithContext(
    e: Env,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const app = createApp({ now: () => NOW });
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request("https://board.example.test/api/parent/unlock", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin: PIN }),
      }),
      e,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: response.status, body: await json(response) };
  }

  it("compares no PIN and keeps no state when D1 fails before the compare", async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      // A D1 error before the compare must not count as an attempt.
      expect(
        (await h.unlock(PIN, env({ KIDBOARD_DATA: brokenDb() }))).status,
      ).toBe(500);
    }
    expect((await h.unlock(PIN)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await h.unlock(OTHER_PIN)).status).toBe(403);
    }
    expect((await h.unlock(PIN)).status).toBe(200);
  });

  it("a bad body does not count as an attempt and wrong PINs keep counting", async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      expect((await h.unlock(123456)).status).toBe(400);
    }
    for (let i = 0; i < 4; i++) {
      expect((await h.unlock(OTHER_PIN)).status).toBe(403);
    }
    // The 5th wrong PIN locks.
    expect((await h.unlock(OTHER_PIN)).status).toBe(429);
  });

  it("answers with a session when releasing after the right PIN fails, and retries the delete", async () => {
    const reply = await unlockWithContext(
      env({ KIDBOARD_DATA: failingReleaseDb(1) }),
    );
    expect(reply.status).toBe(200);
    expect(typeof reply.body.token).toBe("string");
    expect(
      (await metaRows()).filter((r) => r.key.startsWith("parent_fail:")),
    ).toEqual([]);
    expect(consoleOutput.join("\n")).toContain(
      "parent unlock: releasing the attempt failed (Error), retrying",
    );
  });

  it("still answers with a session when the retry fails too (the row ages out)", async () => {
    const reply = await unlockWithContext(
      env({ KIDBOARD_DATA: failingReleaseDb(2) }),
    );
    expect(reply.status).toBe(200);
    expect(
      (await metaRows()).filter((r) => r.key.startsWith("parent_fail:")),
    ).toHaveLength(1);
    expect(consoleOutput.join("\n")).toContain(
      "parent unlock: releasing the attempt failed again (Error)",
    );
  });
});

describe("GET /api/parent/session (requireParentSession)", () => {
  it("accepts a fresh token and returns its expiry", async () => {
    const h = harness();
    const token = await unlockToken(h);
    h.clock.now += 14 * MINUTE + 59_000;
    const response = await session(h, token);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      expiresAt: "2026-03-09T09:15:00.000Z",
    });
  });

  it("rejects missing, expired, tampered and other-PIN tokens with 403 parent_locked", async () => {
    const h = harness();
    const token = await unlockToken(h);
    const [version, exp, mac = ""] = token.split(".");
    const tampered = `${version ?? ""}.${exp ?? ""}.${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
    const extended = `${version ?? ""}.${String(Number(exp) + 600)}.${mac}`;

    const cases: [string, Response][] = [
      ["missing", await h.call("/api/parent/session")],
      ["empty", await session(h, "")],
      ["garbage", await session(h, "v1.abc.def")],
      ["tampered", await session(h, tampered)],
      ["extended", await session(h, extended)],
      ["access token instead", await session(h, TOKEN)],
      // Changing the PIN ends every session.
      [
        "other PIN",
        await session(h, token, env({ KIDBOARD_PARENT_PIN: OTHER_PIN })),
      ],
    ];
    h.clock.now += 15 * MINUTE;
    cases.push(["expired", await session(h, token)]);

    for (const [name, response] of cases) {
      expect(response.status, name).toBe(403);
      expect(await json(response), name).toMatchObject({
        error: "parent_locked",
      });
    }
  });

  it("rejects a token from another deployment (other server secret, same PIN)", async () => {
    const h = harness();
    const token = await unlockToken(h);
    await reset(); // new D1 database → new secret
    expect((await session(harness(), token)).status).toBe(403);
  });

  it("works in a fresh isolate with the same database", async () => {
    const token = await unlockToken(harness());
    const other = harness();
    expect((await session(other, token)).status).toBe(200);
  });
});

describe("editor off", () => {
  it.each([
    ["no PIN", { KIDBOARD_PARENT_PIN: undefined }],
    ["template PIN", { KIDBOARD_PARENT_PIN: "REPLACE_ME" }],
    ["short PIN", { KIDBOARD_PARENT_PIN: "12345" }],
    ["no D1", { KIDBOARD_DATA: undefined }],
    ["no access token", { KIDBOARD_ACCESS_TOKEN: undefined }],
    ["an empty access token", { KIDBOARD_ACCESS_TOKEN: "" }],
  ] as [string, Partial<Env>][])(
    "%s → every /api/parent/* is 404",
    async (_, overrides) => {
      const h = harness();
      const e = env(overrides);
      const requests: [string, RequestInit][] = [
        [
          "/api/parent/unlock",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: "12345" }),
          },
        ],
        ["/api/parent/session", {}],
        ["/api/parent/entries", {}],
        ["/api/parent/templates", {}],
        ["/api/parent/export", {}],
        [
          "/api/parent/import?mode=merge",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        ],
        ["/api/parent/whatever", { method: "DELETE" }],
      ];
      for (const [path, init] of requests) {
        const response = await h.call(path, init, e);
        expect(response.status, path).toBe(404);
        expect(await json(response)).toMatchObject({ error: "not_found" });
      }
    },
  );
});

describe("CORS on /api/parent/*", () => {
  function preflight(
    h: Harness,
    path: string,
    origin: string,
  ): Promise<Response> {
    return h.call(
      path,
      {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-kidboard-parent",
        },
      },
      env({ KIDBOARD_ALLOWED_ORIGINS: ORIGIN }),
    );
  }

  it("adds POST, PATCH, DELETE and the two headers for allowed origins", async () => {
    const response = await preflight(harness(), "/api/parent/unlock", ORIGIN);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization,Content-Type,X-KidBoard-Parent",
    );
  });

  it("exposes Retry-After and Content-Disposition to allowed origins", async () => {
    const response = await harness().call(
      "/api/parent/session",
      { headers: { Origin: ORIGIN } },
      env({ KIDBOARD_ALLOWED_ORIGINS: ORIGIN }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "Retry-After,Content-Disposition",
    );
  });

  it("gives other origins nothing more than the board set", async () => {
    const response = await preflight(
      harness(),
      "/api/parent/unlock",
      "https://evil.example.test",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("keeps the board routes at GET/HEAD for allowed origins", async () => {
    const response = await preflight(harness(), "/api/agenda", ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,OPTIONS",
    );
  });
});
