import {
  AgendaResponseSchema,
  EditorListResponseSchema,
  PublicConfigSchema,
  WeatherResponseSchema,
} from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import { createDemoApi, DEMO_PARENT_PIN } from "./demoApi.ts";
import type { FakeRequest, FakeResponse } from "./fakeEditorApi.ts";

const NOW = Date.parse("2026-11-22T12:00:00+01:00");

function request(
  overrides: Partial<FakeRequest> & { path: string },
): FakeRequest {
  return { method: "GET", search: "", body: null, session: null, ...overrides };
}

function answer(response: FakeResponse | null): FakeResponse {
  if (response === null) throw new Error("not served");
  return response;
}

describe("demo API", () => {
  it("serves the demo config with the editor on", () => {
    const api = createDemoApi(() => NOW);
    const config = PublicConfigSchema.parse(
      answer(api.handle(request({ path: "/api/config" }))).json,
    );
    expect(config.editor).toBe(true);
    expect(config.weather).toBe(true);
  });

  it("serves a forecast from today (config zone) fetched now", () => {
    const api = createDemoApi(() => NOW);
    const response = answer(api.handle(request({ path: "/api/weather" })));
    expect(response.status).toBe(200);
    const weather = WeatherResponseSchema.parse(response.json);
    expect(Date.parse(weather.fetchedAt)).toBe(NOW);
    expect(weather.days[0]?.date).toBe("2026-11-22");
    expect(weather.days).toHaveLength(7);
    // Relative dates: a day later, the forecast starts a day later.
    const later = createDemoApi(() => NOW + 24 * 60 * 60_000);
    const next = WeatherResponseSchema.parse(
      answer(later.handle(request({ path: "/api/weather" }))).json,
    );
    expect(next.days[0]?.date).toBe("2026-11-23");
  });

  it("unlocks only with the demo PIN and then serves the editor", () => {
    let now = NOW;
    const api = createDemoApi(() => now);
    const wrong = answer(
      api.handle(
        request({
          method: "POST",
          path: "/api/parent/unlock",
          body: JSON.stringify({ pin: "000000" }),
        }),
      ),
    );
    expect(wrong.status).toBe(403);
    expect(wrong.json).toMatchObject({ error: "wrong_pin" });
    expect(
      answer(
        api.handle(
          request({ method: "POST", path: "/api/parent/unlock", body: "{" }),
        ),
      ).status,
    ).toBe(400);
    const ok = answer(
      api.handle(
        request({
          method: "POST",
          path: "/api/parent/unlock",
          body: JSON.stringify({ pin: DEMO_PARENT_PIN }),
        }),
      ),
    );
    const { token } = ok.json as { token: string };
    expect(
      answer(
        api.handle(request({ path: "/api/parent/session", session: token })),
      ).status,
    ).toBe(200);
    const list = answer(
      api.handle(
        request({
          path: "/api/parent/entries",
          search: "from=2026-11-22&days=14",
          session: token,
        }),
      ),
    );
    expect(
      EditorListResponseSchema.parse(list.json).items.length,
    ).toBeGreaterThan(0);
    // The demo's Google entries are read-only list items.
    expect(
      EditorListResponseSchema.parse(list.json).items.every(
        (item) => item.origin === "google",
      ),
    ).toBe(true);
    // After 15 minutes the session is over.
    now += 15 * 60_000 + 1;
    expect(
      answer(
        api.handle(request({ path: "/api/parent/session", session: token })),
      ).status,
    ).toBe(403);
    expect(
      answer(
        api.handle(
          request({
            path: "/api/parent/entries",
            search: "from=2026-11-22&days=14",
            session: token,
          }),
        ),
      ).status,
    ).toBe(403);
  });

  it("shows app entries on the board agenda", () => {
    const api = createDemoApi(() => NOW);
    api.editor.seed({
      kind: "event",
      icon: "🦖",
      title: "Dino museum",
      allDay: true,
      date: "2026-11-23",
    });
    const agenda = AgendaResponseSchema.parse(
      answer(api.handle(request({ path: "/api/agenda" }))).json,
    );
    expect(agenda.events.filter((e) => e.title === "Dino museum")).toEqual([
      expect.objectContaining({ sourceId: "app-events", start: "2026-11-23" }),
    ]);
    expect(agenda.sources.map((s) => s.id)).toEqual(
      expect.arrayContaining(["app-events", "app-meals"]),
    );
  });

  describe("unlock limiter (worker behaviour, ADR-0013)", () => {
    const unlock = (
      api: ReturnType<typeof createDemoApi>,
      pin: string,
    ): FakeResponse =>
      answer(
        api.handle(
          request({
            method: "POST",
            path: "/api/parent/unlock",
            body: JSON.stringify({ pin }),
          }),
        ),
      );

    it("counts the tries down and locks after the 5th wrong PIN for 15 minutes", () => {
      let now = NOW;
      const api = createDemoApi(() => now);
      const left: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        const wrong = unlock(api, "000000");
        expect(wrong.status).toBe(403);
        left.push((wrong.json as { attemptsLeft: number }).attemptsLeft);
        now += 60_000;
      }
      expect(left).toEqual([4, 3, 2, 1]);
      const fifth = unlock(api, "000000");
      expect(fifth.status).toBe(429);
      expect(fifth.headers).toEqual({ "Retry-After": "900" });
      expect(fifth.json).toMatchObject({
        error: "parent_lockout",
        retryAfterSeconds: 900,
      });

      // Even the right PIN waits; Retry-After counts down.
      now += 5 * 60_000;
      const locked = unlock(api, DEMO_PARENT_PIN);
      expect(locked.status).toBe(429);
      expect(locked.headers).toEqual({ "Retry-After": "600" });

      // After the lockout: a fresh count, and the right PIN opens.
      now += 10 * 60_000;
      expect(
        (unlock(api, "000000").json as { attemptsLeft: number }).attemptsLeft,
      ).toBe(4);
      expect(unlock(api, DEMO_PARENT_PIN).status).toBe(200);
    });

    it("forgets wrong PINs older than 15 minutes and clears them on the right PIN", () => {
      let now = NOW;
      const api = createDemoApi(() => now);
      unlock(api, "000000");
      now += 16 * 60_000;
      expect(
        (unlock(api, "000000").json as { attemptsLeft: number }).attemptsLeft,
      ).toBe(4);
      unlock(api, "000000");
      expect(unlock(api, DEMO_PARENT_PIN).status).toBe(200);
      expect(
        (unlock(api, "000000").json as { attemptsLeft: number }).attemptsLeft,
      ).toBe(4);
    });
  });

  it("does not serve unknown paths", () => {
    const api = createDemoApi(() => NOW);
    expect(api.handle(request({ path: "/api/other" }))).toBeNull();
  });
});
