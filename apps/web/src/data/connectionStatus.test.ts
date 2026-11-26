import { describe, expect, it } from "vitest";

import {
  deriveConnectionStatus,
  isAgendaDegraded,
  isAgendaIncomplete,
  type QueryHealth,
} from "./connectionStatus";
import { AGENDA_DAYS } from "./queries";
import { queryKeys } from "./queryKeys";
import { agendaFixture } from "./testing.test-utils";

const ok: QueryHealth = { hasData: true, isError: false, dataStale: false };
const pending: QueryHealth = {
  hasData: false,
  isError: false,
  dataStale: false,
};
const failedNoData: QueryHealth = {
  hasData: false,
  isError: true,
  dataStale: false,
};
const failedWithData: QueryHealth = {
  hasData: true,
  isError: true,
  dataStale: false,
};
const workerStale: QueryHealth = {
  hasData: true,
  isError: false,
  dataStale: true,
};

describe("deriveConnectionStatus", () => {
  it.each<[string, Parameters<typeof deriveConnectionStatus>[0], string]>([
    ["restoring", { restoring: true, online: true, queries: [ok] }, "loading"],
    [
      "no query in use",
      { restoring: false, online: true, queries: [] },
      "loading",
    ],
    [
      "first fetch running",
      { restoring: false, online: true, queries: [ok, pending] },
      "loading",
    ],
    [
      "all data current",
      { restoring: false, online: true, queries: [ok, ok] },
      "ready",
    ],
    [
      "offline with data",
      { restoring: false, online: false, queries: [ok, ok] },
      "offline",
    ],
    [
      "offline without data",
      { restoring: false, online: false, queries: [pending] },
      "offline",
    ],
    [
      "offline beats stale",
      {
        restoring: false,
        online: false,
        queries: [failedWithData, workerStale],
      },
      "offline",
    ],
    [
      "worker served last-good",
      { restoring: false, online: true, queries: [ok, workerStale] },
      "stale",
    ],
    [
      "refetch failed, data kept",
      { restoring: false, online: true, queries: [ok, failedWithData] },
      "stale",
    ],
    [
      "failed without data",
      { restoring: false, online: true, queries: [ok, failedNoData] },
      "error",
    ],
    [
      "error beats offline",
      { restoring: false, online: false, queries: [failedNoData] },
      "error",
    ],
    [
      "error beats loading",
      { restoring: false, online: true, queries: [pending, failedNoData] },
      "error",
    ],
  ])("%s → %s", (_name, input, expected) => {
    expect(deriveConnectionStatus(input)).toBe(expected);
  });
});

describe("isAgendaDegraded", () => {
  it("is false for a complete, fresh agenda", () => {
    expect(isAgendaDegraded(agendaFixture())).toBe(false);
  });

  it("is true when the worker served last-good data", () => {
    expect(isAgendaDegraded(agendaFixture({ stale: true }))).toBe(true);
  });

  it("is true when a source failed even though stale is false", () => {
    expect(
      isAgendaDegraded(
        agendaFixture({
          stale: false,
          sources: [
            {
              id: "family",
              status: "ok",
              fetchedAt: "2026-11-22T08:00:00+01:00",
            },
            { id: "meals", status: "error" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false for non-agenda data", () => {
    expect(isAgendaDegraded(undefined)).toBe(false);
    expect(isAgendaDegraded({ refreshMinutes: 60 })).toBe(false);
  });
});

describe("isAgendaIncomplete", () => {
  const key = queryKeys.agenda({ from: "2026-11-23", days: 8 });
  const covering = (to: string): ReturnType<typeof agendaFixture> =>
    agendaFixture({ range: { from: "2026-11-23", to } });
  const FETCHED = Date.parse("2026-11-23T06:00:00Z");

  it("is false for a real response covering all requested days", () => {
    expect(isAgendaIncomplete(key, covering("2026-12-01"), FETCHED)).toBe(
      false,
    );
  });

  it("is true when the data ends before from + days", () => {
    expect(isAgendaIncomplete(key, covering("2026-11-30"), FETCHED)).toBe(true);
  });

  it("is true for a midnight seed (dataUpdatedAt 0), even when it covers all days", () => {
    expect(isAgendaIncomplete(key, covering("2026-12-01"), 0)).toBe(true);
  });

  it("with the board's 31 days (T-19): a full response is complete, the 30-day seed after midnight is not", () => {
    const month = queryKeys.agenda({ from: "2026-11-23", days: AGENDA_DAYS });
    expect(AGENDA_DAYS).toBe(31);
    expect(isAgendaIncomplete(month, covering("2026-12-24"), FETCHED)).toBe(
      false,
    );
    // Yesterday's 31-day response re-scoped to today ends one day early.
    expect(isAgendaIncomplete(month, covering("2026-12-23"), FETCHED)).toBe(
      true,
    );
    expect(isAgendaIncomplete(month, covering("2026-12-24"), 0)).toBe(true);
  });

  it("is false without data or for keys and data of another shape", () => {
    expect(isAgendaIncomplete(key, undefined, 0)).toBe(false);
    expect(isAgendaIncomplete(key, { refreshMinutes: 60 }, FETCHED)).toBe(
      false,
    );
    expect(
      isAgendaIncomplete(queryKeys.config(), covering("2026-11-24"), FETCHED),
    ).toBe(false);
    expect(
      isAgendaIncomplete(
        ["kidboard", "agenda", "2026-02-30", 8],
        covering("2026-11-24"),
        FETCHED,
      ),
    ).toBe(false);
  });
});
