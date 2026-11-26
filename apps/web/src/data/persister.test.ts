import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { describe, expect, it } from "vitest";

import {
  createPersistOptions,
  deserializePersistedClient,
  isWithinMaxAge,
  PERSIST_BUSTER,
  PERSIST_STORAGE_KEY,
  serializePersistedClient,
  shouldPersistQuery,
  supersededAgendas,
} from "./persister";
import { AGENDA_DAYS } from "./queries";
import { PERSIST_MAX_AGE_MS } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { agendaFixture, configFixture, TODAY } from "./testing.test-utils";

const RANGE = { from: TODAY, days: 8 };

function client(
  queries: PersistedClient["clientState"]["queries"],
): PersistedClient {
  return {
    timestamp: 1000,
    buster: PERSIST_BUSTER,
    clientState: { queries, mutations: [] },
  };
}

function erroredAgendaQuery(): PersistedClient["clientState"]["queries"][number] {
  const queryClient = new QueryClient();
  const key = queryKeys.agenda(RANGE);
  queryClient.setQueryData(key, agendaFixture());
  const query = queryClient.getQueryCache().find({ queryKey: key });
  if (query === undefined) {
    throw new Error("query missing");
  }
  query.setState({
    status: "error",
    error: new Error("secret-ish detail"),
    fetchFailureReason: new Error("secret-ish detail"),
    fetchFailureCount: 3,
  });
  return {
    queryKey: query.queryKey,
    queryHash: query.queryHash,
    dehydratedAt: 2000,
    state: query.state,
  };
}

describe("shouldPersistQuery", () => {
  it("persists KidBoard queries with data, including after a failed refetch", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.agenda(RANGE), agendaFixture());
    const query = queryClient.getQueryCache().getAll()[0];
    if (query === undefined) {
      throw new Error("query missing");
    }
    expect(shouldPersistQuery(query)).toBe(true);
    query.setState({ status: "error", error: new Error("502") });
    expect(shouldPersistQuery(query)).toBe(true);
  });

  it("skips queries without data and foreign keys", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["other"], { a: 1 });
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: queryKeys.config() });
    for (const query of queryClient.getQueryCache().getAll()) {
      expect(shouldPersistQuery(query)).toBe(false);
    }
  });
});

describe("serializePersistedClient", () => {
  it("stores data as success and strips error details", () => {
    const raw = serializePersistedClient(client([erroredAgendaQuery()]));
    const stored = JSON.parse(raw) as PersistedClient;
    const state = stored.clientState.queries[0]?.state;

    expect(raw).not.toContain("secret-ish detail");
    expect(state?.status).toBe("success");
    expect(state?.error).toBeNull();
    expect(state?.fetchFailureCount).toBe(0);
    expect(state?.data).toEqual(agendaFixture());
  });

  it("drops foreign and data-less queries", () => {
    const base = erroredAgendaQuery();
    const raw = serializePersistedClient(
      client([
        { ...base, queryKey: ["other"], queryHash: '["other"]' },
        { ...base, state: { ...base.state, data: undefined } },
      ]),
    );
    expect((JSON.parse(raw) as PersistedClient).clientState.queries).toEqual(
      [],
    );
  });
});

describe("deserializePersistedClient", () => {
  it("round-trips valid config and agenda data", () => {
    const agenda = erroredAgendaQuery();
    const config = {
      ...agenda,
      queryKey: queryKeys.config(),
      queryHash: JSON.stringify(queryKeys.config()),
      state: { ...agenda.state, data: configFixture() },
    };
    const restored = deserializePersistedClient(
      serializePersistedClient(client([agenda, config])),
    );

    expect(restored.timestamp).toBe(1000);
    expect(restored.buster).toBe(PERSIST_BUSTER);
    expect(restored.clientState.queries.map((q) => q.state.data)).toEqual([
      agendaFixture(),
      configFixture(),
    ]);
  });

  it("drops queries whose data no longer matches the schema", () => {
    const valid = erroredAgendaQuery();
    const invalid = {
      ...valid,
      queryKey: queryKeys.agenda({ from: "2026-11-23", days: 8 }),
      queryHash: "other",
      state: { ...valid.state, data: { events: "nope" } },
    };
    const restored = deserializePersistedClient(
      serializePersistedClient(client([valid, invalid])),
    );

    expect(restored.clientState.queries).toHaveLength(1);
    expect(restored.clientState.queries[0]?.queryKey).toEqual(
      queryKeys.agenda(RANGE),
    );
  });

  it("throws on structurally broken storage (TanStack then discards it)", () => {
    expect(() => deserializePersistedClient("{not json")).toThrow();
    expect(() => deserializePersistedClient('{"timestamp":"x"}')).toThrow();
  });
});

describe("per-query max age (7 d)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("isWithinMaxAge accepts up to exactly 7 d", () => {
    expect(isWithinMaxAge(0, PERSIST_MAX_AGE_MS)).toBe(true);
    expect(isWithinMaxAge(0, PERSIST_MAX_AGE_MS + 1)).toBe(false);
  });

  it("neither re-persists nor restores a query older than 7 d", () => {
    const fresh = erroredAgendaQuery();
    fresh.state.dataUpdatedAt = Date.now() - DAY;
    const old = {
      ...fresh,
      queryKey: queryKeys.agenda({ from: "2026-11-10", days: 8 }),
      queryHash: "old",
      state: { ...fresh.state, dataUpdatedAt: Date.now() - 8 * DAY },
    };

    const raw = serializePersistedClient(client([fresh, old]));
    const written = (JSON.parse(raw) as PersistedClient).clientState.queries;
    expect(written.map((q) => q.queryHash)).toEqual([fresh.queryHash]);

    // A blob written earlier (when the query was still young) is filtered on restore.
    const legacy = JSON.stringify({
      ...client([]),
      clientState: {
        queries: [
          { ...old, state: { ...old.state, status: "success", error: null } },
          {
            ...fresh,
            state: { ...fresh.state, status: "success", error: null },
          },
        ],
        mutations: [],
      },
    });
    const restored = deserializePersistedClient(legacy).clientState.queries;
    expect(restored.map((q) => q.queryHash)).toEqual([fresh.queryHash]);
  });
});

describe("createPersistOptions", () => {
  it("uses maxAge 7 d, the versioned buster and the persist filter", () => {
    const options = createPersistOptions(undefined);
    expect(options.maxAge).toBe(PERSIST_MAX_AGE_MS);
    expect(options.buster).toBe(PERSIST_BUSTER);
    expect(PERSIST_BUSTER).toMatch(/^\d+\.\d+\.\d+.*\+cache\d+$/);
    expect(options.dehydrateOptions?.shouldDehydrateQuery).toBe(
      shouldPersistQuery,
    );
  });

  it("is a no-op persister without storage", async () => {
    const { persister } = createPersistOptions(undefined);
    await persister.persistClient(client([]));
    expect(await persister.restoreClient()).toBeUndefined();
    expect(window.localStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull();
  });
});

describe("superseded agendas (T-19: one 31-day agenda per day would pile up)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  function agendaQuery(
    from: string,
    to: string,
    fetchedAt: number,
  ): PersistedClient["clientState"]["queries"][number] {
    const base = erroredAgendaQuery();
    const key = queryKeys.agenda({ from, days: AGENDA_DAYS });
    return {
      ...base,
      queryKey: key,
      queryHash: JSON.stringify(key),
      state: {
        ...base.state,
        data: agendaFixture({ range: { from, to } }),
        dataUpdatedAt: fetchedAt,
      },
    };
  }

  const writtenFroms = (queries: PersistedClient["clientState"]["queries"]) =>
    (
      JSON.parse(serializePersistedClient(client(queries))) as PersistedClient
    ).clientState.queries.map((q) => q.queryKey[2]);

  it("keeps only the newest of the daily agendas, plus the config", () => {
    const now = Date.now();
    const daily = Array.from({ length: 7 }, (_, day) =>
      agendaQuery(
        `2026-11-${String(16 + day)}`,
        `2026-12-${String(17 + day)}`,
        now - (6 - day) * DAY,
      ),
    );
    const config = {
      ...daily[0],
      queryKey: queryKeys.config(),
      queryHash: JSON.stringify(queryKeys.config()),
      state: { ...erroredAgendaQuery().state, data: configFixture() },
    } as PersistedClient["clientState"]["queries"][number];
    expect(writtenFroms([...daily, config])).toEqual(["2026-11-22", undefined]);
  });

  it("keeps an older agenda that reaches further than the newer one", () => {
    const now = Date.now();
    const longOld = agendaQuery("2026-11-22", "2026-12-23", now - DAY);
    const shortNew = agendaQuery("2026-11-23", "2026-11-25", now);
    expect(writtenFroms([longOld, shortNew])).toEqual([
      "2026-11-22",
      "2026-11-23",
    ]);
    // Same fetch time: neither supersedes the other.
    const twin = agendaQuery("2026-11-23", "2026-12-24", now - DAY);
    expect(supersededAgendas([longOld, twin])).toEqual(new Set());
  });

  it("ignores seeds, expired and invalid data as superseders", () => {
    const now = Date.now();
    const real = agendaQuery("2026-11-22", "2026-12-23", now - DAY);
    const seed = agendaQuery("2026-11-23", "2026-12-23", 0);
    const expired = agendaQuery("2026-11-23", "2026-12-24", now - 8 * DAY);
    const broken = {
      ...agendaQuery("2026-11-23", "2026-12-24", now),
      queryHash: "broken",
    };
    broken.state = { ...broken.state, data: { range: "nope" } };
    expect(supersededAgendas([real, seed, expired, broken])).toEqual(new Set());
    expect(writtenFroms([real, seed, expired])).toEqual(["2026-11-22"]);
  });

  it("stores a busy 31-day agenda well below the localStorage quota", () => {
    const from = TODAY;
    const events = Array.from({ length: AGENDA_DAYS * 12 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 10, 22 + Math.floor(i / 12)))
        .toISOString()
        .slice(0, 10);
      const hour = String(7 + (i % 12)).padStart(2, "0");
      return {
        ...agendaFixture().events[0],
        id: `event-${String(i).padStart(4, "0")}-abcdef0123456789`,
        title: `Activity with a longer title ${String(i)}`,
        start: `${day}T${hour}:00:00+01:00`,
        end: `${day}T${hour}:45:00+01:00`,
      };
    }) as ReturnType<typeof agendaFixture>["events"];
    const meals = Array.from({ length: AGENDA_DAYS * 3 }, (_, i) => ({
      id: `meal-${String(i).padStart(4, "0")}-abcdef0123456789`,
      sourceId: "meals",
      date: new Date(Date.UTC(2026, 10, 22 + Math.floor(i / 3)))
        .toISOString()
        .slice(0, 10),
      slot: "lunch" as const,
      title: `Meal with a name ${String(i)}`,
      icon: "🍝",
      iconIsFallback: false,
    }));
    const query = agendaQuery(from, "2026-12-23", Date.now());
    query.state = {
      ...query.state,
      data: agendaFixture({ events, meals, range: { from, to: "2026-12-23" } }),
    };
    const raw = serializePersistedClient(client([query]));
    // 372 events + 93 meals: about 110 KB, a few percent of the ~5 MB quota.
    expect(raw.length).toBeLessThan(200_000);
    expect(
      (JSON.parse(raw) as PersistedClient).clientState.queries,
    ).toHaveLength(1);
  });
});
