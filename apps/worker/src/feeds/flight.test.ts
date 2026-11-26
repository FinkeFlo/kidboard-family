import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeadlineError,
  FlightPausedError,
  SingleFlight,
  withDeadline,
} from "./flight";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withDeadline", () => {
  it("passes a result through and clears its timer", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a DeadlineError when the promise does not settle in time", async () => {
    const result = withDeadline(new Promise<never>(() => undefined), 1000);
    const assertion = expect(result).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("passes a rejection through", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SingleFlight", () => {
  const defer = (): void => undefined;

  function flights(extra: { pauseAfterFailureMs?: number } = {}): {
    flights: SingleFlight<string>;
    clock: { now: number };
  } {
    const clock = { now: 10_000 };
    return {
      clock,
      flights: new SingleFlight<string>({ now: () => clock.now, ...extra }),
    };
  }

  it("shares one load between concurrent requests", async () => {
    const { flights: group, clock } = flights();
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const first = group.run("k", {
      nowMs: clock.now,
      maxMs: 5000,
      load,
      defer,
    });
    const second = group.run("k", {
      nowMs: clock.now,
      maxMs: 5000,
      load,
      defer,
    });
    gate.resolve("data");
    expect(await first).toBe("data");
    expect(await second).toBe("data");
    expect(load).toHaveBeenCalledTimes(1);
    // Settled: the next request loads again.
    await group.run("k", { nowMs: clock.now, maxMs: 5000, load, defer });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps different keys apart", async () => {
    const { flights: group, clock } = flights();
    const load = vi.fn(() => Promise.resolve("x"));
    await Promise.all([
      group.run("a", { nowMs: clock.now, maxMs: 5000, load, defer }),
      group.run("b", { nowMs: clock.now, maxMs: 5000, load, defer }),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds every waiter and replaces a flight that is older than the deadline", async () => {
    const { flights: group, clock } = flights();
    const hanging = vi.fn(() => new Promise<string>(() => undefined));
    const stuck = group.run("k", {
      nowMs: clock.now,
      maxMs: 5000,
      load: hanging,
      defer,
    });
    const assertion = expect(stuck).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    clock.now += 5001;
    const fresh = vi.fn(() => Promise.resolve("again"));
    expect(
      await group.run("k", {
        nowMs: clock.now,
        maxMs: 5000,
        load: fresh,
        defer,
      }),
    ).toBe("again");
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it("hands the bounded owner work to defer so the load outlives the response", async () => {
    const { flights: group, clock } = flights();
    const deferred: Promise<unknown>[] = [];
    await group.run("k", {
      nowMs: clock.now,
      maxMs: 5000,
      load: () => Promise.resolve("x"),
      defer: (work) => {
        deferred.push(work);
      },
    });
    expect(deferred).toHaveLength(1);
    await expect(deferred[0]).resolves.toBeUndefined();
  });

  it("does not remember a failed flight and without a pause retries at once", async () => {
    const { flights: group, clock } = flights();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("up");
    const request = { nowMs: clock.now, maxMs: 5000, load, defer };
    await expect(group.run("k", request)).rejects.toThrow("down");
    expect(await group.run("k", request)).toBe("up");
  });

  describe("with a pause after failures", () => {
    it("refuses to load for the pause, then tries again, and a success clears it", async () => {
      const { flights: group, clock } = flights({
        pauseAfterFailureMs: 300_000,
      });
      const load = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue("up");
      const at = (nowMs: number) => ({ nowMs, maxMs: 5000, load, defer });
      await expect(group.run("k", at(clock.now))).rejects.toThrow("down");

      clock.now += 299_000;
      await expect(group.run("k", at(clock.now))).rejects.toBeInstanceOf(
        FlightPausedError,
      );
      expect(load).toHaveBeenCalledTimes(1);

      // Another key is not paused.
      expect(await group.run("other", at(clock.now))).toBe("up");

      clock.now += 1_000;
      expect(await group.run("k", at(clock.now))).toBe("up");
      expect(await group.run("k", at(clock.now))).toBe("up");
    });

    it("pauses again when the retry fails too", async () => {
      const { flights: group, clock } = flights({ pauseAfterFailureMs: 1000 });
      const load = vi.fn(() => Promise.reject<string>(new Error("down")));
      const at = (nowMs: number) => ({ nowMs, maxMs: 5000, load, defer });
      await expect(group.run("k", at(clock.now))).rejects.toThrow("down");
      clock.now += 1000;
      await expect(group.run("k", at(clock.now))).rejects.toThrow("down");
      await expect(group.run("k", at(clock.now))).rejects.toBeInstanceOf(
        FlightPausedError,
      );
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("pauses on a timeout, too", async () => {
      const { flights: group, clock } = flights({ pauseAfterFailureMs: 1000 });
      const load = vi.fn(() => new Promise<string>(() => undefined));
      const first = group.run("k", {
        nowMs: clock.now,
        maxMs: 500,
        load,
        defer,
      });
      const assertion = expect(first).rejects.toBeInstanceOf(DeadlineError);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      await expect(
        group.run("k", { nowMs: clock.now, maxMs: 500, load, defer }),
      ).rejects.toBeInstanceOf(FlightPausedError);
    });

    it("only pauses on the errors pauseOn accepts", async () => {
      const clock = { now: 10_000 };
      const group = new SingleFlight<string>({
        now: () => clock.now,
        pauseAfterFailureMs: 1000,
        pauseOn: (error) => !(error instanceof RangeError),
      });
      const load = vi.fn(() => Promise.reject<string>(new RangeError("no")));
      const request = { nowMs: clock.now, maxMs: 5000, load, defer };
      await expect(group.run("k", request)).rejects.toBeInstanceOf(RangeError);
      await expect(group.run("k", request)).rejects.toBeInstanceOf(RangeError);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});
