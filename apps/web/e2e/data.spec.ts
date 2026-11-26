import { expect, test } from "@playwright/test";

import { agenda, fixClock } from "./mockApi";

/** Low-entropy synthetic token (gitleaks-friendly). */
const TOKEN = "TESTONLY-not-a-secret";

const CONFIG = {
  locale: "de",
  timeZone: "Europe/Berlin",
  calendars: [{ id: "family", kind: "events" }],
};

test("takes the token from ?key= once, sends it as Bearer and applies the config locale", async ({
  page,
}) => {
  const authHeaders: (string | undefined)[] = [];
  const requestUrls: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    requestUrls.push(request.url());
    authHeaders.push(request.headers()["authorization"]);
    const path = new URL(request.url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: CONFIG });
    if (path === "/api/agenda") return route.fulfill({ json: agenda([], []) });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });

  // The fixture day, not the real date (the empty-day text is today's).
  await fixClock(page);
  await page.goto(`/?key=${TOKEN}`);

  // Config locale "de" wins over the browser language.
  await expect(page.getByText("Heute ist nichts geplant")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(new URL(page.url()).search).toBe("");
  expect(authHeaders[0]).toBe(`Bearer ${TOKEN}`);
  expect(requestUrls.every((url) => !url.includes(TOKEN))).toBe(true);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("kidboard.accessToken"),
    ),
  ).toBe(TOKEN);

  // After a reload without ?key= the stored token is used. Drop the persisted query
  // cache first, else the fresh restored config would not be refetched.
  await page.addInitScript(() => {
    window.localStorage.removeItem("kidboard.queryCache");
  });
  authHeaders.length = 0;
  const configRequest = page.waitForRequest("**/api/config");
  await page.goto("/");
  await configRequest;
  await expect(page.getByText("Heute ist nichts geplant")).toBeVisible();
  expect(authHeaders[0]).toBe(`Bearer ${TOKEN}`);
});
