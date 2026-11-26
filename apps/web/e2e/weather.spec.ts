import { expect, type Locator, type Page, test } from "@playwright/test";

import { demoAgenda, demoConfig, demoWeather } from "../demo/demoData";
import { clothingPlacement, columnAccount, expectNoOverflow } from "./layout";
import {
  agenda,
  at,
  CHILDREN,
  config,
  dateOf,
  mockBoard,
  type MockEvent,
  NOW,
  QUERY_CACHE_KEY,
  setNow,
} from "./mockApi";

/*
 * Weather and what to wear (T-49) on a fixed clock (device zone America/Los_Angeles,
 * config zone Europe/Berlin): a chip on every overview column and in the week headers
 * (synthetic demo forecast: today mostly sunny, now 8°, high 12°; tomorrow rain, 7°),
 * today's clothing row until eveningStart (17:00); from then tomorrow's, led by tomorrow's
 * weather, while today's chip says "now" only; always on one line beside "Today". Weather
 * off shows nothing and never asks; an error status hides the weather without any
 * message, offline the persisted forecast stays.
 */

const MEALS = [0, 1, 2, 3].flatMap((day) => [
  { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣", day },
  { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲", day },
]);

const EVENTS: MockEvent[] = [
  { title: "Kindergarten", icon: "🏫", time: "08:30", childIds: ["ben"] },
  { title: "Piano", icon: "🎹", time: "16:30", childIds: ["mia"] },
  { title: "Bath time", icon: "🛁", time: "18:00" },
  {
    title: "Swimming",
    icon: "🏊",
    time: "07:30",
    day: 1,
    childIds: ["mia"],
    bring: ["🩱", "🧴"],
  },
  { title: "Dentist", icon: "🦷", time: "09:00", day: 2 },
];

const todayColumn = (page: Page): Locator =>
  page.locator("[data-testid=day-column][data-today=true]");

async function openBoard(
  page: Page,
  options: {
    weather?: boolean;
    now?: string;
    status?: number;
    locale?: string;
  } = {},
): Promise<Awaited<ReturnType<typeof mockBoard>>> {
  const now = options.now ?? NOW;
  const api = await mockBoard(page, {
    config: config({
      weather: options.weather ?? true,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    }),
    agenda: agenda(EVENTS, MEALS),
    weather:
      options.status === undefined || options.status === 200
        ? demoWeather(dateOf(0), now)
        : { error: "weather_unavailable" },
    weatherStatus: options.status ?? 200,
    now,
  });
  await page.goto("/");
  await expect(page.getByTestId("board-ready")).toBeVisible();
  return api;
}

/** Nothing overlaps or is cut, and the pill sits beside the chip in the heading row. */
async function expectClothingLayout(page: Page): Promise<number> {
  const placement = await clothingPlacement(page);
  expect(placement.problems).toEqual([]);
  expect(placement.sameLine).toBe(true);
  return placement.iconRem;
}

test("chips on every overview column and in the week headers, with the attribution", async ({
  page,
}) => {
  await openBoard(page);
  const columns = page.getByTestId("day-column");
  await expect(columns).toHaveCount(4);
  await expect(page.getByTestId("weather-chip")).toHaveCount(4);
  for (const [index, column] of (await columns.all()).entries()) {
    await expect(column.getByTestId("weather-chip")).toHaveAttribute(
      "data-date",
      dateOf(index),
    );
    await expect(column.getByTestId("weather-chip")).toBeInViewport({
      ratio: 1,
    });
  }
  await expect(
    todayColumn(page).getByRole("img", {
      name: "Mostly sunny, now 8 degrees, high 12 degrees",
    }),
  ).toHaveText("🌤️8°");
  await expect(
    columns.nth(1).getByRole("img", { name: "Rain, high 7 degrees" }),
  ).toHaveText("🌧️7°");
  // Never the moon for the weather (rule 1).
  await expect(
    page.getByTestId("weather-chip").filter({ hasText: "🌙" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("weather-attribution")).toHaveText(
    "Weather: Open-Meteo.com",
  );
  await expect(page.getByTestId("weather-attribution")).toBeInViewport({
    ratio: 1,
  });
  await expectNoOverflow(page);

  await page.getByRole("button", { name: "Week" }).click();
  await expect(columns).toHaveCount(7);
  const chips = page.getByTestId("weather-chip");
  await expect(chips).toHaveCount(7);
  for (const chip of await chips.all()) {
    await expect(chip).toHaveAttribute("aria-hidden", "true");
    await expect(chip).toBeInViewport({ ratio: 1 });
  }
  await expect(
    page.getByRole("heading", { name: "Monday, Rain, high 7 degrees" }),
  ).toBeVisible();
  // Today too shows the daily high in the week, not "now".
  await expect(
    page.getByRole("heading", {
      name: "Sunday, Mostly sunny, high 12 degrees",
    }),
  ).toBeVisible();
  await expect(chips.first()).toHaveText("🌤️12°");
  await expect(page.getByTestId("clothing-row")).toHaveCount(0);
  // Week account: nothing lost with the weather line in the header.
  const today = page.locator("[data-testid=day-column][data-today=true]");
  const account = await columnAccount(today);
  expect(account.shown.length + account.folded + account.hidden).toBe(3);
  await expectNoOverflow(page);
});

for (const night of [false, true]) {
  const mode = night ? "night" : "light";
  test(`today's clothes in the morning, tomorrow's with its weather from eveningStart (${mode})`, async ({
    page,
  }, testInfo) => {
    await mockBoard(page, {
      config: config({ weather: true, children: CHILDREN }),
      agenda: agenda(EVENTS, MEALS),
      weather: demoWeather(dateOf(0), at("16:59")),
      now: at("16:59"),
    });
    await page.goto(`/?night=${night ? "1" : "0"}`);
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const column = todayColumn(page);
    const morning = column.getByRole("list", { name: "Wear today: jacket" });
    await expect(morning).toBeVisible();
    await expect(column.getByTestId("clothing-row")).toHaveAttribute(
      "data-when",
      "today",
    );
    await expect(column.getByTestId("clothing-lead")).toHaveCount(0);
    await expect(page.getByTestId("clothing-row")).toHaveCount(1);
    // Morning: today's chip (its weather) is the pill's lead; 2rem icons.
    await expect(
      column.getByRole("img", {
        name: "Mostly sunny, now 8 degrees, high 12 degrees",
      }),
    ).toHaveText("🌤️8°");
    expect(await expectClothingLayout(page)).toBe(2);

    // eveningStart: tomorrow's clothes (cold and rainy), led by tomorrow's weather.
    await setNow(page, at("17:00"));
    const evening = column.getByRole("list", {
      name: "Tomorrow: Rain, high 7 degrees. Wear: umbrella, rain boots, jacket, warm hat, and gloves",
    });
    await expect(evening).toBeVisible();
    await expect(evening.getByRole("listitem")).toHaveText([
      "🌂",
      "👢",
      "🧥",
      "",
      "🧤",
    ]);
    // The knitted hat is drawn (no emoji up to 13.0), named like every item.
    await expect(
      evening
        .getByRole("img", { name: "warm hat" })
        .getByTestId("clothing-pictogram"),
    ).toBeVisible();
    await expect(column.getByTestId("clothing-arrow")).toBeVisible();
    await expect(column.getByTestId("clothing-forecast")).toHaveText("🌧️7°");
    // No weekday in the pill: the 🎒 area carries it.
    await expect(column.getByTestId("clothing-day")).toHaveCount(0);
    await expect(column.getByTestId("bring-day")).toHaveText("Mon");
    // Today's chip: thermometer and "now" only, never the day's sun.
    const chip = column.getByTestId("weather-head").getByTestId("weather-chip");
    await expect(chip).toHaveAccessibleName("Now 8 degrees");
    await expect(chip).toHaveText("🌡️8°");
    await expect(column.getByTestId("weather-head")).not.toContainText("🌤️");
    const iconRem = await expectClothingLayout(page);
    expect(iconRem).toBeGreaterThanOrEqual(1.5);
    if (testInfo.project.name === "tablet-2000x1200") {
      // The icons grow with the screen: at least 40 px (2.5 × the 16 px of 1280x800).
      const px = await column
        .getByTestId("clothing-item")
        .first()
        .evaluate((item) => item.getBoundingClientRect().width);
      expect(px).toBeGreaterThanOrEqual(40);
    }
    // The 🎒 area shows too, and neither 🎒 nor 🌙 is used for the weather.
    await expect(column.getByTestId("bring-area")).toBeVisible();
    await expect(column.getByTestId("clothing-row")).not.toContainText(
      /🎒|🌙/u,
    );
    // Not a live region, nothing to touch.
    await expect(
      column.getByTestId("clothing-row").locator("[aria-live], button, a"),
    ).toHaveCount(0);

    await setNow(page, at("19:40"));
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      night ? "night" : "light",
    );
    if (night) {
      // Night: emoji and the drawn hat are dimmed alike.
      const filters = await column
        .getByTestId("clothing-item")
        .evaluateAll((items) =>
          items.map(
            (item) =>
              getComputedStyle(
                item.querySelector(
                  ".font-emoji, [data-testid=clothing-pictogram]",
                ) as Element,
              ).filter,
          ),
        );
      expect(filters).toHaveLength(5);
      for (const filter of filters)
        expect(filter).toContain("brightness(0.75)");
    }
    // Later "now" (fetched 16:59) is over 2 h old: no chip at all in the evening.
    await expect(
      column.getByTestId("weather-head").getByTestId("weather-chip"),
    ).toHaveCount(0);
    await expect(column.getByTestId("clothing-forecast")).toHaveText("🌧️7°");
    await expectNoOverflow(page);
  });
}

/** Tomorrow freezing, wet and snowy: the most items (five) and a two-digit frost. */
function frostyTomorrow(now: string): unknown {
  const weather = demoWeather(dateOf(0), now);
  const [today, tomorrow, ...rest] = weather.days;
  if (today === undefined || tomorrow === undefined) {
    throw new Error("no forecast day");
  }
  const cold = -12;
  return {
    ...weather,
    current: { ...weather.current, temperature: cold + 1 },
    days: [
      today,
      {
        ...tomorrow,
        code: 73,
        tempMax: cold,
        feelsMin: cold - 2,
        feelsMax: cold,
        snow: true,
      },
      ...rest,
    ],
  };
}

for (const locale of ["de", "en"] as const) {
  test(`five items and tomorrow's lead stay on one line; the "now" chip gives way before 1.5rem (${locale})`, async ({
    page,
  }, testInfo) => {
    const now = at("18:00");
    await mockBoard(page, {
      config: config({ weather: true, locale }),
      agenda: agenda(EVENTS, MEALS),
      weather: frostyTomorrow(now),
      now,
    });
    await page.goto("/");
    await expect(page.getByTestId("board-ready")).toBeVisible();
    const column = todayColumn(page);
    await expect(
      column.getByRole("list", {
        name:
          locale === "de"
            ? "Morgen: Schnee, bis -12 Grad. Anziehen: Regenschirm, Winterstiefel, Jacke, Mütze und Handschuhe"
            : "Tomorrow: Snow, high -12 degrees. Wear: umbrella, winter boots, jacket, warm hat, and gloves",
      }),
    ).toBeVisible();
    await expect(column.getByTestId("clothing-item")).toHaveCount(5);
    // The real minus sign on screen.
    await expect(column.getByTestId("clothing-forecast")).toHaveText("❄️−12°");
    // Too wide for 2rem and 1.75rem with "🌡️ −11°": the chip gives way first (tomorrow's
    // weather is in the pill), so the icons keep 1.75rem.
    await expect(
      column.getByTestId("weather-head").getByTestId("weather-chip"),
    ).toHaveCount(0);
    await expect(column.getByTestId("weather-head")).toHaveAttribute(
      "data-fit",
      "2",
    );
    const iconRem = await expectClothingLayout(page);
    expect(iconRem).toBe(1.75);
    if (testInfo.project.name === "tablet-2000x1200") {
      // The icons grow with the screen: at least 40 px (2.5 × the 16 px of 1280x800).
      const px = await column
        .getByTestId("clothing-item")
        .first()
        .evaluate((item) => item.getBoundingClientRect().width);
      expect(px).toBeGreaterThanOrEqual(40);
    }
    for (const item of await column.getByTestId("clothing-item").all()) {
      await expect(item).toBeInViewport({ ratio: 1 });
    }
    await expectNoOverflow(page);
  });
}

test("other days: short date beside the chip, never cut (°F and two-digit frost)", async ({
  page,
}) => {
  const now = at("09:00");
  const weather = demoWeather(dateOf(0), now);
  await mockBoard(page, {
    config: config({ weather: true, locale: "en" }),
    agenda: agenda(EVENTS, MEALS),
    weather: {
      ...weather,
      unit: "fahrenheit",
      days: weather.days.map((day, index) => ({
        ...day,
        code: 1,
        tempMax: index === 2 ? -12 : 100 + index,
      })),
    },
    now,
  });
  await page.goto("/");
  await expect(page.getByTestId("board-ready")).toBeVisible();
  const dates = page.getByTestId("column-date");
  await expect(dates).toHaveText(["Nov 23", "Nov 24", "Nov 25"]);
  await expect(
    page.getByTestId("day-column").nth(2).getByTestId("weather-chip"),
  ).toHaveText("🌤️−12°");
  await expect(
    page.getByTestId("day-column").nth(1).getByTestId("weather-chip"),
  ).toHaveText("🌤️101°");
  for (const date of await dates.all()) {
    const cut = await date.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 0.5,
    );
    expect(cut).toBe(false);
  }
  await expectNoOverflow(page);
});

test("German short dates beside the chips", async ({ page }) => {
  await openBoard(page, { locale: "de" });
  await expect(page.getByTestId("column-date")).toHaveText([
    "23. Nov.",
    "24. Nov.",
    "25. Nov.",
  ]);
});

test("week: the weather sits above the weekday, the moons below it, apart", async ({
  page,
}) => {
  await mockBoard(page, {
    config: config({ weather: true }),
    agenda: agenda(
      [
        ...EVENTS,
        {
          title: "Birthday",
          icon: "🎂",
          time: null,
          day: 5,
          countdown: true,
        },
      ],
      MEALS,
    ),
    weather: demoWeather(dateOf(0), NOW),
  });
  await page.goto("/");
  await expect(page.getByTestId("board-ready")).toBeVisible();
  await page.getByRole("button", { name: "Week" }).click();
  await expect(page.getByTestId("week-weather")).toHaveCount(7);
  await expect(page.getByTestId("column-moon")).toHaveCount(5);
  for (const column of await page.getByTestId("day-column").all()) {
    const layout = await column.evaluate((element) => {
      const rect = (selector: string): DOMRect | undefined =>
        element.querySelector(selector)?.getBoundingClientRect();
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const icon = element.querySelector(
        "[data-testid=weather-chip] .font-emoji",
      );
      return {
        chip: rect("[data-testid=weather-chip]"),
        heading: rect("h2"),
        moon: rect("[data-testid=column-moon]"),
        iconRem:
          icon === null ? 0 : parseFloat(getComputedStyle(icon).fontSize) / rem,
      };
    });
    if (layout.chip === undefined || layout.heading === undefined) {
      throw new Error("missing chip or heading");
    }
    expect(layout.iconRem).toBeGreaterThanOrEqual(1.75);
    // The chip ends above the weekday; a moon starts below it (1 px for glyph boxes).
    expect(layout.chip.bottom).toBeLessThanOrEqual(layout.heading.top + 0.5);
    if (layout.moon !== undefined) {
      expect(layout.moon.top).toBeGreaterThanOrEqual(layout.heading.bottom - 1);
    }
  }
  await expectNoOverflow(page);
});

test("offline the persisted forecast stays; an error status hides it", async ({
  page,
}) => {
  const api = await openBoard(page);
  await expect(page.getByTestId("weather-chip")).toHaveCount(4);
  // Wait until the forecast is persisted (throttled writes).
  await expect
    .poll(
      () =>
        page.evaluate(
          (key) => window.localStorage.getItem(key) ?? "",
          QUERY_CACHE_KEY,
        ),
      { timeout: 10_000 },
    )
    .toContain('"fetchedAt"');

  // No answer at all: the next start keeps the forecast.
  await page.route("**/api/weather", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.reload();
  await expect(page.getByTestId("board-ready")).toBeVisible();
  await expect(page.getByTestId("weather-chip")).toHaveCount(4);
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("weather-chip")).toHaveCount(4);
  await expect(page.getByTestId("clothing-row")).toBeVisible();
  await expect(page.getByTestId("weather-attribution")).toBeVisible();

  // An answer with an error status: hidden, quietly.
  await page.unroute("**/api/weather");
  api.weather = { error: "weather_unavailable" };
  api.weatherStatus = 503;
  await page.reload();
  await expect(page.getByTestId("board-ready")).toBeVisible();
  await expect
    .poll(() => page.getByTestId("weather-chip").count(), { timeout: 15_000 })
    .toBe(0);
  await expect(page.getByTestId("weather-attribution")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the attribution is readable and set apart in the rail", async ({
  page,
}) => {
  await openBoard(page);
  const source = page.getByTestId("weather-attribution").locator("span");
  const measures = await page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rect = (id: string): DOMRect | undefined =>
      document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
    const span = document.querySelector(
      "[data-testid=weather-attribution] span",
    );
    return {
      rem,
      size: span === null ? 0 : parseFloat(getComputedStyle(span).fontSize),
      updated: rect("updated-at"),
      attribution: rect("weather-attribution"),
    };
  });
  await expect(source).toHaveText("Open-Meteo.com");
  // 13 px at the 16 px root of 1280x800, scaling with it.
  expect(measures.size / measures.rem).toBeGreaterThanOrEqual(0.8125 - 0.001);
  if (measures.updated === undefined || measures.attribution === undefined) {
    throw new Error("missing rail text");
  }
  expect(
    measures.attribution.top - measures.updated.bottom,
  ).toBeGreaterThanOrEqual(0.5 * measures.rem);
  await expect(page.getByTestId("weather-attribution")).toBeInViewport({
    ratio: 1,
  });
});

/*
 * The demo board (all-day trip, 🎒 for both children, five clothing items in the evening)
 * in both languages, morning and evening: "Heute" / "Today" keeps its whole text, and
 * neither the pill nor the chip touches it, also after the web fonts arrive.
 */
for (const locale of ["de", "en"] as const) {
  for (const time of ["09:00", "17:00", "18:30"]) {
    test(`the heading is never covered (${locale}, ${time})`, async ({
      page,
    }) => {
      const now = at(time);
      await mockBoard(page, {
        config: { ...(demoConfig() as object), locale },
        agenda: demoAgenda(dateOf(0), now),
        weather: demoWeather(dateOf(0), now),
        now,
      });
      await page.goto("/?burnin=0");
      await expect(page.getByTestId("board-ready")).toBeVisible();
      const column = todayColumn(page);
      await expect(column.getByTestId("clothing-row")).toBeVisible();
      await expect(column.getByRole("heading", { level: 2 })).toHaveText(
        locale === "de" ? "Heute" : "Today",
      );
      const placement = await clothingPlacement(page);
      expect(placement.problems).toEqual([]);
      expect(placement.sameLine).toBe(true);
      expect(placement.iconRem).toBeGreaterThanOrEqual(1.5);
      await expectNoOverflow(page);
    });
  }
}

test("weather off: no chips, no clothes, no attribution, no request", async ({
  page,
}) => {
  const api = await openBoard(page, { weather: false });
  await expect(page.getByTestId("event-tile").first()).toBeVisible();
  await expect(page.getByTestId("weather-chip")).toHaveCount(0);
  await expect(page.getByTestId("clothing-row")).toHaveCount(0);
  await expect(page.getByTestId("weather-attribution")).toHaveCount(0);
  await page.getByRole("button", { name: "Week" }).click();
  await expect(page.getByTestId("day-column")).toHaveCount(7);
  await expect(page.getByTestId("weather-chip")).toHaveCount(0);
  await expect(page.getByTestId("week-weather")).toHaveCount(0);
  expect(api.requests).not.toContain("/api/weather");
});

test("a failing /api/weather hides the weather quietly", async ({ page }) => {
  const api = await openBoard(page, { status: 503 });
  await expect(page.getByTestId("event-tile").first()).toBeVisible();
  // The first attempt and the two automatic retries of a 5xx, all failed.
  await expect
    .poll(() => api.requests.filter((path) => path === "/api/weather").length, {
      timeout: 10_000,
    })
    .toBe(3);
  // Longer than the status banner's 5 s delay (STALE_BANNER_DELAY_MS): still calm.
  await page.waitForTimeout(6000);
  await expect(page.getByTestId("weather-chip")).toHaveCount(0);
  await expect(page.getByTestId("clothing-row")).toHaveCount(0);
  await expect(page.getByTestId("weather-attribution")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.locator("[data-status=stale], [data-status=offline]"),
  ).toHaveCount(0);
  await expect(page.getByTestId("updated-at")).toBeVisible();
  await expectNoOverflow(page);
});
