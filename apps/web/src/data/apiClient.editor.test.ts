import { PARENT_SESSION_HEADER } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import {
  appEntry,
  listResponse,
  SESSION,
  SWIM,
  TODAY,
  writeResponse,
} from "../editor/fixtures.test-utils";
import {
  ApiError,
  createApiClient,
  DEFAULT_EXPORT_FILE_NAME,
  EditorApiError,
  exportFileName,
} from "./apiClient";
import { createFakeFetch, TEST_TOKEN } from "./testing.test-utils";

function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("expected a JSON text body");
  return JSON.parse(body);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const ENTRY_ID = "00000000-0000-4000-8000-000000000001";

describe("ApiClient editor routes (T-43 API, T-45 client)", () => {
  it("lists entries with the session header, the access token and the range", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/entries", {
      status: 200,
      body: listResponse(),
    });
    const api = createApiClient({ fetch: fake.fetch, token: TEST_TOKEN });
    await expect(
      api.listEntries(SESSION, { from: TODAY, days: 14 }),
    ).resolves.toMatchObject({ items: [], storageUnavailable: false });
    const call = fake.calls[0];
    expect(call?.url).toBe(`/api/parent/entries?from=${TODAY}&days=14`);
    const headers = new Headers(call?.init?.headers);
    expect(headers.get(PARENT_SESSION_HEADER)).toBe(SESSION);
    expect(headers.get("Authorization")).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("defaults unresolved and storageUnavailable of an older worker", async () => {
    const fake = createFakeFetch();
    const old = Object.fromEntries(
      Object.entries(listResponse()).filter(
        ([key]) => key !== "unresolved" && key !== "storageUnavailable",
      ),
    );
    fake.setReplies("/api/parent/entries", { status: 200, body: old });
    const list = await createApiClient({ fetch: fake.fetch }).listEntries(
      SESSION,
      { from: TODAY, days: 14 },
    );
    expect(list.unresolved).toEqual([]);
    expect(list.storageUnavailable).toBe(false);
  });

  it("creates with POST and a JSON body", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/entries", {
      status: 201,
      body: writeResponse(appEntry(SWIM)),
    });
    const api = createApiClient({ fetch: fake.fetch });
    const result = await api.createEntry(SESSION, SWIM);
    expect(result.entry?.data.title).toBe("Swimming");
    const init = fake.calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(jsonBody(init)).toEqual(SWIM);
  });

  it("updates one day or the series with scope, date and revision", async () => {
    const fake = createFakeFetch();
    fake.setReplies(`/api/parent/entries/${ENTRY_ID}`, {
      status: 200,
      body: writeResponse(appEntry(SWIM)),
    });
    const api = createApiClient({ fetch: fake.fetch });
    await api.updateEntry(SESSION, ENTRY_ID, 3, SWIM, {
      scope: "one",
      date: "2026-11-29",
    });
    await api.updateEntry(SESSION, ENTRY_ID, 3, SWIM, { scope: "series" });
    expect(fake.calls[0]?.url).toBe(
      `/api/parent/entries/${ENTRY_ID}?scope=one&date=2026-11-29`,
    );
    expect(fake.calls[0]?.init?.method).toBe("PATCH");
    expect(jsonBody(fake.calls[0]?.init)).toEqual({
      revision: 3,
      entry: SWIM,
    });
    expect(fake.calls[1]?.url).toBe(
      `/api/parent/entries/${ENTRY_ID}?scope=series`,
    );
  });

  it("deletes with the revision in the query; a full delete answers entry null", async () => {
    const fake = createFakeFetch();
    fake.setReplies(`/api/parent/entries/${ENTRY_ID}`, {
      status: 200,
      body: writeResponse(null),
    });
    const api = createApiClient({ fetch: fake.fetch });
    await expect(
      api.deleteEntry(SESSION, ENTRY_ID, 7, { scope: "series" }),
    ).resolves.toEqual({ entry: null, boardRefresh: "now" });
    expect(fake.calls[0]?.url).toBe(
      `/api/parent/entries/${ENTRY_ID}?scope=series&revision=7`,
    );
    expect(fake.calls[0]?.init?.method).toBe("DELETE");
  });

  it("encodes the entry id in the path", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/entries/a%2Fb", {
      status: 200,
      body: writeResponse(null),
    });
    await createApiClient({ fetch: fake.fetch }).deleteEntry(
      SESSION,
      "a/b",
      1,
      {
        scope: "series",
      },
    );
    expect(fake.calls[0]?.url).toContain("/api/parent/entries/a%2Fb?");
  });

  it("throws known error bodies as EditorApiError with their details", async () => {
    const fake = createFakeFetch();
    fake.setReplies(
      `/api/parent/entries/${ENTRY_ID}`,
      { status: 409, body: { error: "conflict", message: "x", revision: 5 } },
      {
        status: 422,
        body: {
          error: "invalid_entry",
          message: "x",
          issues: [{ code: "unknown_child", path: "childIds.0", message: "x" }],
        },
      },
      { status: 403, body: { error: "parent_locked", message: "x" } },
      {
        status: 422,
        body: { error: "limit_reached", message: "x", limit: "size" },
      },
    );
    const api = createApiClient({ fetch: fake.fetch });
    const update = (): Promise<unknown> =>
      api.updateEntry(SESSION, ENTRY_ID, 3, SWIM, { scope: "series" });
    const conflict = await rejection(update());
    expect(conflict).toBeInstanceOf(EditorApiError);
    expect(conflict).toMatchObject({
      code: "conflict",
      status: 409,
      revision: 5,
    });
    expect(await rejection(update())).toMatchObject({
      code: "invalid_entry",
      issues: [{ code: "unknown_child", path: "childIds.0" }],
    });
    expect(await rejection(update())).toMatchObject({
      code: "parent_locked",
      status: 403,
    });
    expect(await rejection(update())).toMatchObject({
      code: "limit_reached",
      limit: "size",
    });
  });

  it("a 401 is ApiError unauthorized; other bodies by status; no user text in messages", async () => {
    const fake = createFakeFetch();
    fake.setReplies(
      "/api/parent/entries",
      { status: 401, body: { error: "unauthorized", message: "x" } },
      { raw: "<html>oops</html>", status: 502 },
      "network-error",
    );
    const api = createApiClient({ fetch: fake.fetch });
    const secretTitle = { ...SWIM, title: "TESTONLY private title" };
    const unauthorized = await rejection(api.createEntry(SESSION, secretTitle));
    expect(unauthorized).toBeInstanceOf(ApiError);
    expect(unauthorized).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(
      await rejection(api.createEntry(SESSION, secretTitle)),
    ).toMatchObject({
      kind: "upstream",
      status: 502,
    });
    const network = await rejection(api.createEntry(SESSION, secretTitle));
    expect(network).toMatchObject({ kind: "network" });
    for (const error of [unauthorized, network]) {
      expect((error as Error).message).not.toContain("TESTONLY private title");
      expect((error as Error).message).not.toContain(SESSION);
    }
  });

  it("rejects a malformed success body", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/templates", {
      status: 200,
      body: { templates: [{ icon: "not an emoji" }] },
    });
    expect(
      await rejection(
        createApiClient({ fetch: fake.fetch }).getTemplates(SESSION),
      ),
    ).toMatchObject({ kind: "invalid-response" });
  });

  it("exports the document as sent, named by Content-Disposition", async () => {
    const fake = createFakeFetch();
    const doc = {
      format: "kidboard-entries",
      version: 1,
      exportedAt: "2026-11-22T11:00:00.000Z",
      entries: [appEntry(SWIM)],
    };
    fake.setReplies("/api/parent/export", {
      status: 200,
      body: doc,
      headers: {
        "Content-Disposition": `attachment; filename="kidboard-entries-${TODAY}.json"`,
      },
    });
    const result = await createApiClient({ fetch: fake.fetch }).exportEntries(
      SESSION,
    );
    expect(result.fileName).toBe(`kidboard-entries-${TODAY}.json`);
    expect(JSON.parse(result.text)).toEqual(doc);
  });

  it("imports with the mode in the query and the document as body", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/import", {
      status: 200,
      body: {
        mode: "replace",
        imported: 2,
        created: 1,
        updated: 1,
        boardRefresh: "now",
      },
    });
    const document = '{"format":"kidboard-entries","version":1,"entries":[]}';
    await expect(
      createApiClient({ fetch: fake.fetch }).importEntries(
        SESSION,
        "replace",
        document,
      ),
    ).resolves.toEqual({
      mode: "replace",
      imported: 2,
      created: 1,
      updated: 1,
      boardRefresh: "now",
    });
    expect(fake.calls[0]?.url).toBe("/api/parent/import?mode=replace");
    expect(fake.calls[0]?.init?.body).toBe(document);
  });
});

describe("ApiClient phone feed (T-46)", () => {
  const FEED = "/api/feed.ics?token=TESTONLY-not-a-secret-feed-0123456789";

  it("reads the relative feed URL with the session header, uncached", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/feed", {
      status: 200,
      body: { feedUrl: FEED },
    });
    await expect(
      createApiClient({ fetch: fake.fetch, token: TEST_TOKEN }).getParentFeed(
        SESSION,
      ),
    ).resolves.toEqual({ feedUrl: FEED });
    expect(fake.calls[0]?.url).toBe("/api/parent/feed");
    expect(fake.calls[0]?.init?.cache).toBe("no-store");
    expect(
      new Headers(fake.calls[0]?.init?.headers).get(PARENT_SESSION_HEADER),
    ).toBe(SESSION);
  });

  it("returns no URL when the feed is off", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/feed", { status: 200, body: {} });
    await expect(
      createApiClient({ fetch: fake.fetch }).getParentFeed(SESSION),
    ).resolves.toEqual({});
  });

  it("rejects a URL that is not a feed path and maps a locked session", async () => {
    const fake = createFakeFetch();
    fake.setReplies("/api/parent/feed", {
      status: 200,
      body: { feedUrl: "https://evil.example/x" },
    });
    expect(
      await rejection(
        createApiClient({ fetch: fake.fetch }).getParentFeed(SESSION),
      ),
    ).toMatchObject({ kind: "invalid-response" });
    fake.setReplies("/api/parent/feed", {
      status: 403,
      body: { error: "parent_locked", message: "x" },
    });
    expect(
      await rejection(
        createApiClient({ fetch: fake.fetch }).getParentFeed(SESSION),
      ),
    ).toMatchObject({ code: "parent_locked", status: 403 });
  });
});

describe("exportFileName", () => {
  it.each([
    [
      'attachment; filename="kidboard-entries-2026-11-22.json"',
      "kidboard-entries-2026-11-22.json",
    ],
    ["attachment; filename=backup.json", "backup.json"],
    ['attachment; filename="../../etc/passwd.json"', DEFAULT_EXPORT_FILE_NAME],
    ['attachment; filename=".hidden.json"', DEFAULT_EXPORT_FILE_NAME],
    ['attachment; filename="evil.exe"', DEFAULT_EXPORT_FILE_NAME],
    ["attachment", DEFAULT_EXPORT_FILE_NAME],
    [null, DEFAULT_EXPORT_FILE_NAME],
  ])("%s → %s", (header, name) => {
    expect(exportFileName(header)).toBe(name);
  });
});
