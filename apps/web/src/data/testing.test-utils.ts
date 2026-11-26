// Test helpers for the data layer (synthetic fixtures only; not part of the app bundle).
import {
  type AgendaResponse,
  type AppConfigInput,
  type PublicConfig,
  PublicConfigSchema,
  type WeatherDay,
  type WeatherResponse,
} from "@kidboard/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { vi } from "vitest";

import type { ApiClient } from "./apiClient";
import { DataProvider } from "./DataProvider";
import type { KeyValueStorage } from "./storage";

/** Low-entropy synthetic token (gitleaks-friendly). */
export const TEST_TOKEN = "TESTONLY-not-a-secret";

export const TODAY = "2026-11-22";

export function configFixture(
  overrides: Partial<AppConfigInput> = {},
): PublicConfig {
  return PublicConfigSchema.parse({
    locale: "en",
    timeZone: "Europe/Berlin",
    calendars: [{ id: "family", kind: "events" }],
    ...overrides,
  });
}

export function agendaFixture(
  overrides: Partial<AgendaResponse> = {},
  title = "Swimming",
): AgendaResponse {
  return {
    generatedAt: "2026-11-22T08:00:00+01:00",
    timeZone: "Europe/Berlin",
    range: { from: TODAY, to: "2026-11-30" },
    stale: false,
    sources: [
      { id: "family", status: "ok", fetchedAt: "2026-11-22T08:00:00+01:00" },
    ],
    events: [
      {
        id: "e1",
        sourceId: "family",
        title,
        icon: "🏊",
        iconIsFallback: false,
        childIds: [],
        allDay: false,
        start: "2026-11-22T10:00:00+01:00",
        end: "2026-11-22T11:00:00+01:00",
        countdown: false,
      },
    ],
    meals: [],
    ...overrides,
  };
}

/** One forecast day (°C): mild and dry unless overridden. */
export function weatherDayFixture(
  date: string,
  overrides: Partial<WeatherDay> = {},
): WeatherDay {
  return {
    date,
    code: 1,
    tempMax: 12,
    tempMin: 4,
    feelsMin: 9,
    feelsMax: 11,
    rain: false,
    snow: false,
    uvMax: 2,
    ...overrides,
  };
}

/**
 * A `/api/weather` answer fetched 2026-11-22 08:00 Berlin: today mild (🧥), tomorrow cold
 * and rainy (🌂 👢 🧥, knitted hat, 🧤), then five dry days.
 */
export function weatherFixture(
  overrides: Partial<WeatherResponse> = {},
): WeatherResponse {
  return {
    fetchedAt: "2026-11-22T08:00:00+01:00",
    unit: "celsius",
    current: { temperature: 8, code: 1 },
    days: [
      weatherDayFixture("2026-11-22"),
      weatherDayFixture("2026-11-23", {
        code: 63,
        tempMax: 7,
        tempMin: 2,
        feelsMin: 1,
        feelsMax: 4,
        rain: true,
      }),
      ...[24, 25, 26, 27, 28].map((day) =>
        weatherDayFixture(`2026-11-${String(day)}`, { code: 3, tempMax: 9 }),
      ),
    ],
    stale: false,
    ...overrides,
  };
}

/** The 502 body the worker sends when every source failed. */
export function allFailedAgenda(): AgendaResponse {
  return agendaFixture({
    sources: [{ id: "family", status: "error" }],
    events: [],
  });
}

export type Reply =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { raw: string; status?: number }
  | "network-error"
  | "hang";

/** Reply queue per path; the last reply of a path repeats. */
export interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
  setReplies(
    path:
      "/api/config" | "/api/agenda" | "/api/weather" | `/api/parent/${string}`,
    ...replies: Reply[]
  ): void;
  count(path: string): number;
}

function pathOf(url: string): string {
  return new URL(url, "http://kidboard.test").pathname;
}

export function createFakeFetch(): FakeFetch {
  const replies = new Map<string, Reply[]>();
  const calls: FakeFetch["calls"] = [];
  const impl = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    const path = pathOf(url);
    const queue = replies.get(path) ?? [];
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (reply === "network-error") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (reply === "hang") {
      return new Promise((_, reject) => {
        const abort = (): void => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (init?.signal?.aborted === true) {
          abort();
        }
        init?.signal?.addEventListener("abort", abort);
      });
    }
    if ("raw" in reply) {
      return Promise.resolve(
        new Response(reply.raw, { status: reply.status ?? 200 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { "Content-Type": "application/json", ...reply.headers },
      }),
    );
  };
  return {
    fetch: vi.fn(impl),
    calls,
    setReplies: (path, ...list) => {
      replies.set(path, list);
    },
    count: (path) => calls.filter((c) => pathOf(c.url) === path).length,
  };
}

/** `renderHook` wrapper around {@link DataProvider}. */
export function dataWrapper(
  apiClient: ApiClient,
  queryClient: QueryClient,
  storage: KeyValueStorage | undefined,
): (props: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return createElement(
      DataProvider,
      { apiClient, queryClient, storage },
      children,
    );
  };
}

/** In-memory {@link KeyValueStorage} (one per test, so throttled writes cannot leak). */
export function createMemoryStorage(): KeyValueStorage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
