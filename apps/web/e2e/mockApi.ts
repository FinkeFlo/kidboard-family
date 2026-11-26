import { AgendaResponseSchema, PublicConfigSchema } from "@kidboard/shared";
import type { BrowserContext, Page } from "@playwright/test";

import { createFakeEditor, type FakeEditor } from "../demo/fakeEditorApi";

/*
 * Synthetic API for the E2E specs. Everything derives from one date, {@link TODAY}: the
 * fixture dates ({@link dateOf}) and the clock ({@link NOW}, Sunday 2026-11-22 12:00 in
 * Berlin), so "today" and the current band (midday) are deterministic.
 */

/** The fixture's "today" in the config zone (Europe/Berlin). */
export const TODAY = { year: 2026, month: 11, day: 22 } as const;

/**
 * Berlin's UTC offset for the whole fixture window ({@link TODAY} plus the 31 agenda
 * days, November to December: CET, no DST change).
 */
export const BERLIN_OFFSET = "+01:00";

/** {@link TODAY} plus `offset` calendar days, `YYYY-MM-DD` (pure calendar math). */
export function dateOf(offset: number): string {
  return new Date(Date.UTC(TODAY.year, TODAY.month - 1, TODAY.day + offset))
    .toISOString()
    .slice(0, 10);
}

/** ISO instant of the Berlin wall-clock `time` (`HH:mm` or `HH:mm:ss`) on day `day`. */
export function at(time: string, day = 0): string {
  const seconds = time.length === 5 ? `${time}:00` : time;
  return `${dateOf(day)}T${seconds}${BERLIN_OFFSET}`;
}

/** The fixed clock: {@link TODAY} at 12:00 Berlin (midday band). */
export const NOW = at("12:00");

export interface MockChild {
  id: string;
  name: string;
  color: string;
  avatar: string;
}

export const CHILDREN: MockChild[] = [
  { id: "mia", name: "Mia", color: "child-1", avatar: "🦊" },
  { id: "ben", name: "Ben", color: "child-2", avatar: "🐻" },
];

export function config(overrides: Record<string, unknown> = {}): unknown {
  return {
    locale: "auto",
    timeZone: "Europe/Berlin",
    children: CHILDREN,
    calendars: [{ id: "family", kind: "events" }],
    bands: {
      morningStart: "06:00",
      middayStart: "11:00",
      eveningStart: "17:00",
    },
    nightMode: { enabled: true, start: "19:30", end: "06:30" },
    countdown: { emojis: ["🎂"] },
    refreshMinutes: 60,
    autoReturnSeconds: 120,
    ...overrides,
  };
}

export interface MockEvent {
  title: string;
  icon: string;
  /** `HH:mm` (Berlin) on its day, or `null` for an all-day event. */
  time: string | null;
  childIds?: string[];
  /** Days after today (default 0). */
  day?: number;
  countdown?: boolean;
  /** Bring list (ADR-0010), omitted when absent. */
  bring?: string[];
}

export function agenda(
  events: MockEvent[],
  meals: { slot: string; title: string; icon: string; day?: number }[],
): unknown {
  return {
    generatedAt: NOW,
    timeZone: "Europe/Berlin",
    // `AGENDA_DAYS` (31): today plus the 30 days the countdown looks ahead.
    range: { from: dateOf(0), to: dateOf(31) },
    stale: false,
    sources: [{ id: "family", status: "ok", fetchedAt: NOW }],
    events: events.map((event, index) => {
      const base = {
        id: `e${String(index)}`,
        sourceId: "family",
        title: event.title,
        icon: event.icon,
        iconIsFallback: false,
        childIds: event.childIds ?? [],
        countdown: event.countdown ?? false,
        ...(event.bring === undefined ? {} : { bring: event.bring }),
      };
      const day = dateOf(event.day ?? 0);
      if (event.time === null) {
        return {
          ...base,
          allDay: true,
          start: day,
          end: dateOf((event.day ?? 0) + 1),
        };
      }
      // One hour long, on its day.
      const [hour = "0", minute = "00"] = event.time.split(":");
      const endHour = String(Math.min(Number(hour) + 1, 23)).padStart(2, "0");
      return {
        ...base,
        allDay: false,
        start: at(event.time, event.day ?? 0),
        end: at(`${endHour}:${minute}`, event.day ?? 0),
      };
    }),
    meals: meals.map((meal, index) => ({
      id: `m${String(index)}`,
      sourceId: "meals",
      date: dateOf(meal.day ?? 0),
      slot: meal.slot,
      title: meal.title,
      icon: meal.icon,
      iconIsFallback: false,
    })),
  };
}

/** Test-only hooks the clock init script puts on `window` (never part of the app). */
export interface KidboardTestHooks {
  /** Jumps the page clock to `ms` (epoch); it keeps ticking from there, also across reloads in this tab. */
  setNow(ms: number): void;
  /** Internal: start time of a {@link fixClock} call, ignored after a `setNow` in this tab. */
  start(ms: number): void;
}

declare global {
  interface Window {
    __kidboardTest?: KidboardTestHooks;
  }
}

/**
 * Offsets "now" so that it reads `now` when the page loads (the clock keeps ticking).
 * Done with a `Proxy` around the real `Date` so that `Date.prototype` stays the same
 * object: `@date-fns/tz` copies the prototype's methods at load time, and a `Date`
 * subclass (or Playwright's `page.clock` wrapper) hides them, which makes
 * `TZDate#getHours()` read the device zone. The proxy covers `new Date()`, `Date.now()`
 * and `Date()` called without `new` (`apply` trap).
 *
 * The init script also exposes `window.__kidboardTest.setNow(ms)` (use {@link setNow}).
 * A jump is kept in `sessionStorage`, so the clock stays jumped after a reload in the
 * same tab. Calling `fixClock` again on the same page re-bases the one proxy instead of
 * stacking a second one.
 */
export async function fixClock(page: Page, now: string = NOW): Promise<void> {
  await page.addInitScript((startMs: number) => {
    const key = "kidboard.e2e.clockOffset";
    const read = (): string | null => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        // Opaque origins (about:blank) have no storage.
        return null;
      }
    };
    if (window.__kidboardTest === undefined) {
      const RealDate = Date;
      let offset = 0;
      const now = (): number => RealDate.now() + offset;
      window.Date = new Proxy(RealDate, {
        construct(target, args: unknown[], newTarget): object {
          return Reflect.construct(
            target,
            args.length === 0 ? [now()] : args,
            newTarget,
          ) as object;
        },
        // `Date()` without `new` returns the current time as a string, whatever the args.
        apply(): string {
          return new RealDate(now()).toString();
        },
        get(target, property, receiver): unknown {
          return property === "now"
            ? now
            : Reflect.get(target, property, receiver);
        },
      });
      window.__kidboardTest = {
        setNow(ms: number): void {
          offset = ms - RealDate.now();
          try {
            window.sessionStorage.setItem(key, String(offset));
          } catch {
            // No storage: the jump lasts until the next navigation.
          }
        },
        start(ms: number): void {
          const stored = read();
          offset =
            stored !== null && Number.isFinite(Number(stored))
              ? Number(stored)
              : ms - RealDate.now();
        },
      };
    }
    window.__kidboardTest.start(startMs);
  }, Date.parse(now));
}

/**
 * Jumps the page clock to `iso`. By default it then wakes the app's minute clock the way
 * a tablet waking up would (`visibilitychange` while visible), so the new time shows at
 * once instead of at the next minute tick; that also refetches outdated queries (focus).
 * `wake: false` only moves the clock, e.g. right before a reload.
 */
export async function setNow(
  page: Page,
  iso: string,
  { wake = true }: { wake?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ ms, wakeUp }: { ms: number; wakeUp: boolean }) => {
      if (window.__kidboardTest === undefined) {
        throw new Error("fixClock() was not installed on this page");
      }
      window.__kidboardTest.setNow(ms);
      if (wakeUp) {
        document.dispatchEvent(new Event("visibilitychange"));
      }
    },
    { ms: Date.parse(iso), wakeUp: wake },
  );
}

/** What the mocked API answers; mutate it during a test to change later responses. */
export interface MockApi {
  config: unknown;
  configStatus: number;
  agenda: unknown;
  agendaStatus: number;
  /**
   * `/api/weather` answer (T-49); `undefined` answers 404 `weather_off` (as the worker
   * without a weather block).
   */
  weather: unknown;
  weatherStatus: number;
  /** Paths of every API request seen, in order (`/api/config`, `/api/agenda`, …). */
  requests: string[];
  /** The parent lock (`/api/parent/*`); answered only when `config.editor` is true. */
  parent: MockParent;
  /**
   * The editor API behind the parent lock (`demo/fakeEditorApi.ts`, in memory): seed
   * entries, inject failures, read the writes. Its app entries are added to the agenda
   * answers, like the worker's virtual app sources.
   */
  editor: FakeEditor;
}

export interface MockBoardOptions {
  config?: unknown;
  configStatus?: number;
  agenda?: unknown;
  agendaStatus?: number;
  /** `/api/weather` answer; default none (404 `weather_off`). */
  weather?: unknown;
  weatherStatus?: number;
  /** ISO instant the clock reads when the page loads (default {@link NOW}). */
  now?: string;
  /**
   * Where to mock `/api/*`: on the page (default) or on the context. With a service
   * worker in control (`serviceWorkers: "allow"`) the worker re-issues API requests and
   * only `context.route()` sees them.
   */
  via?: "page" | "context";
}

/**
 * Fixes the clock and answers `/api/config`, `/api/agenda` and `/api/weather` from a
 * mutable {@link MockApi}.
 */
export async function mockBoard(
  page: Page,
  options: MockBoardOptions = {},
): Promise<MockApi> {
  // The mock's clock follows the page clock (fixed "now" at page load, then ticking).
  const clockOffset = Date.parse(options.now ?? NOW) - Date.now();
  const mockNow = (): number => Date.now() + clockOffset;
  const api: MockApi = {
    config: options.config ?? config(),
    configStatus: options.configStatus ?? 200,
    agenda: options.agenda ?? agenda([], []),
    agendaStatus: options.agendaStatus ?? 200,
    weather: options.weather,
    weatherStatus: options.weatherStatus ?? 200,
    requests: [],
    parent: {
      pin: MOCK_PARENT_PIN,
      failures: 0,
      lockedUntil: null,
      unlocks: [],
    },
    editor: createFakeEditor({
      config: () => PublicConfigSchema.parse(api.config),
      now: mockNow,
      isSession: (token) => token === MOCK_PARENT_SESSION,
      feedUrl: MOCK_FEED_URL,
      google: (range) => {
        const parsed = AgendaResponseSchema.safeParse(api.agenda);
        if (!parsed.success) return { events: [], meals: [] };
        const inRange = (date: string): boolean =>
          date >= range.from && date < range.to;
        return {
          events: parsed.data.events.filter((event) =>
            inRange(event.start.slice(0, 10)),
          ),
          meals: parsed.data.meals.filter((meal) => inRange(meal.date)),
        };
      },
    }),
  };
  await fixClock(page, options.now);
  const target: Page | BrowserContext =
    options.via === "context" ? page.context() : page;
  await target.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    api.requests.push(path);
    if (path === "/api/config") {
      return route.fulfill({ status: api.configStatus, json: api.config });
    }
    if (path === "/api/agenda") {
      return route.fulfill({
        status: api.agendaStatus,
        json: withAppEntries(api),
      });
    }
    if (path === "/api/weather") {
      return api.weather === undefined
        ? route.fulfill({ status: 404, json: { error: "weather_off" } })
        : route.fulfill({ status: api.weatherStatus, json: api.weather });
    }
    if (path.startsWith("/api/parent/")) {
      return route.fulfill(answerParent(api, path, route.request()));
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return api;
}

/**
 * The agenda answer plus the editor's app entries (as the worker's `app-events` /
 * `app-meals` sources); unchanged while there are none.
 */
function withAppEntries(api: MockApi): unknown {
  if (api.agendaStatus !== 200 || api.editor.entries().length === 0) {
    return api.agenda;
  }
  const parsed = AgendaResponseSchema.safeParse(api.agenda);
  if (!parsed.success) return api.agenda;
  const body = parsed.data;
  const app = api.editor.agendaItems({
    from: body.range.from,
    to: body.range.to,
  });
  return {
    ...body,
    events: [...body.events, ...app.events],
    meals: [...body.meals, ...app.meals],
  };
}

/** Synthetic phone-feed URL of the mock (`/api/parent/feed`; a made-up token). */
export const MOCK_FEED_URL =
  "/api/feed.ics?token=TESTONLY-not-a-secret-feed-0123456789";

/** Synthetic parent PIN of the mock (ADR-0013: 6-12 digits). */
export const MOCK_PARENT_PIN = "246810";
/** Synthetic session token the mock hands out (low entropy, not a real signature). */
export const MOCK_PARENT_SESSION = "v1.0.TESTONLY-not-a-signature";
/** ADR-0013: 5 wrong PINs within 15 minutes lock the unlock route for 15 minutes. */
const MOCK_MAX_FAILURES = 5;
const MOCK_LOCKOUT_SECONDS = 15 * 60;

/** State of the mocked parent lock (`/api/parent/*`), mutable during a test. */
export interface MockParent {
  pin: string;
  /** Wrong PINs since the last lockout or success. */
  failures: number;
  /** Lockout end (epoch ms, test runner clock) or `null`. */
  lockedUntil: number | null;
  /** Every unlock request: the PIN sent and the access token header seen. */
  unlocks: { pin: unknown; authorization: string | null }[];
}

interface ParentRequest {
  method(): string;
  url(): string;
  postData(): string | null;
  headers(): Record<string, string>;
}

/**
 * Mirrors the worker's parent routes (docs/ARCHITECTURE.md "Parent lock"): editor off
 * (config without `editor: true`) → 404; `POST /unlock` → 200 `{ token, expiresAt }`,
 * 403 `wrong_pin` with `attemptsLeft`, or 429 `parent_lockout` with `Retry-After`;
 * `GET /session` with `X-KidBoard-Parent` → `{ expiresAt }` or 403 `parent_locked`;
 * the editor routes go to {@link MockApi.editor}.
 */
function answerParent(
  api: MockApi,
  path: string,
  request: ParentRequest,
): { status: number; json: unknown; headers?: Record<string, string> } {
  const enabled =
    typeof api.config === "object" &&
    api.config !== null &&
    (api.config as { editor?: unknown }).editor === true;
  if (!enabled) return { status: 404, json: { error: "not_found" } };
  const parent = api.parent;
  const now = Date.now();
  const expiresAt = new Date(now + 15 * 60_000).toISOString();
  if (path === "/api/parent/unlock" && request.method() === "POST") {
    const body = JSON.parse(request.postData() ?? "null") as {
      pin?: unknown;
    } | null;
    parent.unlocks.push({
      pin: body?.pin,
      authorization: request.headers()["authorization"] ?? null,
    });
    const lockout = (): {
      status: number;
      json: unknown;
      headers: Record<string, string>;
    } => {
      const seconds = Math.max(
        1,
        Math.ceil(((parent.lockedUntil ?? now) - now) / 1000),
      );
      return {
        status: 429,
        json: { error: "parent_lockout", retryAfterSeconds: seconds },
        headers: { "Retry-After": String(seconds) },
      };
    };
    if (parent.lockedUntil !== null && parent.lockedUntil > now) {
      return lockout();
    }
    if (body?.pin === parent.pin) {
      parent.failures = 0;
      return { status: 200, json: { token: MOCK_PARENT_SESSION, expiresAt } };
    }
    parent.failures += 1;
    if (parent.failures >= MOCK_MAX_FAILURES) {
      parent.failures = 0;
      parent.lockedUntil = now + MOCK_LOCKOUT_SECONDS * 1000;
      return lockout();
    }
    return {
      status: 403,
      json: {
        error: "wrong_pin",
        attemptsLeft: MOCK_MAX_FAILURES - parent.failures,
      },
    };
  }
  if (path === "/api/parent/session" && request.method() === "GET") {
    return request.headers()["x-kidboard-parent"] === MOCK_PARENT_SESSION
      ? { status: 200, json: { expiresAt } }
      : { status: 403, json: { error: "parent_locked" } };
  }
  const editorAnswer = api.editor.handle({
    method: request.method(),
    path,
    search: new URL(request.url()).search,
    body: request.postData(),
    session: request.headers()["x-kidboard-parent"] ?? null,
  });
  return editorAnswer ?? { status: 404, json: { error: "not_found" } };
}

/** localStorage key of the persisted query cache (`PERSIST_STORAGE_KEY`). */
export const QUERY_CACHE_KEY = "kidboard.queryCache";
/** localStorage key of the access token (`ACCESS_TOKEN_STORAGE_KEY`). */
export const ACCESS_TOKEN_KEY = "kidboard.accessToken";

/**
 * Titles of all events in the agendas of the persisted query cache (empty without a
 * cache). The persister writes throttled, so poll it (`expect.poll`).
 */
export async function persistedTitles(page: Page): Promise<string[]> {
  return page.evaluate((key: string) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const stored = JSON.parse(raw) as {
      clientState: {
        queries: { queryKey: unknown[]; state: { data?: unknown } }[];
      };
    };
    return stored.clientState.queries
      .flatMap((query) => {
        const data = query.state.data as
          { events?: { title: string }[] } | undefined;
        return query.queryKey[1] === "agenda" ? (data?.events ?? []) : [];
      })
      .map((event) => event.title);
  }, QUERY_CACHE_KEY);
}

/** Waits until the service worker is active and controls the page; returns its script URL. */
export async function waitForServiceWorker(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          resolve();
        });
      });
    }
    return registration.active?.scriptURL ?? "";
  });
}
