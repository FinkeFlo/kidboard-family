import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import indexHtml from "../../index.html?raw";
import { THEME_STORAGE_KEY } from "./themeMemory";

/** The inline boot script of `index.html`, as shipped. */
function bootScript(): string {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  const script = doc.querySelector("head script[data-theme-boot]");
  if (script === null || script.hasAttribute("src")) {
    throw new Error("index.html has no inline theme boot script");
  }
  return script.textContent;
}

const errors: unknown[] = [];
const onError = (event: ErrorEvent): void => {
  errors.push(event.error);
};

/** Runs the boot script the way the browser does (jsdom executes inline scripts). */
function runBoot(): void {
  const script = document.createElement("script");
  script.textContent = bootScript();
  document.head.append(script);
  script.remove();
}

function theme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

beforeEach(() => {
  errors.length = 0;
  window.addEventListener("error", onError);
});

afterEach(() => {
  window.removeEventListener("error", onError);
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("index.html theme boot script", () => {
  it("is a classic inline script in <head>, before the app module", () => {
    const doc = new DOMParser().parseFromString(indexHtml, "text/html");
    const boot = doc.querySelector("script[data-theme-boot]");
    expect(boot?.parentElement?.tagName).toBe("HEAD");
    expect(boot?.getAttribute("type")).toBeNull();
    expect(bootScript()).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it.each(["night", "light"])("re-applies a remembered %s theme", (value) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
    runBoot();
    expect(theme()).toBe(value);
    expect(errors).toEqual([]);
  });

  it.each([null, "", "dark", "NIGHT", '"night"'])(
    "leaves the default tokens for %j",
    (value) => {
      if (value !== null) {
        window.localStorage.setItem(THEME_STORAGE_KEY, value);
      }
      runBoot();
      expect(theme()).toBeNull();
      expect(errors).toEqual([]);
    },
  );

  it("survives blocked storage without an error", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "night");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    runBoot();
    expect(theme()).toBeNull();
    expect(errors).toEqual([]);
  });
});
