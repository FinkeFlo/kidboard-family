import { expect, test } from "@playwright/test";

import { mockBoard } from "./mockApi";

// The API is never contacted for real in E2E: intercept every call (also avoids the
// preview proxy's ECONNREFUSED noise). The clock is fixed to Sunday 2026-11-22.
test.beforeEach(async ({ page }) => {
  await mockBoard(page);
});

test("renders the day view", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing planned today")).toBeVisible();
});

test("fits the viewport without scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday" }),
  ).toBeVisible();

  const metrics = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    rootFontSize: parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    ),
  }));

  expect(metrics.docScrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  // Fluid root size: 16px at 1280x800, 24px at 2000x1200.
  expect(metrics.rootFontSize).toBeCloseTo(metrics.innerHeight / 50, 0);
});

test("applies the self-hosted Nunito font and token colors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const style = await page.evaluate(async () => {
    await document.fonts.ready;
    const heading = document.querySelector("h1");
    return {
      family: heading ? getComputedStyle(heading).fontFamily : "",
      nunitoLoaded: document.fonts.check('16px "Nunito Variable"'),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(style.family).toContain("Nunito Variable");
  expect(style.nunitoLoaded).toBe(true);
  expect(style.background).toBe("rgb(251, 246, 238)");
});

test.describe("language", () => {
  test.use({ locale: "de-DE" });

  test("follows the browser language and sets <html lang>", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sonntag" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});
