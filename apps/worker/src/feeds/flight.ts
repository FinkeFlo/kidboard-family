/** Rejection of {@link withDeadline}; `name` is what logs show. */
export class DeadlineError extends Error {
  override readonly name = "DeadlineError";
  constructor() {
    super("Deadline exceeded");
  }
}

/** `promise`, or a {@link DeadlineError} after `ms` (the timer is cleared). */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineError());
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Thrown by {@link SingleFlight.run} while a key is paused after a failed load. */
export class FlightPausedError extends Error {
  override readonly name = "FlightPausedError";
  constructor() {
    super("Upstream load paused after a failure");
  }
}

export interface SingleFlightOptions {
  /** Clock (epoch ms), read when a load fails. */
  now: () => number;
  /**
   * After a failed load the key is not loaded again for this long (per isolate, memory
   * only; a success clears it), so a broken upstream is not hit by every request.
   * Default: no pause.
   */
  pauseAfterFailureMs?: number | undefined;
  /** Which errors start the pause (default: all). */
  pauseOn?: ((error: unknown) => boolean) | undefined;
  /** Max keys remembered in the pause map (default 64). */
  memoryLimit?: number | undefined;
}

export interface FlightRequest<T> {
  /** Clock time the request started (for telling dead flights apart). */
  nowMs: number;
  /** Deadline of one load and of every waiter on it. */
  maxMs: number;
  load: () => Promise<T>;
  /** Keeps background work alive after the response (`waitUntil`). */
  defer: (work: Promise<unknown>) => void;
}

interface Flight<T> {
  promise: Promise<T>;
  startedAtMs: number;
}

/**
 * Upstream loads of one isolate by key: concurrent requests share one load (single
 * flight), every waiter gives up after `maxMs`, and a flight older than that is dead
 * (e.g. its request was cancelled before `waitUntil` took over) and replaced. The owner
 * keeps the load running past the response via `defer`. With `pauseAfterFailureMs` a
 * failed key is paused (then {@link FlightPausedError}) instead of retried per request.
 */
export class SingleFlight<T> {
  readonly #flights = new Map<string, Flight<T>>();
  readonly #pausedUntil = new Map<string, number>();
  readonly #options: SingleFlightOptions;

  constructor(options: SingleFlightOptions) {
    this.#options = options;
  }

  async run(key: string, request: FlightRequest<T>): Promise<T> {
    const pausedUntil = this.#pausedUntil.get(key);
    if (pausedUntil !== undefined) {
      if (request.nowMs < pausedUntil) {
        throw new FlightPausedError();
      }
      this.#pausedUntil.delete(key);
    }
    let flight = this.#flights.get(key);
    if (
      flight === undefined ||
      request.nowMs - flight.startedAtMs > request.maxMs
    ) {
      const own: Flight<T> = {
        promise: request.load(),
        startedAtMs: request.nowMs,
      };
      const cleanup = (): void => {
        if (this.#flights.get(key) === own) {
          this.#flights.delete(key);
        }
      };
      own.promise.then(cleanup, cleanup);
      this.#flights.set(key, own);
      // Bounded, so a load that never settles cannot pin the request context either.
      request.defer(
        withDeadline(own.promise, request.maxMs).then(
          () => undefined,
          () => undefined,
        ),
      );
      flight = own;
    }
    try {
      const result = await withDeadline(flight.promise, request.maxMs);
      this.#pausedUntil.delete(key);
      return result;
    } catch (error) {
      if (this.#options.pauseOn?.(error) !== false) {
        this.#pause(key);
      }
      throw error;
    }
  }

  #pause(key: string): void {
    const pauseMs = this.#options.pauseAfterFailureMs;
    if (pauseMs === undefined) {
      return;
    }
    const failedAtMs = this.#options.now();
    this.#pausedUntil.delete(key);
    for (const [other, until] of this.#pausedUntil) {
      if (
        until <= failedAtMs ||
        this.#pausedUntil.size >= (this.#options.memoryLimit ?? 64)
      ) {
        this.#pausedUntil.delete(other);
      }
    }
    this.#pausedUntil.set(key, failedAtMs + pauseMs);
  }
}
