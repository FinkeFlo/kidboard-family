import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerServiceWorker,
  UPDATE_CHECK_INTERVAL_MS,
} from "./registerServiceWorker";

interface FakeRegistration {
  installing: object | null;
  update: ReturnType<typeof vi.fn>;
}

function setup(
  overrides: {
    online?: boolean;
    status?: number;
    fetchError?: Error;
    registration?: FakeRegistration | undefined;
  } = {},
) {
  let captured: RegisterSWOptions | undefined;
  const registerSW = vi.fn((options: RegisterSWOptions) => {
    captured = options;
  });
  const fetchMock = vi.fn((): Promise<Response> => {
    if (overrides.fetchError) {
      return Promise.reject(overrides.fetchError);
    }
    return Promise.resolve(
      new Response(null, { status: overrides.status ?? 200 }),
    );
  });
  const onError = vi.fn();
  let online = overrides.online ?? true;
  const registration: FakeRegistration | undefined =
    "registration" in overrides
      ? overrides.registration
      : { installing: null, update: vi.fn(() => Promise.resolve()) };

  registerServiceWorker({
    registerSW,
    fetch: fetchMock,
    isOnline: () => online,
    onError,
  });

  const registered = (): void => {
    captured?.onRegisteredSW?.(
      "/sw.js",
      registration as unknown as ServiceWorkerRegistration | undefined,
    );
  };
  return {
    registerSW,
    fetchMock,
    onError,
    registration,
    registered,
    options: () => captured,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

describe("registerServiceWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers immediately", () => {
    const { registerSW, options } = setup();
    expect(registerSW).toHaveBeenCalledTimes(1);
    expect(options()?.immediate).toBe(true);
  });

  it("checks for an update every hour, probing sw.js without the HTTP cache", async () => {
    const { registered, fetchMock, registration } = setup();
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/sw.js",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(registration?.update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration?.update).toHaveBeenCalledTimes(2);
  });

  it("skips the check while offline and resumes once online", async () => {
    const { registered, fetchMock, registration, setOnline } = setup({
      online: false,
    });
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registration?.update).not.toHaveBeenCalled();

    setOnline(true);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration?.update).toHaveBeenCalledTimes(1);
  });

  it("skips the check while a new worker is installing", async () => {
    const registration: FakeRegistration = {
      installing: {},
      update: vi.fn(() => Promise.resolve()),
    };
    const { registered, fetchMock } = setup({ registration });
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("does not update when sw.js is not reachable (non-200)", async () => {
    const { registered, registration, onError } = setup({ status: 503 });
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration?.update).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failing probe instead of throwing and keeps polling", async () => {
    const error = new Error("network down");
    const { registered, registration, onError, fetchMock } = setup({
      fetchError: error,
    });
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(onError).toHaveBeenCalledWith(error);
    expect(registration?.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the registration is unavailable", async () => {
    const { registered, fetchMock } = setup({ registration: undefined });
    registered();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
