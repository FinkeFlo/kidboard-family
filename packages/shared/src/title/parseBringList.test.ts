import { describe, expect, it } from "vitest";

import { isSingleEmoji } from "../primitives";
import {
  BRING_LINE_LIMIT,
  BRING_MAX,
  BRING_SCAN_LIMIT,
  parseBringList,
} from "./parseBringList";

const ZWJ_FAMILY = "👨‍👩‍👧";
const SKIN_TONE = "👋🏽";
const FLAG = "🇩🇪";
const KEYCAP = "1️⃣";
const VS16_SUN = "☀️";

describe("parseBringList – keyword and line rules (AC 1)", () => {
  it.each<[string, string, string[]]>([
    ["German keyword", "Mitbringen: 👟 🩱 🧴", ["👟", "🩱", "🧴"]],
    ["English keyword", "Bring: 👟", ["👟"]],
    ["lower case", "bring: 👟", ["👟"]],
    ["upper case with space before the colon", "BRING : 👟", ["👟"]],
    ["mixed case German", "mItBrInGeN:👟", ["👟"]],
    ["tab before the colon", "Mitbringen\t: 👟", ["👟"]],
    ["leading whitespace", "   \tMitbringen: 👟", ["👟"]],
    ["dash bullet", "- Mitbringen: 👟", ["👟"]],
    ["star bullet", "* Bring: 👟", ["👟"]],
    ["dot bullet", "• Bring: 👟", ["👟"]],
    ["bullet without space", "•Bring: 👟", ["👟"]],
    ["several bullets and spaces", " - * Bring: 👟", ["👟"]],
    ["no space after the colon", "Bring:👟🩱", ["👟", "🩱"]],
    ["on a later line", "Hallo\nMitbringen: 👟\nTschüss", ["👟"]],
    ["CRLF lines", "Hallo\r\nBring: 👟\r\n🩱", ["👟"]],
    ["CR lines", "Hallo\rBring: 👟\r🩱", ["👟"]],
    ["Unicode line separator", "Hallo\u2028Bring: 👟\u2029🩱", ["👟"]],
  ])("matches: %s", (_name, description, expected) => {
    expect(parseBringList(description)).toEqual(expected);
  });

  it.each<[string, string]>([
    ["compound word", "Bringdienst: 👟"],
    ["keyword with suffix", "Bringen: 👟"],
    ["German prefix word", "Mitbringen2: 👟"],
    ["other word before the keyword", "Bitte mitbringen: 👟"],
    ["keyword mid-line", "Heute Bring: 👟"],
    ["keyword after an emoji", "🎒 Bring: 👟"],
    ["keyword without colon", "Bring 👟"],
    ["keyword after a numbered bullet", "1. Bring: 👟"],
    ["colon on the next line", "Bring\n: 👟"],
    ["other bullet character", "+ Bring: 👟"],
    ["word glued in front", "xBring: 👟"],
  ])("does not match: %s", (_name, description) => {
    expect(parseBringList(description)).toEqual([]);
  });

  it("merges several bring lines in order", () => {
    expect(
      parseBringList("Mitbringen: 👟\nNotiz 🍎\nBring: 🩱 🧴\n- bring: 🎨"),
    ).toEqual(["👟", "🩱", "🧴", "🎨"]);
  });

  it("drops text and digits between the emoji", () => {
    expect(parseBringList("Mitbringen: 👟 Turnschuhe, 🩱")).toEqual([
      "👟",
      "🩱",
    ]);
    expect(parseBringList("Bring: 2x 🧦 (warm!) und 3 🍎, bitte 42")).toEqual([
      "🧦",
      "🍎",
    ]);
  });

  it("drops text-only symbols", () => {
    expect(parseBringList("Bring: © # 1 ™ ® ☀ * 👟")).toEqual(["👟"]);
  });

  it("keeps ZWJ, skin-tone, flag, keycap and VS16 emoji whole", () => {
    const result = parseBringList(
      `Bring: ${ZWJ_FAMILY} ${SKIN_TONE} ${FLAG} ${KEYCAP} ${VS16_SUN} 🏳️‍🌈`,
    );
    expect(result).toEqual([
      ZWJ_FAMILY,
      SKIN_TONE,
      FLAG,
      KEYCAP,
      VS16_SUN,
      "🏳️‍🌈",
    ]);
    for (const icon of result) {
      expect(isSingleEmoji(icon)).toBe(true);
    }
  });

  it("removes duplicates, also across lines and with/without VS16 (first wins)", () => {
    expect(parseBringList("Bring: 👟 🩱 👟\nMitbringen: 🩱 🧴")).toEqual([
      "👟",
      "🩱",
      "🧴",
    ]);
    expect(parseBringList("Bring: ⚽\uFE0F ⚽ 🧴")).toEqual(["⚽\uFE0F", "🧴"]);
    expect(parseBringList("Bring: ⚽ ⚽\uFE0F")).toEqual(["⚽"]);
    // Different skin tones are different icons.
    expect(parseBringList("Bring: 👋🏽 👋🏻")).toEqual(["👋🏽", "👋🏻"]);
  });

  it("keeps emoji with a redundant VS16 and deduplicates them", () => {
    expect(parseBringList("Bring: 👟\uFE0F")).toEqual(["👟"]);
    expect(parseBringList("Bring: 👟\uFE0F 🩱\uFE0F")).toEqual(["👟", "🩱"]);
    expect(parseBringList("Bring: 👟\uFE0F 👟 🧴")).toEqual(["👟", "🧴"]);
    expect(parseBringList("Bring: 👟 👟\uFE0F")).toEqual(["👟"]);
    // A lone VS16 or one after text is still not an emoji.
    expect(parseBringList("Bring: a\uFE0F \uFE0F")).toEqual([]);
  });

  it(`caps at ${String(BRING_MAX)} icons, across lines too`, () => {
    const ten = "👟 🩱 🧴 🎨 🧦 🍎 🥤 📚 🖍️ 🧢";
    expect(parseBringList(`Bring: ${ten}`)).toEqual([
      "👟",
      "🩱",
      "🧴",
      "🎨",
      "🧦",
      "🍎",
      "🥤",
      "📚",
    ]);
    expect(
      parseBringList("Bring: 👟 🩱 🧴 🎨 🧦\nBring: 🍎 🥤 📚 🖍️ 🧢"),
    ).toHaveLength(BRING_MAX);
  });

  it.each<[string, string | undefined]>([
    ["a bring line without emoji", "Mitbringen: Turnschuhe und Handtuch"],
    ["an empty bring line", "Bring:"],
    ["an empty description", ""],
    ["an absent description", undefined],
    ["a description without bring line", "Treffpunkt Halle 2 👟"],
    ["whitespace only", " \n\t \r\n"],
  ])("returns [] for %s", (_name, description) => {
    expect(parseBringList(description)).toEqual([]);
  });

  it("returns [] for non-string runtime input instead of throwing", () => {
    // Untyped data (e.g. a malformed property) must not throw.
    const notAString: unknown = 42;
    expect(parseBringList(notAString as string)).toEqual([]);
  });
});

describe("parseBringList – formatted descriptions (AC 2)", () => {
  it.each<[string, string, string[]]>([
    ["<br>", "Hallo<br>Mitbringen: 👟", ["👟"]],
    ["<br/>", "Hallo<br/>Bring: 👟<br/>🩱", ["👟"]],
    ["<br />", "Hallo<BR />Bring: 👟", ["👟"]],
    ["</p>", "<p>Hallo</p><p>Bring: 👟</p><p>🩱</p>", ["👟"]],
    ["</div>", "<div>Hallo</div><div>Bring: 👟</div>🩱", ["👟"]],
    [
      "</li>",
      "<ul><li>Notiz</li><li>Mitbringen: 👟</li><li>🩱</li></ul>",
      ["👟"],
    ],
    ["bold keyword", "<b>Mitbringen:</b> 👟", ["👟"]],
    ["bold keyword without colon inside", "<b>Mitbringen</b>: 👟", ["👟"]],
    [
      "&nbsp; between keyword and emoji",
      "Mitbringen:&nbsp;👟&nbsp;🩱",
      ["👟", "🩱"],
    ],
    ["&nbsp; before the colon", "Bring&nbsp;: 👟", ["👟"]],
    ["numeric nbsp entities", "Bring:&#160;👟&#xA0;🩱", ["👟", "🩱"]],
    ["literal no-break space", "Bring\u00A0:\u00A0👟", ["👟"]],
    ["&nbsp; indentation", "&nbsp;&nbsp;- Bring: 👟", ["👟"]],
    ["&amp; in the line", "Bring: 👟 &amp; 🩱", ["👟", "🩱"]],
    ["span around an emoji", "Bring: <span>👟</span>", ["👟"]],
  ])("%s", (_name, description, expected) => {
    expect(parseBringList(description)).toEqual(expected);
  });

  it("does not match a keyword that is only formed by double-encoded entities", () => {
    // `&amp;nbsp;` decodes once to the text `&nbsp;`, which is not whitespace.
    expect(parseBringList("Bring&amp;nbsp;: 👟")).toEqual([]);
  });

  it("yields only the emoji of the bring line for HTML-looking content", () => {
    const result = parseBringList(
      [
        "<script>alert('x 🎃')</script>",
        "Mitbringen: <img src=x onerror=alert(1)> 👟 <script>document.cookie</script> 🩱",
        "<a href=\"javascript:alert('🐛')\">Link 🔗</a>",
      ].join("<br>"),
    );
    expect(result).toEqual(["👟", "🩱"]);
    for (const icon of result) {
      expect(isSingleEmoji(icon)).toBe(true);
    }
  });

  it("drops emoji inside <script> and <style> elements of the bring line", () => {
    expect(
      parseBringList(
        "Bring: 👟 <script>alert('🐛')</script> 🩱 <STYLE>p::after { content: '🎃' }</STYLE >🧴",
      ),
    ).toEqual(["👟", "🩱", "🧴"]);
    expect(
      parseBringList("Bring: 👟<script type=x>\n🐛\n</script>\nBring: 🩱"),
    ).toEqual(["👟", "🩱"]);
  });

  it("an unclosed <script> does not hide later lines", () => {
    expect(parseBringList("Wir üben <script>\nBring: 👟")).toEqual(["👟"]);
    expect(
      parseBringList("<script>\n<style>🎃</style>\nBring: 👟 <scripts> 🩱"),
    ).toEqual(["👟", "🩱"]);
  });

  it("emoji inside tag attributes are dropped with the tag", () => {
    expect(parseBringList('Bring: <img alt="🎃"> 👟')).toEqual(["👟"]);
  });

  it("a plain-text `<` does not swallow later lines", () => {
    expect(parseBringList("Treffpunkt < Halle\nBring: 👟 >")).toEqual(["👟"]);
    expect(parseBringList("Bring: 👟 <3 🩱")).toEqual(["👟", "🩱"]);
  });
});

describe("parseBringList – bounded work (AC 2)", () => {
  /** Runs `fn` and asserts it returns within `budgetMs` (generous for slow CI machines). */
  function timed<T>(fn: () => T, budgetMs = 250): T {
    const started = performance.now();
    const result = fn();
    expect(performance.now() - started).toBeLessThan(budgetMs);
    return result;
  }

  it(`only scans the first ${String(BRING_SCAN_LIMIT)} code units of a description`, () => {
    const padding = "x".repeat(BRING_SCAN_LIMIT - "\nBring: 👟".length);
    expect(parseBringList(`${padding}\nBring: 👟`)).toEqual(["👟"]);
    expect(parseBringList(`${padding}x\nBring: 👟`)).toEqual([]);
  });

  it(`only reads graphemes starting within the first ${String(BRING_LINE_LIMIT)} code units of a bring line`, () => {
    const prefix = "Bring: ";
    const filler = "x".repeat(BRING_LINE_LIMIT - prefix.length - 2);
    // 👟 starts at index 498 (inside), 🩱 at 500 (outside).
    expect(parseBringList(`${prefix}${filler}👟🩱`)).toEqual(["👟"]);
    // A ZWJ sequence starting inside the limit is kept whole, not cut.
    const zwjFiller = "x".repeat(BRING_LINE_LIMIT - prefix.length - 1);
    expect(parseBringList(`${prefix}${zwjFiller}${ZWJ_FAMILY}`)).toEqual([
      ZWJ_FAMILY,
    ]);
    // The keyword itself must be within the line limit.
    expect(parseBringList(`${" ".repeat(BRING_LINE_LIMIT)}Bring: 👟`)).toEqual(
      [],
    );
  });

  it("handles a 5 MB description fast and without throwing", () => {
    const big = `Bring: 👟\n${"Lorem ipsum dolor sit amet. ".repeat(190_000)}`;
    expect(big.length).toBeGreaterThan(5_000_000);
    expect(timed(() => parseBringList(big))).toEqual(["👟"]);
  });

  it("handles a bring line of 100 000 emoji fast", () => {
    const line = `Mitbringen: ${"👟🩱🧴🎨🧦🍎🥤📚🧢🎒".repeat(10_000)}`;
    expect(timed(() => parseBringList(line))).toHaveLength(BRING_MAX);
    const same = `Bring: ${"👟".repeat(100_000)}`;
    expect(timed(() => parseBringList(same))).toEqual(["👟"]);
  });

  it.each<[string, string]>([
    ["unclosed tags", "<".repeat(5_000_000)],
    ["unclosed tag starts with text", "<a ".repeat(2_000_000)],
    ["many line breaks", "<br>".repeat(1_500_000)],
    ["long whitespace in a <br", `<br${" ".repeat(5_000_000)}x`],
    ["many unclosed scripts", "<script>".repeat(700_000)],
    [
      "many unclosed styles before a script",
      `${"<style>".repeat(700_000)}<script></script>`,
    ],
    ["many script elements", "<script>🐛</script>Bring: 👟\n".repeat(200_000)],
    ["many bring lines", "Bring: 👟\n".repeat(500_000)],
    ["many bullets", `${"- ".repeat(2_500_000)}Bring: 👟`],
    ["keyword and spaces without colon", `Bring${" ".repeat(5_000_000)}x`],
    ["many ampersands", "&".repeat(5_000_000)],
    ["many entity starts", "&nbsp".repeat(1_000_000)],
    ["combining marks", `Bring: a${"\u0301".repeat(5_000_000)}`],
    ["ZWJ chain", `Bring: 👟${"\u200D👟".repeat(1_000_000)}`],
    ["lone surrogates", `Bring: ${"\uD83D".repeat(5_000_000)}`],
  ])("adversarial input finishes fast: %s", (_name, description) => {
    const result = timed(() => parseBringList(description));
    expect(result.length).toBeLessThanOrEqual(BRING_MAX);
    for (const icon of result) {
      expect(isSingleEmoji(icon)).toBe(true);
    }
  });
});
