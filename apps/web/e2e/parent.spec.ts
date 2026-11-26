import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  ACCESS_TOKEN_KEY,
  agenda,
  config,
  MOCK_PARENT_PIN,
  type MockApi,
  mockBoard,
  NOW,
  setNow,
} from "./mockApi";

/** Low-entropy synthetic access token (gitleaks-friendly). */
const TOKEN = "TESTONLY-not-a-secret";
/** ADR-0013: hold time of the hidden entry. */
const HOLD_MS = 2000;

const EVENTS = [
  { title: "Swimming", icon: "🏊", time: "15:30", childIds: ["mia"] },
];

async function openBoard(
  page: Page,
  options: { editor?: boolean } = {},
): Promise<MockApi> {
  const api = await mockBoard(page, {
    config: config({
      locale: "en",
      ...(options.editor === false ? {} : { editor: true }),
    }),
    agenda: agenda(EVENTS, []),
  });
  await page.goto(`/?key=${TOKEN}`);
  await expect(page.getByTestId("board-ready")).toBeVisible();
  return api;
}

function entry(page: Page): Locator {
  return page.getByRole("button", { name: /parent area/i });
}

function pinPad(page: Page): Locator {
  return page.getByRole("dialog", { name: "Parent area" });
}

function editor(page: Page): Locator {
  return page.getByRole("dialog", { name: "Editor" });
}

/** Presses and holds the entry with the mouse until the PIN pad shows. */
async function holdEntry(page: Page): Promise<void> {
  const box = await entry(page).boundingBox();
  if (box === null) throw new Error("entry has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
  await page.mouse.up();
}

async function typePin(page: Page, pin: string): Promise<void> {
  for (const digit of pin) {
    await pinPad(page)
      .getByRole("button", { name: digit, exact: true })
      .click();
  }
  await pinPad(page).getByRole("button", { name: "OK" }).click();
}

async function unlock(page: Page): Promise<void> {
  await holdEntry(page);
  await typePin(page, MOCK_PARENT_PIN);
  await expect(editor(page)).toBeVisible();
}

test.describe("parent gate (ADR-0013)", () => {
  test("no entry when the editor is off", async ({ page }) => {
    await openBoard(page, { editor: false });
    await expect(page.getByTestId("nav-rail")).toBeVisible();
    await expect(entry(page)).toHaveCount(0);
  });

  test("a short tap shows nothing; a 2 s hold opens the PIN pad; the right PIN opens the editor", async ({
    page,
  }) => {
    const api = await openBoard(page);
    const button = entry(page);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(64);
    expect(box?.height).toBeGreaterThanOrEqual(64);
    // Inside the rail and the viewport, without page overflow.
    const rail = await page.getByTestId("nav-rail").boundingBox();
    const viewport = page.viewportSize();
    if (box === null || rail === null || viewport === null) {
      throw new Error("missing boxes");
    }
    expect(box.y + box.height).toBeLessThanOrEqual(rail.y + rail.height + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const scroll = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    expect(scroll.w).toBeLessThanOrEqual(viewport.width);
    expect(scroll.h).toBeLessThanOrEqual(viewport.height);

    // Short tap: no ring, no hint, no dialog.
    await button.click();
    await page.waitForTimeout(HOLD_MS + 300);
    await expect(page.getByTestId("parent-hold-ring")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Hold: the ring fills, then the PIN pad opens.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("parent-hold-progress")).toBeVisible();
    await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
    await page.mouse.up();
    await expect(page.getByTestId("board-layer")).toHaveAttribute("inert", "");

    // 3 × 4 keypad of >= 64 px keys.
    for (const name of ["1", "5", "0", "OK", "Delete last digit"]) {
      const key = await pinPad(page)
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(key?.height).toBeGreaterThanOrEqual(64);
      expect(key?.width).toBeGreaterThanOrEqual(64);
    }

    for (const digit of MOCK_PARENT_PIN) {
      await pinPad(page)
        .getByRole("button", { name: digit, exact: true })
        .click();
    }
    // Masked: dots only.
    await expect(page.getByTestId("pin-dots")).toHaveAttribute(
      "data-count",
      String(MOCK_PARENT_PIN.length),
    );
    await expect(pinPad(page)).not.toContainText(MOCK_PARENT_PIN);
    await pinPad(page).getByRole("button", { name: "OK" }).click();

    await expect(editor(page)).toBeVisible();
    expect(api.parent.unlocks).toEqual([
      { pin: MOCK_PARENT_PIN, authorization: `Bearer ${TOKEN}` },
    ]);
    // The session token stays in memory only.
    const stored = await page.evaluate(() =>
      [window.localStorage, window.sessionStorage]
        .flatMap((storage) =>
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index) ?? "";
            return `${key}=${storage.getItem(key) ?? ""}`;
          }),
        )
        .join("\n"),
    );
    expect(stored).not.toContain("TESTONLY-not-a-signature");

    await editor(page).getByRole("button", { name: "Done" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByTestId("board-layer")).not.toHaveAttribute("inert");
    await expect(page.getByTestId("board-ready")).toBeVisible();
  });

  test("keyboard: Enter held 2 s opens the PIN pad, a digit and Enter unlock", async ({
    page,
  }) => {
    await openBoard(page);
    await entry(page).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.keyboard.down("Enter");
    await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
    await page.keyboard.up("Enter");
    // The released Enter neither typed nor submitted.
    await expect(page.getByTestId("pin-dots")).toHaveAttribute(
      "data-count",
      "0",
    );
    // Escape closes the pad and focus returns to the entry (WCAG 2.4.3).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(entry(page)).toBeFocused();

    await page.keyboard.down("Enter");
    await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
    await page.keyboard.up("Enter");
    await page.keyboard.type(MOCK_PARENT_PIN);
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeVisible();

    // "Done" also hands focus back to the entry.
    await editor(page).getByRole("button", { name: "Done" }).press("Enter");
    await expect(editor(page)).toHaveCount(0);
    await expect(entry(page)).toBeFocused();
  });

  test("wrong PINs show the tries left, then the lockout with minutes; the board keeps its token", async ({
    page,
  }) => {
    const api = await openBoard(page);
    await holdEntry(page);
    const feedback = page.getByTestId("pin-feedback");
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await typePin(page, "000000");
      const left = 5 - attempt;
      await expect(feedback).toHaveText(
        `Wrong PIN. ${String(left)} more ${left === 1 ? "try" : "tries"}.`,
      );
      await expect(page.getByTestId("pin-dots")).toHaveAttribute(
        "data-count",
        "0",
      );
    }
    await typePin(page, "000000");
    await expect(feedback).toHaveText(
      "Too many wrong PINs. Try again in 15 minutes.",
    );
    await expect(
      pinPad(page).getByRole("button", { name: "5", exact: true }),
    ).toBeDisabled();

    // Closing and reopening keeps the lockout (no request needed to know it).
    await pinPad(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await holdEntry(page);
    await expect(feedback).toContainText("15 minutes");
    await pinPad(page).getByRole("button", { name: "Cancel" }).click();

    // 403 and 429 never cost the board its access token or its data.
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        ACCESS_TOKEN_KEY,
      ),
    ).toBe(TOKEN);
    await expect(page.getByText("Swimming")).toBeVisible();
    expect(api.parent.unlocks.map((u) => u.authorization)).toEqual(
      Array.from({ length: 5 }, () => `Bearer ${TOKEN}`),
    );
  });

  test("mouse, then keyboard: typing goes on after a wrong PIN, 12 digits fit, Enter on a digit key submits", async ({
    page,
  }) => {
    await openBoard(page);
    await holdEntry(page);
    const dots = page.getByTestId("pin-dots");
    // Wrong PIN with the mouse: the clicked OK is disabled while it is checked.
    await typePin(page, "000000");
    await expect(page.getByTestId("pin-feedback")).toContainText("Wrong PIN");

    // The keyboard still works, and stops at 12 digits.
    await page.keyboard.type("1234567890123");
    await expect(dots).toHaveAttribute("data-count", "12");
    const padBox = await pinPad(page).boundingBox();
    const dotsBox = await dots.boundingBox();
    if (padBox === null || dotsBox === null) throw new Error("missing boxes");
    expect(dotsBox.x).toBeGreaterThanOrEqual(padBox.x);
    expect(dotsBox.x + dotsBox.width).toBeLessThanOrEqual(
      padBox.x + padBox.width,
    );
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("Backspace");
    await expect(dots).toHaveAttribute("data-count", "0");

    // Digits clicked with the mouse (the last key keeps the focus), then Enter.
    for (const digit of MOCK_PARENT_PIN) {
      await pinPad(page)
        .getByRole("button", { name: digit, exact: true })
        .click();
    }
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeVisible();
  });

  test("Escape after a wrong PIN closes the pad and returns the focus to the pencil", async ({
    page,
  }) => {
    await openBoard(page);
    await holdEntry(page);
    await typePin(page, "000000");
    await expect(page.getByTestId("pin-feedback")).toContainText("Wrong PIN");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(entry(page)).toBeFocused();
  });

  test("Space held 2 s on the pencil opens the PIN pad", async ({ page }) => {
    await openBoard(page);
    await entry(page).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.down("Space");
    await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
    await page.keyboard.up("Space");
    await expect(page.getByTestId("pin-dots")).toHaveAttribute(
      "data-count",
      "0",
    );
  });

  test("idle warning 30 s before the auto-lock; Keep editing keeps the editor open", async ({
    page,
  }) => {
    await openBoard(page);
    await unlock(page);
    const warning = page.getByTestId("idle-warning");
    await expect(warning).toHaveCount(0);
    await setNow(
      page,
      new Date(Date.parse(NOW) + 2 * 60_000 + 35_000).toISOString(),
      { wake: false },
    );
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Locking soon");
    // The real seconds left, not a fixed 30.
    await expect(warning).toContainText("in 25 seconds");
    await warning.getByRole("button", { name: "Keep editing" }).click();
    await expect(warning).toHaveCount(0);
    await expect(editor(page)).toBeVisible();
  });

  test("the idle warning on the PIN pad covers none of its buttons", async ({
    page,
  }) => {
    await openBoard(page);
    await holdEntry(page);
    await setNow(
      page,
      new Date(Date.parse(NOW) + 2 * 60_000 + 35_000).toISOString(),
      { wake: false },
    );
    const warning = page.getByTestId("idle-warning");
    await expect(warning).toBeVisible();
    await expect(page.getByTestId("idle-warning")).toHaveCount(1);
    const banner = await warning.boundingBox();
    if (banner === null) throw new Error("banner has no box");
    const buttons = pinPad(page).getByRole("button");
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      if ((await button.innerText()) === "Keep editing") continue;
      const box = await button.boundingBox();
      if (box === null) continue;
      const overlaps =
        box.x < banner.x + banner.width &&
        box.x + box.width > banner.x &&
        box.y < banner.y + banner.height &&
        box.y + box.height > banner.y;
      expect(overlaps, await button.innerText()).toBe(false);
    }
  });

  test("auto-lock: after 3 minutes without a touch and when the tab is hidden", async ({
    page,
  }) => {
    await openBoard(page);
    await unlock(page);

    // 3 minutes idle (the clock jumps like a tablet waking up): locked again.
    await setNow(
      page,
      new Date(Date.parse(NOW) + 3 * 60_000 + 5_000).toISOString(),
      {
        wake: false,
      },
    );
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByTestId("board-ready")).toBeVisible();

    await unlock(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(editor(page)).toHaveCount(0);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "visibilityState");
    });

    // Locked means a new PIN is needed: the next hold shows the pad, not the editor.
    await holdEntry(page);
    await expect(editor(page)).toHaveCount(0);
  });

  test("reduced motion: static ring while held, no shake on a wrong PIN", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page);
    const box = await entry(page).boundingBox();
    if (box === null) throw new Error("entry has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("parent-hold-ring")).toBeVisible();
    await expect(page.getByTestId("parent-hold-progress")).toBeHidden();
    await expect(pinPad(page)).toBeVisible({ timeout: HOLD_MS + 2000 });
    await page.mouse.up();

    await typePin(page, "000000");
    await expect(page.getByTestId("pin-feedback")).toContainText("Wrong PIN");
    const animation = await page
      .getByTestId("pin-dots-row")
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe("none");
  });
});
