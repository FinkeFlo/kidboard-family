import {
  addCalendarDays,
  type AgendaResponse,
  type PublicConfig,
} from "@kidboard/shared";

import {
  demoAgenda,
  demoAgendaStart,
  demoConfig,
  demoToday,
  demoWeather,
} from "./demoData";
import {
  createFakeEditor,
  type DateRange,
  type FakeEditor,
  type FakeRequest,
  type FakeResponse,
} from "./fakeEditorApi";

/*
 * The whole API of the demo server (`pnpm dev:demo`): the synthetic board data and
 * weather of `demoData.ts` plus the parent editor against the in-memory fake (`fakeEditorApi.ts`),
 * so the editor can be tried without a worker, D1 or a calendar. The PIN is
 * {@link DEMO_PARENT_PIN}, shown on the PIN pad in demo mode only. Entries live in the
 * dev server's memory until it restarts and appear on the board like the worker's app
 * entries.
 */

/** PIN of the demo parent area (synthetic; the real PIN is a worker secret). */
export const DEMO_PARENT_PIN = "123456";
/** Session length, as on the worker (ADR-0013). */
const SESSION_MS = 15 * 60_000;
/** Lockout rules, as on the worker (ADR-0013): 5 wrong PINs in 15 min lock 15 min. */
export const DEMO_MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;
/** Low-entropy synthetic session token prefix (not a signature). */
const SESSION_PREFIX = "demo-session-";

/** The demo config with the editor switched on. */
export function demoEditorConfig(): PublicConfig {
  return { ...demoConfig(), editor: true };
}

export interface DemoApi {
  /** Answers an API request; `null` for paths it does not serve. */
  handle(request: FakeRequest): FakeResponse | null;
  editor: FakeEditor;
}

/** Synthetic phone-feed URL of the demo (a made-up token, no real data). */
export const DEMO_FEED_URL =
  "/api/feed.ics?token=demo-feed-not-a-secret-0123456789";

/**
 * The demo's unlock limiter: the worker's visible behaviour (ADR-0013) in memory, so
 * the PIN pad's "tries left" and lockout states can be tried: each wrong PIN answers
 * 403 `wrong_pin` with the tries left (4, 3, 2, 1), the 5th within 15 minutes and
 * every attempt during the following 15 minutes 429 `parent_lockout` with
 * `Retry-After`; the right PIN clears the wrong ones. Restarting the demo server resets
 * it.
 */
function demoLimiter(now: () => number): {
  check: () => FakeResponse | null;
  fail: () => FakeResponse;
  succeed: () => void;
} {
  let failures: number[] = [];
  let lockedUntil = 0;
  const lockout = (untilMs: number): FakeResponse => {
    const retryAfterSeconds = Math.max(1, Math.ceil((untilMs - now()) / 1000));
    return {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
      json: {
        error: "parent_lockout",
        message: "",
        retryAfterSeconds,
      },
    };
  };
  return {
    check: () => (lockedUntil > now() ? lockout(lockedUntil) : null),
    fail: () => {
      const at = now();
      failures = [...failures.filter((t) => t > at - FAILURE_WINDOW_MS), at];
      if (failures.length >= DEMO_MAX_FAILURES) {
        failures = [];
        lockedUntil = at + LOCKOUT_MS;
        return lockout(lockedUntil);
      }
      return {
        status: 403,
        json: {
          error: "wrong_pin",
          message: "",
          attemptsLeft: DEMO_MAX_FAILURES - failures.length,
        },
      };
    },
    succeed: () => {
      failures = [];
    },
  };
}

export function createDemoApi(now: () => number = Date.now): DemoApi {
  const sessions = new Map<string, number>();
  const limiter = demoLimiter(now);
  let counter = 0;
  const google = (range: DateRange): ReturnType<FakeEditor["agendaItems"]> => {
    const agenda = demoAgenda(demoToday(now()), new Date(now()).toISOString());
    const inRange = (date: string): boolean =>
      date >= range.from && date < range.to;
    return {
      events: agenda.events.filter((event) =>
        inRange(event.start.slice(0, 10)),
      ),
      meals: agenda.meals.filter((meal) => inRange(meal.date)),
    };
  };
  const editor = createFakeEditor({
    config: demoEditorConfig,
    now,
    google,
    feedUrl: DEMO_FEED_URL,
    isSession: (token) => {
      const until = token === null ? undefined : sessions.get(token);
      return until !== undefined && until > now();
    },
  });

  const agenda = (search: string): AgendaResponse => {
    const from = demoAgendaStart(search, now());
    const generatedAt = new Date(now()).toISOString();
    const base = demoAgenda(from, generatedAt);
    const app = editor.agendaItems({ from, to: addCalendarDays(from, 31) });
    return {
      ...base,
      sources: [
        ...base.sources,
        { id: "app-events", status: "ok", fetchedAt: generatedAt },
        { id: "app-meals", status: "ok", fetchedAt: generatedAt },
      ],
      events: [...base.events, ...app.events],
      meals: [...base.meals, ...app.meals],
    };
  };

  return {
    editor,
    handle(request) {
      const { method, path } = request;
      if (path === "/api/config") {
        return { status: 200, json: demoEditorConfig() };
      }
      if (path === "/api/agenda") {
        return { status: 200, json: agenda(request.search) };
      }
      if (path === "/api/weather" && method === "GET") {
        return {
          status: 200,
          json: demoWeather(demoToday(now()), new Date(now()).toISOString()),
        };
      }
      if (path === "/api/parent/unlock" && method === "POST") {
        let pin: unknown;
        try {
          pin = (JSON.parse(request.body ?? "null") as { pin?: unknown } | null)
            ?.pin;
        } catch {
          return { status: 400, json: { error: "bad_request", message: "" } };
        }
        const locked = limiter.check();
        if (locked !== null) return locked;
        if (pin !== DEMO_PARENT_PIN) return limiter.fail();
        limiter.succeed();
        counter += 1;
        const token = `${SESSION_PREFIX}${String(counter)}`;
        const expiresAt = now() + SESSION_MS;
        sessions.set(token, expiresAt);
        return {
          status: 200,
          json: { token, expiresAt: new Date(expiresAt).toISOString() },
        };
      }
      if (path === "/api/parent/session" && method === "GET") {
        const until =
          request.session === null ? undefined : sessions.get(request.session);
        return until !== undefined && until > now()
          ? {
              status: 200,
              json: { expiresAt: new Date(until).toISOString() },
            }
          : { status: 403, json: { error: "parent_locked", message: "" } };
      }
      return editor.handle(request);
    },
  };
}
