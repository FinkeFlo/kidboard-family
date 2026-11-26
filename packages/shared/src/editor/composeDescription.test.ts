import { describe, expect, it } from "vitest";

import { BRING_SCAN_LIMIT, parseBringList } from "../title/parseBringList";
import { COUNTDOWN_TAG } from "../title/parseTitle";
import { composeDescription } from "./composeDescription";

const PRIVATE = "TESTONLY-private-note";

function compose(
  existing: string | undefined,
  bring: string[],
  countdown?: boolean,
  locale: "de" | "en" = "de",
): string {
  return composeDescription(existing, { bring, countdown, locale });
}

describe("composeDescription", () => {
  it("empty bring and no countdown on an empty description -> empty string", () => {
    expect(compose("", [], false)).toBe("");
    expect(compose(undefined, [], false)).toBe("");
    expect(compose("", [])).toBe("");
  });

  it("writes the bring keyword by locale", () => {
    expect(compose("", ["👟", "🩱"])).toBe("Mitbringen: 👟 🩱");
    expect(compose("", ["👟", "🩱"], false, "en")).toBe("Bring: 👟 🩱");
  });

  it("writes the countdown marker on its own line", () => {
    expect(compose("", [], true)).toBe("#countdown");
    expect(compose("", ["🎁"], true)).toBe("Mitbringen: 🎁\n#countdown");
    expect(compose(PRIVATE, [], true)).toBe(`${PRIVATE}\n#countdown`);
  });

  it("returns the description unchanged when nothing changes", () => {
    const existing = `${PRIVATE}\n- bring : 🧴 🧢\nParty #CountDown`;
    expect(compose(existing, ["🧴", "🧢"], true)).toBe(existing);
    expect(compose(existing, ["🧴", "🧢"])).toBe(existing);
  });

  it("replaces the first bring line in place and drops further ones", () => {
    const existing = `Zeile 1\nMitbringen: 👟\n${PRIVATE}\nBring: 🩱\nZeile 5`;
    expect(compose(existing, ["🧴"])).toBe(
      `Zeile 1\nMitbringen: 🧴\n${PRIVATE}\nZeile 5`,
    );
  });

  it("removes bring lines (incl. the last line) when bring is empty", () => {
    expect(compose(`${PRIVATE}\nMitbringen: 👟`, [])).toBe(PRIVATE);
    expect(compose(`Mitbringen: 👟\r\n${PRIVATE}`, [])).toBe(PRIVATE);
    expect(compose("Mitbringen: 👟", [])).toBe("");
  });

  it("appends a bring line when there was none", () => {
    expect(compose(PRIVATE, ["👟"])).toBe(`${PRIVATE}\nMitbringen: 👟`);
    expect(compose(`${PRIVATE}\n`, ["👟"])).toBe(`${PRIVATE}\nMitbringen: 👟`);
  });

  it("keeps Google-style HTML lines byte for byte", () => {
    const html =
      `<p><b>Wichtig:</b> ${PRIVATE} &amp; mehr</p>` +
      `<p><b>Mitbringen:</b>&nbsp;🎨 🖍️</p>` +
      `<ul><li><a href="https://example.invalid/x?a=1&amp;b=2">Link</a></li></ul>`;
    const result = compose(html, ["👟", "🩱"]);
    expect(result).toBe(
      `<p><b>Wichtig:</b> ${PRIVATE} &amp; mehr</p>` +
        `<p><b>Mitbringen: 👟 🩱</b></p>` +
        `<ul><li><a href="https://example.invalid/x?a=1&amp;b=2">Link</a></li></ul>`,
    );
    expect(parseBringList(result)).toEqual(["👟", "🩱"]);
  });

  it("removes HTML bring lines without breaking the markup", () => {
    expect(
      compose(`<p>${PRIVATE}</p><p>Mitbringen: 👟</p><p>Ende</p>`, []),
    ).toBe(`<p>${PRIVATE}</p><p>Ende</p>`);
    expect(compose(`${PRIVATE}<br>Mitbringen: 👟<br>Ende`, [])).toBe(
      `${PRIVATE}<br>Ende`,
    );
    expect(compose(`<p>${PRIVATE}<br>Mitbringen: 👟</p>`, [])).toBe(
      `<p>${PRIVATE}</p>`,
    );
    expect(compose(`<p>Mitbringen: 👟<br>${PRIVATE}</p>`, [])).toBe(
      `<p>${PRIVATE}</p>`,
    );
  });

  it("appends with <br> to HTML descriptions", () => {
    expect(compose(`<b>${PRIVATE}</b>`, ["👟"])).toBe(
      `<b>${PRIVATE}</b><br>Mitbringen: 👟`,
    );
    expect(compose(`<p>${PRIVATE}</p>`, ["👟"], true)).toBe(
      `<p>${PRIVATE}</p>Mitbringen: 👟<br>#countdown`,
    );
  });

  it("removes the countdown marker only", () => {
    expect(compose(`${PRIVATE}\n#countdown`, [], false)).toBe(PRIVATE);
    expect(compose(`Party! #countdown\n${PRIVATE}`, [], false)).toBe(
      `Party!\n${PRIVATE}`,
    );
    expect(compose(`<p>#countdown</p><p>${PRIVATE}</p>`, [], false)).toBe(
      `<p>${PRIVATE}</p>`,
    );
    // not a marker: part of a word
    expect(compose(`${PRIVATE} #countdowns`, [], false)).toBe(
      `${PRIVATE} #countdowns`,
    );
    expect(COUNTDOWN_TAG.test(compose("#countdown#countdown", [], false))).toBe(
      false,
    );
  });

  it("keeps the marker untouched when countdown is undefined", () => {
    expect(compose(`${PRIVATE}\n#countdown`, ["👟"])).toBe(
      `${PRIVATE}\n#countdown\nMitbringen: 👟`,
    );
  });

  it("ignores bring-like text inside <script>/<style>", () => {
    const existing = `<style>\nBring: 🎨\n</style>${PRIVATE}`;
    const result = compose(existing, ["👟"]);
    expect(result).toBe(`${existing}<br>Mitbringen: 👟`);
    expect(parseBringList(result)).toEqual(["👟"]);
  });

  it("prepends the bring line when appending would fall outside the scan window", () => {
    const long = "x".repeat(BRING_SCAN_LIMIT + 10);
    const result = compose(long, ["👟"]);
    expect(result).toBe(`Mitbringen: 👟\n${long}`);
    expect(parseBringList(result)).toEqual(["👟"]);
  });

  it.each([
    ["", ["👟"]],
    [PRIVATE, ["👨‍👩‍👧", "👋🏽", "🇩🇪", "1️⃣", "☀️", "🏳️‍🌈", "🧴", "🧢"]],
    [`Mitbringen: 🎨\n${PRIVATE}\nBring: 🍎`, ["☀️"]],
    [`<div>Bring: 🎨</div><div>${PRIVATE}</div>`, []],
    [`• Mitbringen : 👟\n  - bring: 🩱`, ["🧢", "👟"]],
  ])("parseBringList(result) equals bring for %j", (existing, bring) => {
    const result = compose(existing, bring, false);
    expect(parseBringList(result)).toEqual(bring);
    if (existing.includes(PRIVATE)) {
      expect(result).toContain(PRIVATE);
    }
  });
});

describe("composeDescription beyond the scan window", () => {
  it("also writes the bring line first when the old one is not read", () => {
    const long = "x".repeat(BRING_SCAN_LIMIT + 10);
    const result = compose(`${long}\nMitbringen: 🎨`, ["👟"]);
    expect(result).toBe(`Mitbringen: 👟\n${long}\nMitbringen: 👟`);
    expect(parseBringList(result)).toEqual(["👟"]);
  });
});

describe("composeDescription: countdown marker on a bring line", () => {
  it.each<[string, string[], boolean | undefined, string]>([
    ["Mitbringen: 👟 #countdown", ["🩱"], true, "Mitbringen: 🩱\n#countdown"],
    [
      "Mitbringen: 👟 #countdown",
      ["🩱"],
      undefined,
      "Mitbringen: 🩱\n#countdown",
    ],
    ["Mitbringen: 👟 #countdown", ["🩱"], false, "Mitbringen: 🩱"],
    ["Notiz<br>Mitbringen: 👟 #countdown", [], true, "Notiz<br>#countdown"],
    [
      "Notiz<br>Mitbringen: 👟 #countdown",
      [],
      undefined,
      "Notiz<br>#countdown",
    ],
    ["Notiz<br>Mitbringen: 👟 #countdown", [], false, "Notiz"],
    // unchanged bring list: the marker on it stays where it is
    [
      "Mitbringen: 👟 #countdown",
      ["👟"],
      undefined,
      "Mitbringen: 👟 #countdown",
    ],
    ["Mitbringen: 👟 #countdown", ["👟"], false, "Mitbringen: 👟"],
  ])(
    "%j bring %j countdown %s -> %j",
    (existing, bring, countdown, expected) => {
      const result = compose(existing, bring, countdown);
      expect(result).toBe(expected);
      expect(parseBringList(result)).toEqual(bring);
      expect(COUNTDOWN_TAG.test(result)).toBe(countdown ?? true);
    },
  );

  it("drops free text on a replaced bring line", () => {
    expect(compose("Mitbringen: 👟 Turnschuhe bitte", ["🩱"])).toBe(
      "Mitbringen: 🩱",
    );
  });

  it("countdown: false also removes markers inside <script>/<style>", () => {
    expect(
      COUNTDOWN_TAG.test(
        compose(`<style>/* #countdown */</style>${PRIVATE}`, [], false),
      ),
    ).toBe(false);
  });
});
