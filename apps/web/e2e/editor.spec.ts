import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";

import {
  agenda,
  config,
  dateOf,
  MOCK_FEED_URL,
  MOCK_PARENT_PIN,
  type MockApi,
  mockBoard,
} from "./mockApi";

/*
 * The parent editor (T-45) against the mock API (`demo/fakeEditorApi.ts` behind the
 * mocked parent lock): the main flows at both tablet sizes. Clock: Sunday 2026-11-22
 * 12:00 Berlin (`NOW`).
 */

/** Low-entropy synthetic access token (gitleaks-friendly). */
const TOKEN = "TESTONLY-not-a-secret";
const HOLD_MS = 2000;

const GOOGLE_EVENTS = [
  { title: "Piano", icon: "🎹", time: "16:30", childIds: ["ben"], day: 1 },
];

async function openEditor(
  page: Page,
  options: { seed?: (api: MockApi) => void } = {},
): Promise<MockApi> {
  const api = await mockBoard(page, {
    config: config({
      locale: "en",
      editor: true,
      calendars: [
        { id: "family", kind: "events" },
        { id: "meals", kind: "meals" },
      ],
    }),
    agenda: agenda(GOOGLE_EVENTS, [
      { slot: "dinner", title: "Soup", icon: "🍲", day: 1 },
    ]),
  });
  options.seed?.(api);
  await page.goto(`/?key=${TOKEN}`);
  await expect(page.getByTestId("board-ready")).toBeVisible();
  const entry = page.getByRole("button", { name: /parent area/i });
  const box = await entry.boundingBox();
  if (box === null) throw new Error("entry has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const pad = page.getByRole("dialog", { name: "Parent area" });
  await expect(pad).toBeVisible({ timeout: HOLD_MS + 2000 });
  await page.mouse.up();
  for (const digit of MOCK_PARENT_PIN) {
    await pad.getByRole("button", { name: digit, exact: true }).click();
  }
  await pad.getByRole("button", { name: "OK" }).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.getByTestId("entry-list")).toBeVisible();
  return api;
}

/**
 * Choices are native radios/checkboxes inside chip labels: tap the chip (the label),
 * as a parent would; Playwright then checks that the input is checked.
 */
const CHIP = { force: true } as const;

function editor(page: Page): Locator {
  return page.getByRole("dialog", { name: "Editor" });
}

function day(page: Page, offset: number): Locator {
  return page.locator(
    `[data-testid="editor-day"][data-date="${dateOf(offset)}"]`,
  );
}

async function expectNoOverflow(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport");
  const scroll = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  expect(scroll.w).toBeLessThanOrEqual(viewport.width);
  expect(scroll.h).toBeLessThanOrEqual(viewport.height);
}

/** Every visible button, radio/checkbox chip and field is at least 48 px high. */
async function expectTouchTargets(scope: Locator): Promise<void> {
  const small = await scope
    .locator(
      "button:visible, label:has(> input.sr-only):visible, input:not(.sr-only):visible",
    )
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { text: element.textContent, h: box.height };
        })
        .filter((box) => box.h < 47.5),
    );
  expect(small).toEqual([]);
}

test.describe("parent editor (T-45)", () => {
  test("a weekly swimming lesson for Mia from the quick pick shows on the board", async ({
    page,
  }) => {
    const api = await openEditor(page);
    await expectNoOverflow(page);
    await expectTouchTargets(editor(page));

    await page.getByTestId("quick-swimmingWeekly").click();
    const form = page.getByTestId("event-form");
    await expect(form.getByLabel("Name on the tile")).toHaveValue("Swimming");
    await form.getByRole("checkbox", { name: "Mia" }).check(CHIP);
    // Weekly on today's weekday (Sunday), preset by the date.
    await expect(form.getByRole("checkbox", { name: "Sunday" })).toBeChecked();
    await expect(page.getByTestId("entry-preview")).toContainText("Swimming");
    await expectTouchTargets(form);
    await expectNoOverflow(page);
    await page.getByTestId("editor-save").click();

    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    await expect(page.getByTestId("editor-home")).toBeVisible();
    const swim = day(page, 0).getByTestId("editor-item").filter({
      hasText: "Swimming",
    });
    await expect(swim).toBeVisible();
    await expect(swim.getByTestId("series-mark")).toContainText("Every week");
    await expect(
      day(page, 7).getByTestId("editor-item").filter({ hasText: "Swimming" }),
    ).toBeVisible();

    const [created] = api.editor.entries();
    expect(created?.data).toMatchObject({
      kind: "event",
      childIds: ["mia"],
      icon: "🏊",
      title: "Swimming",
      startTime: "15:00",
      endTime: "16:00",
      repeat: { weekly: { weekdays: [7], interval: 1 } },
    });

    // The board refetched the agenda: the new tile is there after "Done".
    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(
      page.getByTestId("event-tile").filter({ hasText: "Swimming" }).first(),
    ).toBeVisible();
  });

  test("a single appointment from the catalogue, tomorrow at a chosen time", async ({
    page,
  }) => {
    const api = await openEditor(page);
    await page.getByTestId("new-entry").click();
    const form = page.getByTestId("event-form");
    await form.getByRole("radio", { name: "Appointments" }).check(CHIP);
    await form.getByRole("radio", { name: "Dentist" }).check(CHIP);
    await form.getByRole("radio", { name: "Tomorrow" }).check(CHIP);
    await form.getByLabel("Starts at").fill("09:30");
    await form.getByRole("radio", { name: "30 min" }).check(CHIP);
    await form.getByRole("checkbox", { name: "Ben" }).check(CHIP);
    await form.getByRole("checkbox", { name: "Snack" }).check(CHIP);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    await expect(
      day(page, 1).getByTestId("editor-item").filter({ hasText: "Dentist" }),
    ).toBeVisible();
    expect(api.editor.entries()[0]?.data).toMatchObject({
      date: dateOf(1),
      startTime: "09:30",
      endTime: "10:00",
      childIds: ["ben"],
      bring: ["🥪"],
      repeat: "none",
    });
  });

  test("edit one day of a series, then delete the whole series", async ({
    page,
  }) => {
    const api = await openEditor(page, {
      seed: (mock) => {
        mock.editor.seed({
          kind: "event",
          childIds: ["mia"],
          icon: "⚽",
          title: "Football",
          allDay: false,
          date: dateOf(0),
          startTime: "10:00",
          repeat: { weekly: { weekdays: [7], interval: 1 } },
        });
      },
    });
    const next = day(page, 7).getByTestId("editor-item").filter({
      hasText: "Football",
    });
    await next.getByRole("button", { name: "Change Football" }).click();
    const form = page.getByTestId("event-form");
    await form.getByLabel("Name on the tile").fill("Football match");
    await page.getByTestId("editor-save").click();
    const choice = page.getByRole("alertdialog");
    await expect(choice).toContainText("Change “Football match”");
    await choice.getByRole("button", { name: /^Only on/ }).click();
    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    const patch = api.editor.writes.at(-1);
    expect(patch?.method).toBe("PATCH");
    expect(patch?.query).toContain("scope=one");
    expect(patch?.query).toContain(`date=${dateOf(7)}`);
    await expect(
      day(page, 7)
        .getByTestId("editor-item")
        .filter({ hasText: "Football match" }),
    ).toBeVisible();
    await expect(
      day(page, 0).getByTestId("editor-item").filter({ hasText: "Football" }),
    ).toBeVisible();

    await day(page, 0).getByRole("button", { name: "Change Football" }).click();
    await page.getByTestId("editor-delete").click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete “Football”?");
    await confirm.getByRole("button", { name: "Delete whole series" }).click();
    await expect(page.getByTestId("editor-toast")).toContainText("Deleted");
    expect(api.editor.entries()).toHaveLength(0);
    await expect(page.getByTestId("entry-list")).not.toContainText("Football");
  });

  test("a meal from the dish catalogue and last week's meals repeated", async ({
    page,
  }) => {
    const api = await openEditor(page, {
      seed: (mock) => {
        mock.editor.seed({
          kind: "meal",
          icon: "🥞",
          title: "Pancakes",
          allDay: true,
          date: dateOf(-3),
          slot: "breakfast",
        });
      },
    });
    await page.getByTestId("new-meal").click();
    const form = page.getByTestId("meal-form");
    await form.getByRole("radio", { name: "Tomorrow" }).check(CHIP);
    await form.getByRole("radio", { name: "Lunch" }).check(CHIP);
    await form.getByRole("radio", { name: "Pizza" }).check(CHIP);
    await expect(page.getByTestId("meal-preview")).toContainText("Pizza");
    await expectTouchTargets(form);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    await expect(
      day(page, 1).getByTestId("editor-item").filter({ hasText: "Pizza" }),
    ).toBeVisible();

    await page.getByTestId("new-meal").click();
    await page.getByTestId("copy-meals-start").click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Copy 1 meal?");
    await confirm.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByTestId("editor-toast")).toContainText(
      "1 meal copied",
    );
    const copied = api.editor
      .entries()
      .find((entry) => entry.data.date === dateOf(4));
    expect(copied?.data).toMatchObject({
      title: "Pancakes",
      slot: "breakfast",
    });
  });

  test("many suggestions stay one sideways row; today's entries are in view", async ({
    page,
  }) => {
    const activities = [
      ["⚽", "Football"],
      ["🤸", "Gymnastics"],
      ["🩰", "Ballet"],
      ["🐴", "Riding"],
      ["🎾", "Tennis"],
      ["🥋", "Judo"],
      ["🎨", "Painting"],
      ["🎻", "Violin"],
    ] as const;
    await openEditor(page, {
      seed: (api) => {
        activities.forEach(([icon, title], index) => {
          api.editor.seed({
            kind: "event",
            icon,
            title,
            allDay: false,
            date: dateOf(0),
            startTime: `${String(13 + Math.floor(index / 2))}:${index % 2 === 0 ? "00" : "30"}`,
            endTime: `${String(14 + Math.floor(index / 2))}:00`,
          });
        });
      },
    });
    const row = page.getByTestId("templates-list");
    // The seeded activities plus the Google piano lesson (the Google soup is a meal:
    // the row starts events only).
    await expect(row.getByTestId("template")).toHaveCount(
      activities.length + 1,
    );
    const sizes = await row.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      height: element.getBoundingClientRect().height,
    }));
    // One row (a card plus padding), scrolling sideways instead of wrapping.
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(sizes.height).toBeLessThan(140);
    await expect(
      day(page, 0).getByTestId("editor-item").first(),
    ).toBeInViewport();
    await expectNoOverflow(page);
  });

  test("Google entries are read-only and work as a template", async ({
    page,
  }) => {
    await openEditor(page);
    const piano = day(page, 1).getByTestId("editor-item").filter({
      hasText: "Piano",
    });
    await expect(piano).toHaveAttribute("data-origin", "google");
    await expect(piano).toContainText("From Google Calendar – change it there");
    await expect(piano.getByRole("button", { name: /^Change/ })).toHaveCount(0);
    await piano.getByRole("button", { name: "Use Piano as template" }).click();
    const form = page.getByTestId("event-form");
    await expect(form.getByLabel("Name on the tile")).toHaveValue("Piano");
    await expect(form.getByRole("checkbox", { name: "Ben" })).toBeChecked();
    await expect(form.getByLabel("Starts at")).toHaveValue("16:30");
  });

  test("a conflict and a lost connection keep the form", async ({ page }) => {
    const api = await openEditor(page);
    await page.getByTestId("quick-dentist").click();
    const form = page.getByTestId("event-form");
    await form.getByLabel("Name on the tile").fill("Dentist check-up");

    await page.route("**/api/parent/entries", (route) => route.abort(), {
      times: 1,
    });
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-failure")).toContainText(
      "No connection",
    );
    await expect(page.getByTestId("editor-failure")).toContainText("KB-NET");
    await expect(form.getByLabel("Name on the tile")).toHaveValue(
      "Dentist check-up",
    );

    api.editor.failNext("POST", {
      status: 422,
      json: { error: "limit_reached", message: "", limit: "entries" },
    });
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-failure")).toContainText("full");
    await expect(page.getByTestId("editor-failure")).toContainText("KB-LIMIT");

    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    expect(api.editor.entries()[0]?.data.title).toBe("Dentist check-up");
  });

  test("backup: export downloads, import replaces after a confirmation", async ({
    page,
  }) => {
    const api = await openEditor(page, {
      seed: (mock) => {
        mock.editor.seed({
          kind: "event",
          icon: "🎨",
          title: "Painting",
          allDay: true,
          date: dateOf(2),
        });
      },
    });
    const download = page.waitForEvent("download");
    await page.getByTestId("export").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`kidboard-entries-${dateOf(0)}.json`);

    const backup = {
      format: "kidboard-entries",
      version: 1,
      exportedAt: "2026-11-22T11:00:00.000Z",
      entries: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          revision: 1,
          kind: "event",
          data: {
            kind: "event",
            childIds: [],
            icon: "🎪",
            title: "Circus",
            allDay: true,
            date: dateOf(3),
            repeat: "none",
            bring: [],
            countdown: false,
          },
          exdates: [],
          overrides: {},
          createdAt: "2026-11-22T11:00:00.000Z",
          updatedAt: "2026-11-22T11:00:00.000Z",
        },
      ],
    };
    await page.getByTestId("import-file").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.getByRole("radio", { name: "Replace all entries" }).check(CHIP);
    await page.getByTestId("import").click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Replace everything with 1 entry?");
    await confirm.getByRole("button", { name: "Replace all" }).click();
    // The message says what happened (the backup's id was not stored yet).
    await expect(page.getByTestId("editor-toast")).toContainText(
      "1 entry imported. 0 updated, 1 new.",
    );
    expect(api.editor.entries().map((entry) => entry.data.title)).toEqual([
      "Circus",
    ]);
    await expect(page.getByTestId("entry-list")).toContainText("Circus");
    await expect(page.getByTestId("entry-list")).not.toContainText("Painting");
  });

  test("an entry from the Again row is a template; offline keeps the form until the connection is back", async ({
    page,
  }) => {
    const api = await openEditor(page, {
      seed: (mock) => {
        mock.editor.seed({
          kind: "event",
          childIds: ["ben"],
          icon: "🥋",
          title: "Judo",
          allDay: false,
          date: dateOf(2),
          startTime: "17:00",
          endTime: "18:00",
        });
      },
    });
    await page
      .getByTestId("templates-list")
      .getByTestId("template")
      .filter({ hasText: "Judo" })
      .click();
    const form = page.getByTestId("event-form");
    await expect(form.getByLabel("Name on the tile")).toHaveValue("Judo");
    await expect(form.getByRole("checkbox", { name: "Ben" })).toBeChecked();
    await expect(form.getByLabel("Starts at")).toHaveValue("17:00");

    // The mock answers on the page, below the network: an offline tablet is a
    // handler registered later (it wins) that fails the writes like a lost connection.
    const offline = (route: Route): Promise<void> =>
      route.abort("internetdisconnected");
    await page.route("**/api/parent/entries", offline);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-failure")).toContainText("KB-NET");
    await expect(form.getByLabel("Name on the tile")).toHaveValue("Judo");
    expect(api.editor.entries()).toHaveLength(1);

    await page.unroute("**/api/parent/entries", offline);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-toast")).toContainText("Saved");
    expect(api.editor.entries()).toHaveLength(2);
  });

  test("phone feed: the absolute link is shown, copied and confirmed", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openEditor(page);
    const block = page.getByTestId("phone-feed");
    await expect(block).toBeVisible();
    const absolute = new URL(MOCK_FEED_URL, page.url()).href;
    await expect(block.getByRole("textbox")).toHaveValue(absolute);
    await expect(block).toContainText("Google Calendar");
    await expectTouchTargets(block);
    await expectNoOverflow(page);

    const status = page.getByTestId("feed-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await block.getByRole("button", { name: "Copy link" }).click();
    await expect(status).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      absolute,
    );
    // The token reaches neither the persisted query cache nor any other storage.
    const stored = await page.evaluate(() =>
      [window.localStorage, window.sessionStorage]
        .flatMap((storage) =>
          Object.keys(storage).map(
            (key) => `${key}=${storage.getItem(key) ?? ""}`,
          ),
        )
        .join("\n"),
    );
    expect(stored).not.toContain("token=");
    // The confirmation goes away again.
    await expect(status).toBeEmpty({ timeout: 8000 });
  });

  test("phone feed: without Clipboard access the link is selected", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
    });
    await openEditor(page);
    const field = page.getByTestId("feed-url");
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByTestId("feed-status")).toHaveText(
      "The link is selected – copy it now",
    );
    await expect(field).toBeFocused();
  });

  test("phone feed: hidden when the feed is off", async ({ page }) => {
    await openEditor(page, {
      seed: (mock) => {
        mock.editor.setFeedUrl(undefined);
      },
    });
    await expect(page.getByTestId("data-section")).toBeVisible();
    await expect(page.getByTestId("phone-feed")).toHaveCount(0);
  });

  test("a refused save shows its reason in view; Cancel asks before dropping changes", async ({
    page,
  }) => {
    const api = await openEditor(page);
    // The jump bar reaches the backup section further down and back.
    await page
      .getByRole("navigation", { name: "Jump to" })
      .getByRole("button", { name: "Backup & phone" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Backup & phone" }),
    ).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Backup & phone" }),
    ).toBeInViewport();

    await page.getByTestId("new-entry").click();
    const form = page.getByTestId("event-form");
    // Scroll the form down first, so the picture field is out of view.
    await form.getByTestId("field-countdown").scrollIntoViewIfNeeded();
    await page.getByTestId("editor-save").click();
    const error = form
      .getByTestId("field-what")
      .getByText("Pick a picture or enter your own emoji.");
    await expect(error).toBeInViewport();
    await expect(form.getByRole("radio", { name: "Swimming" })).toBeFocused();

    // An own "emoji" that is none is refused, not replaced by another picture.
    await form.getByRole("radio", { name: "Swimming" }).check(CHIP);
    await form.getByRole("textbox", { name: "Your own emoji" }).fill("abc");
    await page.getByTestId("editor-save").click();
    await expect(
      form.getByText("The “Your own emoji” field holds no single emoji."),
    ).toBeInViewport();
    expect(api.editor.writes).toEqual([]);

    await page.getByTestId("editor-cancel").click();
    const ask = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByTestId("editor-home")).toBeVisible();
    expect(api.editor.writes).toEqual([]);
  });

  test("an XSS-looking title stays text", async ({ page }) => {
    await openEditor(page, {
      seed: (mock) => {
        mock.editor.seed({
          kind: "event",
          icon: "🎉",
          title: '<img src=x onerror="window.__xss=1">',
          allDay: true,
          date: dateOf(0),
          countdown: true,
        });
      },
    });
    await expect(page.getByTestId("entry-list")).toContainText(
      '<img src=x onerror="window.__xss=1">',
    );
    expect(await page.evaluate(() => "__xss" in window)).toBe(false);
    await expect(page.getByTestId("entry-list").locator("img")).toHaveCount(0);
  });
});
