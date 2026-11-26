import { afterEach, describe, expect, it, vi } from "vitest";

import {
  firstInvalid,
  jumpTo,
  prefersReducedMotion,
  revealFirstInvalid,
} from "./reveal";

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.append(root);
  return root;
}

function stubMotion(reduce: boolean | null): void {
  vi.stubGlobal(
    "matchMedia",
    reduce === null
      ? undefined
      : (query: string): Pick<MediaQueryList, "matches" | "media"> => ({
          matches: reduce && query === "(prefers-reduced-motion: reduce)",
          media: query,
        }),
  );
}

const scroll = vi.fn<(options?: ScrollIntoViewOptions) => void>();

afterEach(() => {
  vi.unstubAllGlobals();
  scroll.mockReset();
  document.body.innerHTML = "";
  // jsdom has no scrollIntoView; the tests add it.
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

function withScroll(): void {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(
    this: HTMLElement,
    options?: boolean | ScrollIntoViewOptions,
  ): void {
    scroll.call(this, typeof options === "object" ? options : undefined);
  };
}

describe("prefersReducedMotion", () => {
  it("follows the media query and assumes reduced motion without one", () => {
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    stubMotion(null);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("firstInvalid", () => {
  it("returns null when every field is fine", () => {
    const root = html(
      '<fieldset aria-invalid="false"><input type="radio"></fieldset>',
    );
    expect(firstInvalid(root)).toBeNull();
  });

  it("takes the first invalid field in document order", () => {
    const root = html(`
      <fieldset id="who"><input type="checkbox"></fieldset>
      <fieldset id="what" aria-invalid="true">
        <input id="group" type="radio" checked>
        <div data-invalid-focus><input id="icon" type="radio"></div>
      </fieldset>
      <div data-editor-field id="name-field">
        <input id="name" aria-invalid="true">
      </div>`);
    const found = firstInvalid(root);
    expect(found?.field.id).toBe("what");
    // The marked choices win over the checked group chip.
    expect(found?.control?.id).toBe("icon");
  });

  it("prefers an invalid input inside the field (own emoji)", () => {
    const root = html(`
      <fieldset aria-invalid="true">
        <div data-invalid-focus><input id="icon" type="radio"></div>
        <input id="own" aria-invalid="true">
      </fieldset>`);
    expect(firstInvalid(root)?.control?.id).toBe("own");
  });

  it("falls back to the checked choice, then to any enabled control", () => {
    const checked = html(`
      <fieldset aria-invalid="true">
        <input id="a" type="radio" disabled>
        <input id="b" type="radio" checked>
      </fieldset>`);
    expect(firstInvalid(checked)?.control?.id).toBe("b");
    const plain = html(`
      <fieldset aria-invalid="true">
        <input id="c" disabled><button id="d" type="button">x</button>
      </fieldset>`);
    expect(firstInvalid(plain)?.control?.id).toBe("d");
  });

  it("scrolls a single input with its labelled wrapper", () => {
    const root = html(`
      <div data-editor-field id="wrap">
        <label for="n">Name</label><input id="n" aria-invalid="true">
      </div>`);
    const found = firstInvalid(root);
    expect(found?.field.id).toBe("wrap");
    expect(found?.control?.id).toBe("n");
  });
});

describe("revealFirstInvalid", () => {
  it("scrolls the field to the top smoothly and focuses its control", () => {
    stubMotion(false);
    withScroll();
    const root = html(`
      <fieldset id="what" aria-invalid="true">
        <div data-invalid-focus><input id="icon" type="radio"></div>
      </fieldset>`);
    expect(revealFirstInvalid(root)).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(scroll.mock.contexts[0]).toBe(root.querySelector("#what"));
    expect(document.activeElement?.id).toBe("icon");
  });

  it("jumps without animation under reduced motion", () => {
    stubMotion(true);
    withScroll();
    const root = html(
      '<div data-editor-field><input id="n" aria-invalid="true"></div>',
    );
    revealFirstInvalid(root);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(document.activeElement?.id).toBe("n");
  });

  it("does nothing without a form or an invalid field", () => {
    withScroll();
    expect(revealFirstInvalid(null)).toBe(false);
    expect(revealFirstInvalid(html("<input>"))).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("jumpTo", () => {
  it("scrolls to a heading and makes it focusable by script only", () => {
    stubMotion(true);
    withScroll();
    const root = html('<h3 id="list">Next 14 days</h3>');
    const heading = root.querySelector("h3") as HTMLElement;
    jumpTo(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  });

  it("keeps the tab order of a control", () => {
    const root = html('<button type="button">Go</button>');
    const button = root.querySelector("button") as HTMLElement;
    jumpTo(button);
    expect(button.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});
