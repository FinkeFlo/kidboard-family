import { expect, type Page, test } from "@playwright/test";

import {
  ACCESS_TOKEN_KEY,
  agenda,
  at,
  mockBoard,
  NOW,
  persistedTitles,
  setNow,
  waitForServiceWorker,
} from "./mockApi";

/*
 * Offline & stale UX end-to-end (T-23, ADR-0006). The board keeps the last known state
 * and only a discreet banner in the bottom strip says why it may be out of date; without
 * any data it shows the calm error state.
 */

/** Low-entropy synthetic token (gitleaks-friendly). */
const TOKEN = "TESTONLY-not-a-secret";

/** Today (Sunday) and tomorrow (Monday) have their own events. */
const AGENDA = agenda(
  [
    { title: "Swimming", icon: "🏊", time: "15:00" },
    { title: "Football", icon: "⚽", time: "10:00", day: 1 },
    { title: "Zoo trip", icon: "🦁", time: null, day: 1 },
  ],
  [{ slot: "dinner", title: "Vegetable soup", icon: "🍲" }],
);

/**
 * Later than `staleTime` (15 min, ADR-0006): restored or cached data counts as outdated,
 * so a reload or reconnect refetches it at once.
 */
const AFTER_STALE_TIME = Date.parse(NOW) + 20 * 60_000;
/** Status banner in the bottom strip (`data-status` = connection status). */
const banner = (page: Page) => page.locator("p[data-status]");
const event = (page: Page, title: string) =>
  page.getByRole("article", { name: title });

/** Waits until the persister has written the agenda (it saves throttled). */
async function expectPersisted(page: Page, title: string): Promise<void> {
  await expect.poll(() => persistedTitles(page)).toContain(title);
}

test.describe("with the service worker", () => {
  // The reloads below run without network: only the precached shell can answer them.
  test.use({ serviceWorkers: "allow" });

  test("load online, go offline, reload: last state with the offline hint", async ({
    page,
    context,
  }) => {
    const api = await mockBoard(page, { agenda: AGENDA, via: "context" });
    await page.goto("/");
    await expect(event(page, "Swimming")).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await waitForServiceWorker(page);
    await expectPersisted(page, "Swimming");

    await context.setOffline(true);
    const requestsBefore = api.requests.length;
    await page.reload();

    await expect(
      page.getByRole("heading", { level: 1, name: "Sunday" }),
    ).toBeVisible();
    await expect(event(page, "Swimming")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Dinner: Vegetable soup" }),
    ).toBeVisible();
    await expect(banner(page)).toHaveAttribute("data-status", "offline");
    // The pill says how old the shown plan is (fetched at the fixed 12:00 clock).
    await expect(banner(page)).toHaveText(/^Offline · as of 12:\d{2}\sPM$/u);
    await expect(page.locator("[data-error]")).toHaveCount(0);
    // Nothing reached the (mocked) network while offline.
    expect(api.requests.slice(requestsBefore)).toEqual([]);
  });

  test("offline across midnight keeps showing data, also after a reload", async ({
    page,
    context,
  }) => {
    await mockBoard(page, { agenda: AGENDA, via: "context" });
    await page.goto("/");
    await expect(event(page, "Swimming")).toBeVisible();
    await waitForServiceWorker(page);
    await expectPersisted(page, "Swimming");
    await context.setOffline(true);
    await expect(banner(page)).toHaveAttribute("data-status", "offline");

    // 00:00:30 on Monday in Berlin is still Sunday 15:00 on the device (Los Angeles).
    await setNow(page, at("00:00:30", 1));
    await expect(
      page.getByRole("heading", { level: 1, name: "Monday" }),
    ).toBeVisible();
    await expect(event(page, "Football")).toBeVisible();
    await expect(event(page, "Zoo trip")).toBeVisible();
    await expect(event(page, "Swimming")).toHaveCount(0);
    await expect(banner(page)).toHaveAttribute("data-status", "offline");

    // A reload on the new day (clock stays jumped) is seeded from the restored agenda.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Monday" }),
    ).toBeVisible();
    await expect(event(page, "Football")).toBeVisible();
    await expect(banner(page)).toHaveAttribute("data-status", "offline");
    await expect(page.locator("[data-error]")).toHaveCount(0);
  });
});

test("API reports stale: true: stale hint only after the 5 s delay", async ({
  page,
}) => {
  // Record when the first event tile and the banner appear, in page time.
  await page.addInitScript(() => {
    const marks: Record<string, number> = {};
    (window as unknown as { __marks: Record<string, number> }).__marks = marks;
    new MutationObserver(() => {
      if (
        marks["data"] === undefined &&
        document.querySelector("[data-testid=event-tile]")
      ) {
        marks["data"] = performance.now();
      }
      if (
        marks["banner"] === undefined &&
        document.querySelector("p[data-status]")
      ) {
        marks["banner"] = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await mockBoard(page, {
    agenda: { ...(AGENDA as Record<string, unknown>), stale: true },
  });
  await page.goto("/");
  await expect(event(page, "Swimming")).toBeVisible();
  await expect(banner(page)).toHaveAttribute("data-status", "stale", {
    timeout: 10_000,
  });
  await expect(banner(page)).toHaveText(
    /^Maybe not current · as of \d{1,2}:\d{2}\s(AM|PM)$/u,
  );
  const marks = await page.evaluate(
    () => (window as unknown as { __marks: Record<string, number> }).__marks,
  );
  const shownAfter = (marks["banner"] ?? 0) - (marks["data"] ?? Infinity);
  expect(shownAfter).toBeGreaterThanOrEqual(4_900);
  expect(shownAfter).toBeLessThan(7_000);
  await expect(event(page, "Swimming")).toBeVisible();
});

test("API 502 with persisted data: the data stays, with the stale hint", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const api = await mockBoard(page, { agenda: AGENDA });
  await page.goto("/");
  await expect(event(page, "Swimming")).toBeVisible();
  await expectPersisted(page, "Swimming");

  // Twenty minutes later every source fails (worker: 502, no events in the body).
  api.agendaStatus = 502;
  api.agenda = { error: "upstream_failed" };
  await setNow(page, new Date(AFTER_STALE_TIME).toISOString(), {
    wake: false,
  });
  const agendaRequests = (): number =>
    api.requests.filter((path) => path === "/api/agenda").length;
  const before = agendaRequests();
  await page.reload();

  await expect(event(page, "Swimming")).toBeVisible();
  // Retried twice (transient), then the failure shows after the stale delay.
  await expect(banner(page)).toHaveAttribute("data-status", "stale", {
    timeout: 20_000,
  });
  expect(agendaRequests() - before).toBe(3);
  await expect(event(page, "Swimming")).toBeVisible();
  await expect(page.locator("[data-error]")).toHaveCount(0);
  // The failure never replaces the persisted last-good agenda.
  expect(await persistedTitles(page)).toContain("Swimming");
});

test("reload while the API is unreachable, soon after a load: last good time and the can't-update pill", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const api = await mockBoard(page, { agenda: AGENDA });
  await page.goto("/");
  await expect(event(page, "Swimming")).toBeVisible();
  await expectPersisted(page, "Swimming");
  const updated = page.getByTestId("updated-at");
  await expect(updated).toHaveText(/^Updated 12:00\sPM$/u);

  // Five minutes later (younger than staleTime) the API can no longer be reached; the
  // browser itself stays online, so only the failed fetch can tell.
  await page.unroute("**/api/**");
  const aborted: string[] = [];
  await page.route("**/api/**", (route) => {
    aborted.push(new URL(route.request().url()).pathname);
    return route.abort("internetdisconnected");
  });
  await setNow(page, at("12:05"), { wake: false });
  const before = api.requests.length;
  await page.reload();

  // The page load asks the API anyway (restored data is refetched once).
  await expect.poll(() => aborted.length).toBeGreaterThan(0);
  await expect(event(page, "Swimming")).toBeVisible();
  // After the retries and the 5 s stale delay: the plain "can't update" pill with the time
  // of the last successful fetch, not of the reload.
  await expect(banner(page)).toHaveAttribute("data-status", "stale", {
    timeout: 20_000,
  });
  await expect(banner(page)).toHaveText(/^Can't update · as of 12:00\sPM$/u);
  await expect(updated).toHaveText(/^Updated 12:00\sPM$/u);
  await expect(page.locator("[data-error]")).toHaveCount(0);
  expect(api.requests.length).toBe(before);
  // The failure never replaces the persisted last-good agenda.
  expect(await persistedTitles(page)).toContain("Swimming");
});

test("API 502 without any data: the calm error state", async ({ page }) => {
  await mockBoard(page, {
    agendaStatus: 502,
    agenda: { error: "upstream_failed" },
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  // After the two retries (backoff 1 s + 2 s).
  await expect(alert).toHaveAttribute("data-error", "failed", {
    timeout: 15_000,
  });
  await expect(alert).toContainText("The calendar can't be reached right now");
  await expect(page.getByTestId("error-code")).toHaveText(
    "Error code for parents: KB-502",
  );
  await expect(page.getByTestId("event-tile")).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
});

test("back online: the hint disappears once the refetch has landed", async ({
  page,
  context,
}) => {
  const api = await mockBoard(page, { agenda: AGENDA });
  await page.goto("/");
  await expect(event(page, "Swimming")).toBeVisible();
  await context.setOffline(true);
  await expect(banner(page)).toHaveAttribute("data-status", "offline");

  // While offline the plan changed and the shown data became outdated.
  api.agenda = agenda(
    [
      { title: "Swimming", icon: "🏊", time: "15:00" },
      { title: "Library", icon: "📚", time: "16:00" },
    ],
    [],
  );
  await setNow(page, new Date(AFTER_STALE_TIME).toISOString());
  await expect(banner(page)).toHaveAttribute("data-status", "offline");
  const before = api.requests.length;

  await context.setOffline(false);
  await expect(event(page, "Library")).toBeVisible();
  expect(api.requests.slice(before)).toContain("/api/agenda");
  await expect(banner(page)).toHaveCount(0);
  await expect(event(page, "Swimming")).toBeVisible();
});

test("401 with persisted data wipes the data, the storage and the token", async ({
  page,
}) => {
  const api = await mockBoard(page, { agenda: AGENDA });
  await page.goto(`/?key=${TOKEN}`);
  await expect(event(page, "Swimming")).toBeVisible();
  await expectPersisted(page, "Swimming");
  const storedToken = (): Promise<string | null> =>
    page.evaluate(
      (key: string) => window.localStorage.getItem(key),
      ACCESS_TOKEN_KEY,
    );
  expect(await storedToken()).toBe(TOKEN);

  // The token was revoked. Twenty minutes later the restored data is outdated, so the
  // reload refetches it.
  api.config = { error: "unauthorized" };
  api.configStatus = 401;
  api.agenda = { error: "unauthorized" };
  api.agendaStatus = 401;
  await setNow(page, new Date(AFTER_STALE_TIME).toISOString(), {
    wake: false,
  });
  await page.reload();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveAttribute("data-error", "unauthorized");
  await expect(alert).toContainText("needs a new access link");
  await expect(page.getByTestId("event-tile")).toHaveCount(0);
  await expect.poll(() => persistedTitles(page)).toEqual([]);
  expect(await storedToken()).toBeNull();

  // Nothing comes back from storage on the next start either.
  await page.reload();
  await expect(page.getByRole("alert")).toHaveAttribute(
    "data-error",
    "unauthorized",
  );
  await expect(page.getByTestId("event-tile")).toHaveCount(0);
});
