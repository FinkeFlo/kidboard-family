import { reset } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  cacheBackend,
  getSourceEntry,
  kvBackend,
  putSourceEntry,
  SOURCE_ENTRY_VERSION,
  type SourceEntry,
  SourceStore,
  type StoreBackend,
} from "./sourceStore";

const NOW = Date.parse("2026-03-09T09:00:00Z");
const KEY = "v1/source/app-events/0123456789abcdef0123456789abcdef";

const ENTRY: SourceEntry = {
  v: SOURCE_ENTRY_VERSION,
  sourceId: "app-events",
  fetchedAt: new Date(NOW).toISOString(),
  window: { from: "2026-03-08", to: "2026-04-10" },
  truncated: false,
  stamp: "b0f3c9e2-4d61-4a8e-9a57-2f1d0c3b5e71",
  events: [],
  meals: [],
};

afterEach(async () => {
  await reset();
});

describe.each<[string, () => StoreBackend]>([
  ["kv", () => kvBackend(testEnv.KIDBOARD_CACHE)],
  ["cache", () => cacheBackend(() => caches.open("kidboard-store-test"))],
])("SourceStore with the %s backend", (_, makeBackend) => {
  it("keeps the change stamp of an entry", async () => {
    const backend = makeBackend();
    await putSourceEntry(new SourceStore(), backend, KEY, ENTRY);
    // A new store (new isolate) reads it back from the backend.
    expect(await getSourceEntry(new SourceStore(), backend, KEY, NOW)).toEqual(
      ENTRY,
    );
  });

  it("delete drops the entry from memory and from the backend", async () => {
    const backend = makeBackend();
    const store = new SourceStore();
    await putSourceEntry(store, backend, KEY, ENTRY);
    await store.delete(backend, KEY);
    expect(await getSourceEntry(store, backend, KEY, NOW)).toBeNull();
    expect(await backend.read(KEY)).toBeNull();
    // Deleting a missing key is fine.
    await expect(store.delete(backend, KEY)).resolves.toBeUndefined();
  });
});
