// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  inlineScriptHashes,
  parseHeadersFile,
  patternMatches,
  renderHeadersFile,
  staticHeaderRules,
} from "./staticHeaders";

// Known vector: the CSP hash example on MDN (`<script>alert('Hello, world.');</script>`).
const MDN_SCRIPT = "alert('Hello, world.');";
const MDN_HASH = "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='";
// SHA-256 of the empty string.
const EMPTY_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

const SOURCE_HTML = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);

function cspOf(html: string): string {
  const header = staticHeaderRules(html)
    .flatMap((rule) => rule.headers)
    .find(([name]) => name === "Content-Security-Policy");
  if (header === undefined) {
    throw new Error("no CSP header");
  }
  return header[1];
}

function directive(csp: string, name: string): string[] {
  const entry = csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([first]) => first === name);
  return entry?.slice(1) ?? [];
}

describe("inlineScriptHashes", () => {
  it("hashes the exact text of inline scripts (known vectors)", () => {
    expect(inlineScriptHashes(`<script>${MDN_SCRIPT}</script>`)).toEqual([
      MDN_HASH,
    ]);
    expect(inlineScriptHashes("<script></script>")).toEqual([EMPTY_HASH]);
  });

  it("skips scripts with src, keeps inline module scripts, in document order", () => {
    const html = [
      `<script type="module" crossorigin src="/assets/index.js"></script>`,
      `<script data-theme-boot>${MDN_SCRIPT}</script>`,
      `<SCRIPT type="module"></SCRIPT >`,
    ].join("\n");
    expect(inlineScriptHashes(html)).toEqual([MDN_HASH, EMPTY_HASH]);
  });

  it("hashes CRLF line endings like the browser (normalised to LF)", () => {
    expect(inlineScriptHashes("<script>a\r\nb\rc</script>")).toEqual(
      inlineScriptHashes("<script>a\nb\nc</script>"),
    );
    expect(inlineScriptHashes("<script>a\nb</script>")).not.toEqual(
      inlineScriptHashes("<script>a b</script>"),
    );
  });

  it("returns nothing for a page without inline scripts", () => {
    expect(inlineScriptHashes(`<script src="/a.js"></script>`)).toEqual([]);
  });
});

describe("index.html theme boot script", () => {
  it("is the only inline script, so the CSP allows exactly its hash", () => {
    const boot = /<script data-theme-boot>([\s\S]*?)<\/script>/.exec(
      SOURCE_HTML,
    );
    expect(boot?.[1]).toContain("kidboard.theme");
    const hashes = inlineScriptHashes(SOURCE_HTML);
    expect(hashes).toHaveLength(1);
    expect(hashes).toEqual(
      inlineScriptHashes(`<script>${boot?.[1] ?? ""}</script>`),
    );
    expect(directive(cspOf(SOURCE_HTML), "script-src")).toEqual([
      "'self'",
      ...hashes,
    ]);
  });

  it("changes the CSP when the script changes (hash follows the bytes)", () => {
    const edited = SOURCE_HTML.replace(
      'getItem("kidboard.theme")',
      'getItem("kidboard.theme2")',
    );
    expect(edited).not.toBe(SOURCE_HTML);
    expect(cspOf(edited)).not.toBe(cspOf(SOURCE_HTML));
  });
});

describe("contentSecurityPolicy", () => {
  const csp = contentSecurityPolicy([MDN_HASH]);

  it("allows same-origin resources and the given hashes only", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).toEqual(["'self'", MDN_HASH]);
    for (const name of [
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "manifest-src",
      "worker-src",
    ]) {
      expect(directive(csp, name)).toEqual(["'self'"]);
    }
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'none'"]);
    expect(directive(csp, "form-action")).toEqual(["'none'"]);
    // Only the board itself may frame the board (the parent editor can be click-jacked).
    expect(directive(csp, "frame-ancestors")).toEqual(["'self'"]);
  });

  it("never allows inline code, eval or other origins", () => {
    expect(csp).not.toMatch(/unsafe-|\*|https?:|data:|blob:/);
  });

  it("without hashes allows same-origin scripts only", () => {
    expect(directive(contentSecurityPolicy([]), "script-src")).toEqual([
      "'self'",
    ]);
  });
});

describe("staticHeaderRules", () => {
  const rules = staticHeaderRules(SOURCE_HTML);

  it("sends security headers on every asset path", () => {
    expect(rules.map((r) => r.pattern)).toEqual(["/*"]);
    const names = rules[0]?.headers.map(([name]) => name);
    expect(names).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
    const headers = new Map(rules[0]?.headers);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("keeps the platform Cache-Control default (no override for sw.js/index.html)", () => {
    const all = rules.flatMap((r) => r.headers.map(([n]) => n.toLowerCase()));
    expect(all).not.toContain("cache-control");
  });

  it("leaves wake lock and fullscreen allowed", () => {
    const policy = new Map(rules[0]?.headers).get("Permissions-Policy") ?? "";
    expect(policy).not.toMatch(/screen-wake-lock|fullscreen/);
  });
});

describe("_headers file", () => {
  it("round-trips through render and parse", () => {
    const rules = staticHeaderRules(SOURCE_HTML);
    const text = renderHeadersFile(rules);
    expect(text.startsWith("# Generated")).toBe(true);
    expect(text).toMatch(/^\/\*\n {2}Content-Security-Policy: default-src/m);
    expect(parseHeadersFile(text)).toEqual(
      rules.map((r) => ({ pattern: r.pattern, headers: r.headers })),
    );
  });

  it("fits the Workers Static Assets limits (100 rules, 2000 chars per line)", () => {
    const text = renderHeadersFile(staticHeaderRules(SOURCE_HTML));
    for (const line of text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(2000);
    }
    expect(parseHeadersFile(text).length).toBeLessThanOrEqual(100);
  });

  it("parses several rules, comments, CRLF and values containing colons", () => {
    const text =
      "# c\r\n/a\r\n  X-One: 1\r\n\r\n/assets/*\r\n  Link: <https://x.test/>; rel=preload\r\n";
    expect(parseHeadersFile(text)).toEqual([
      { pattern: "/a", headers: [["X-One", "1"]] },
      {
        pattern: "/assets/*",
        headers: [["Link", "<https://x.test/>; rel=preload"]],
      },
    ]);
  });

  it("rejects a header line without a pattern or without a colon", () => {
    expect(() => parseHeadersFile("  X-One: 1\n")).toThrow(/line 1/);
    expect(() => parseHeadersFile("/*\n  no-colon\n")).toThrow(/line 2/);
  });
});

describe("patternMatches", () => {
  it.each([
    ["/*", "/", true],
    ["/*", "/sw.js", true],
    ["/assets/*", "/assets/index.js", true],
    ["/assets/*", "/sw.js", false],
    ["/sw.js", "/sw.js", true],
    ["/sw.js", "/sw.json", false],
  ])("%s vs %s -> %s", (pattern, path, expected) => {
    expect(patternMatches(pattern, path)).toBe(expected);
  });
});
