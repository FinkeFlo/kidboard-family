import {
  type AppConfigInput,
  AppConfigSchema,
  type EditorEntryInputRaw,
  ParentFeedResponseSchema,
} from "@kidboard/shared";
import {
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import ICAL from "ical.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { EntryStore } from "../entries/entryStore";
import { renderAppCalendar } from "../entries/renderCalendar";
import type { Env } from "../env";
import { expandCalendar, type Occurrence } from "../ical/expandCalendar";
import { FEED_CONTENT_TYPE } from "./routes";
import { resetFeedTokenWarning } from "./token";

const PIN = "246813";
const ACCESS = "TESTONLY-access-token-not-a-secret-0123456789";
const FEED_TOKEN = "TESTONLY-feed-token-not-a-secret-0123456789";
const FEED_PATH = `/api/feed.ics?token=${FEED_TOKEN}`;
const db = testEnv.KIDBOARD_DATA;

/** Monday 2026-03-09, 10:00 in Berlin. */
const NOW = Date.parse("2026-03-09T09:00:00Z");

const CONFIG_INPUT: AppConfigInput = {
  locale: "de",
  timeZone: "Europe/Berlin",
  children: [{ id: "mia", name: "Mia", color: "#E4572E", avatar: "🦊" }],
  calendars: [{ id: "kinder", kind: "events" }],
};
const CONFIG = AppConfigSchema.parse(CONFIG_INPUT);

const SWIM: EditorEntryInputRaw = {
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Schwimmen",
  allDay: false,
  date: "2026-03-10",
  startTime: "16:00",
  repeat: { weekly: { weekdays: [2] } },
  bring: ["🩱"],
};

const PIZZA: EditorEntryInputRaw = {
  kind: "meal",
  icon: "🍕",
  title: "Pizza",
  allDay: true,
  date: "2026-03-10",
  slot: "dinner",
};

interface Reply {
  status: number;
  headers: Headers;
  text: string;
}

let consoleOutput: string[];
let responseTexts: string[];

/** The test bindings with `overrides` applied and the `omit` keys left out. */
function env(
  overrides: Partial<Env> = {},
  omit: readonly (keyof Env)[] = [],
): Env {
  const bindings: Env = {
    KIDBOARD_CONFIG: JSON.stringify(CONFIG_INPUT),
    KIDBOARD_DATA: db,
    KIDBOARD_PARENT_PIN: PIN,
    KIDBOARD_ACCESS_TOKEN: ACCESS,
    // Lets requests without an access token reach the (editor-off) behaviour under test.
    KIDBOARD_PUBLIC: "1",
    KIDBOARD_FEED_TOKEN: FEED_TOKEN,
    ...overrides,
  };
  for (const key of omit) {
    // Leaves the optional binding out (`undefined` is not allowed, exactOptionalPropertyTypes).
    Reflect.deleteProperty(bindings, key);
  }
  return bindings;
}

/** A fresh app per test: its schema memos must not outlive the `reset()` of D1. */
let app: ReturnType<typeof createApp>;

async function call(
  path: string,
  init: RequestInit = {},
  bindings: Env = env(),
): Promise<Reply> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://board.example.test${path}`, init),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await response.text();
  responseTexts.push(text);
  return { status: response.status, headers: response.headers, text };
}

async function seed(): Promise<void> {
  const store = new EntryStore(db, { config: CONFIG, now: () => NOW });
  for (const input of [SWIM, PIZZA]) {
    const created = await store.create(input);
    expect(created.ok).toBe(true);
  }
}

function expectNotFound(reply: Reply): void {
  expect(reply.status).toBe(404);
  expect(JSON.parse(reply.text)).toEqual({
    error: "not_found",
    message: "Not found",
  });
}

beforeEach(() => {
  app = createApp({ now: () => NOW });
  resetFeedTokenWarning();
  consoleOutput = [];
  responseTexts = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
});

afterEach(async () => {
  // No log line may carry the feed token, the PIN or the access token; no response
  // may carry the PIN or the access token (only `/api/parent/feed` names the token).
  const logs = consoleOutput.join("\n");
  for (const secret of [FEED_TOKEN, "TESTONLY", PIN, ACCESS]) {
    expect(logs).not.toContain(secret);
  }
  for (const secret of [PIN, ACCESS]) {
    expect(responseTexts.join("\n")).not.toContain(secret);
  }
  vi.restoreAllMocks();
  await reset();
});

describe("GET /api/feed.ics?token=", () => {
  it("serves the app entries as text/calendar without an access token, never cached", async () => {
    await seed();
    const reply = await call(FEED_PATH);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Content-Type")).toBe(FEED_CONTENT_TYPE);
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
    expect(reply.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const calendar = ICAL.Component.fromString(reply.text);
    expect(calendar.getFirstPropertyValue("x-wr-calname")).toBe("KidBoard");
    expect(calendar.getFirstPropertyValue("prodid")).toBe(
      "-//KidBoard//Phone feed//EN",
    );
    expect(
      calendar.getFirstSubcomponent("vtimezone")?.getFirstPropertyValue("tzid"),
    ).toBe("Europe/Berlin");
    // The token never ends up inside the calendar.
    expect(reply.text).not.toContain(FEED_TOKEN);
  });

  it("expands to the same occurrences as the board's app sources", async () => {
    await seed();
    const reply = await call(FEED_PATH);
    expect(reply.status).toBe(200);
    const window = {
      from: "2026-03-08",
      to: "2026-04-10",
      timeZone: "Europe/Berlin",
    };
    const entries = await new EntryStore(db, { config: CONFIG }).list();
    const board: Occurrence[] = (["event", "meal"] as const).flatMap(
      (kind) =>
        expandCalendar(renderAppCalendar(entries, kind, CONFIG), window)
          .occurrences,
    );
    const feed = expandCalendar(reply.text, window).occurrences;
    const key = (o: Occurrence): string => `${o.start}|${o.uid}|${o.summary}`;
    expect(feed.map(key).sort()).toEqual(board.map(key).sort());
    expect(feed).toHaveLength(5 + 1);
    expect(feed.map((o) => o.summary)).toEqual(
      expect.arrayContaining([
        "Mia: 🏊 Schwimmen",
        expect.stringContaining("🍕 Pizza"),
      ]),
    );
  });

  it("answers HEAD like GET (headers only)", async () => {
    const reply = await call(FEED_PATH, { method: "HEAD" });
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Content-Type")).toBe(FEED_CONTENT_TYPE);
    expect(reply.text).toBe("");
  });

  it("does not need the access token on the request", async () => {
    const reply = await call(FEED_PATH);
    expect(reply.status).toBe(200);
  });

  it("is off (404) without an access token configured (fail closed, ADR-0013)", async () => {
    for (const bindings of [
      env({}, ["KIDBOARD_ACCESS_TOKEN"]),
      env({ KIDBOARD_ACCESS_TOKEN: "" }),
      env({ KIDBOARD_ACCESS_TOKEN: "REPLACE_ME-access-token" }),
    ]) {
      expectNotFound(await call(FEED_PATH, {}, bindings));
    }
  });

  it("is 404 for a missing, empty, wrong or other-length token", async () => {
    for (const path of [
      "/api/feed.ics",
      "/api/feed.ics?token=",
      `/api/feed.ics?token=${FEED_TOKEN.slice(0, -1)}X`,
      `/api/feed.ics?token=${FEED_TOKEN.slice(0, -1)}`,
      `/api/feed.ics?token=${FEED_TOKEN}0`,
      `/api/feed.ics?token=${FEED_TOKEN.toLowerCase()}`,
      `/api/feed.ics?token=%20${FEED_TOKEN}`,
      // The board's parameter name does not open the feed.
      `/api/feed.ics?key=${FEED_TOKEN}`,
      `/api/feed.ics?TOKEN=${FEED_TOKEN}`,
    ]) {
      expectNotFound(await call(path));
    }
  });

  it("does not take the access token as the feed token", async () => {
    expectNotFound(await call(`/api/feed.ics?token=${ACCESS}`));
    expectNotFound(await call(`/api/feed.ics?key=${ACCESS}`));
    expectNotFound(
      await call("/api/feed.ics", {
        headers: { Authorization: `Bearer ${ACCESS}` },
      }),
    );
  });

  it("is 404 even for the exact token when the secret is short or the template", async () => {
    for (const token of [
      "TESTONLY-short-feed",
      "REPLACE_ME",
      `REPLACE_ME-${"x".repeat(40)}`,
    ]) {
      resetFeedTokenWarning();
      consoleOutput.length = 0;
      for (let i = 0; i < 2; i += 1) {
        expectNotFound(
          await call(
            `/api/feed.ics?token=${token}`,
            {},
            env({ KIDBOARD_FEED_TOKEN: token }),
          ),
        );
      }
      const warnings = consoleOutput.filter((l) =>
        l.includes("KIDBOARD_FEED_TOKEN"),
      );
      expect(warnings, token).toHaveLength(1);
      expect(consoleOutput.join("\n")).not.toContain(token);
    }
  });

  it("is 404 when the token is unset (no warning)", async () => {
    expectNotFound(await call(FEED_PATH, {}, env({}, ["KIDBOARD_FEED_TOKEN"])));
    expectNotFound(await call(FEED_PATH, {}, env({ KIDBOARD_FEED_TOKEN: "" })));
    expect(consoleOutput).toEqual([]);
  });

  it("is 404 while the editor is off (no D1 binding or no valid PIN)", async () => {
    expectNotFound(await call(FEED_PATH, {}, env({}, ["KIDBOARD_DATA"])));
    expectNotFound(await call(FEED_PATH, {}, env({}, ["KIDBOARD_PARENT_PIN"])));
    expectNotFound(
      await call(FEED_PATH, {}, env({ KIDBOARD_PARENT_PIN: "12" })),
    );
  });

  it("answers 503 without detail when D1 is unavailable", async () => {
    const failing = {
      prepare: () => {
        throw new Error(`D1_ERROR: unavailable ${FEED_TOKEN}`);
      },
      batch: () => Promise.reject(new Error("D1_ERROR")),
      exec: () => Promise.reject(new Error("D1_ERROR")),
    } as unknown as D1Database;
    const reply = await call(FEED_PATH, {}, env({ KIDBOARD_DATA: failing }));
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.text)).toEqual({
      error: "storage_unavailable",
      message: "Entries are unavailable; try again",
    });
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
    expect(consoleOutput.join("\n")).toContain(
      "phone feed: entries unavailable (Error)",
    );
  });

  it("answers 500 server_misconfigured for an invalid config", async () => {
    const reply = await call(
      FEED_PATH,
      {},
      env({ KIDBOARD_CONFIG: "{not json" }),
    );
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.text)).toMatchObject({
      error: "server_misconfigured",
    });
  });

  it("logs an unhandled error with the path only, never the token", async () => {
    const bindings = env();
    // The config is read only after the token matched: make that read throw.
    Object.defineProperty(bindings, "KIDBOARD_CONFIG", {
      get: () => {
        throw new TypeError(`boom ${FEED_TOKEN}`);
      },
    });
    const reply = await call(FEED_PATH, {}, bindings);
    expect(reply.status).toBe(500);
    expect(reply.text).not.toContain(FEED_TOKEN);
    expect(consoleOutput).toContain(
      "[kidboard] unhandled TypeError on GET /api/feed.ics",
    );
  });
});

describe("access token exemption", () => {
  it("keeps every other path behind the access token", async () => {
    for (const [path, init] of [
      ["/api/agenda", {}],
      ["/api/config", {}],
      ["/api/parent/session", {}],
      ["/api/parent/feed", {}],
      [`/api/feed/${FEED_TOKEN}.ics`, {}],
      [`/api/feed.ics/?token=${FEED_TOKEN}`, {}],
      [`/api/feed.ics/x?token=${FEED_TOKEN}`, {}],
      [`/api/feeds.ics?token=${FEED_TOKEN}`, {}],
      [`/api/feed?token=${FEED_TOKEN}`, {}],
      [`/api/agenda?token=${FEED_TOKEN}`, {}],
      [FEED_PATH, { method: "POST" }],
      [FEED_PATH, { method: "DELETE" }],
    ] as const) {
      const reply = await call(path, init);
      expect(reply.status, `${init.method ?? "GET"} ${path}`).toBe(401);
    }
  });
});

describe("GET /api/parent/feed", () => {
  async function session(bindings: Env): Promise<string> {
    const reply = await call(
      "/api/parent/unlock",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin: PIN }),
      },
      bindings,
    );
    expect(reply.status).toBe(200);
    return (JSON.parse(reply.text) as { token: string }).token;
  }

  function parentFeed(token: string | null, bindings: Env): Promise<Reply> {
    const headers = new Headers({ Authorization: `Bearer ${ACCESS}` });
    if (token !== null) {
      headers.set("X-KidBoard-Parent", token);
    }
    return call("/api/parent/feed", { headers }, bindings);
  }

  it("names the relative feed path to an unlocked parent", async () => {
    const bindings = env();
    const reply = await parentFeed(await session(bindings), bindings);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
    expect(ParentFeedResponseSchema.parse(JSON.parse(reply.text))).toEqual({
      feedUrl: FEED_PATH,
    });
  });

  it("omits feedUrl while the feed is off", async () => {
    for (const bindings of [
      env({}, ["KIDBOARD_FEED_TOKEN"]),
      env({ KIDBOARD_FEED_TOKEN: "TESTONLY-short-feed" }),
      env({ KIDBOARD_FEED_TOKEN: "REPLACE_ME" }),
    ]) {
      const reply = await parentFeed(await session(bindings), bindings);
      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.text)).toEqual({});
    }
  });

  it("needs the parent session", async () => {
    const reply = await parentFeed(null, env());
    expect(reply.status).toBe(403);
    expect(reply.text).not.toContain(FEED_TOKEN);
  });
});
