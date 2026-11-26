import { parseConfig } from "@kidboard/shared";
import { describe, expect, it } from "vitest";

import devVarsExample from "../../../../.dev.vars.example?raw";
import rootPackageJson from "../../../../package.json?raw";

/**
 * "Deploy to Cloudflare" asks for every uncommented entry of `.dev.vars.example` as a
 * secret (offering its value as the default) and shows the `cloudflare.bindings`
 * descriptions of the root `package.json` (docs/DEPLOY.md). T-46b keeps that form lean:
 * access token, parent PIN and config only; Google calendars are added later.
 */
const FORM_SECRETS = [
  "KIDBOARD_ACCESS_TOKEN",
  "KIDBOARD_PARENT_PIN",
  "KIDBOARD_CONFIG",
];
const AUTO_BINDINGS = ["KIDBOARD_CACHE", "KIDBOARD_DATA"];

/** Uncommented `NAME=value` entries (dotenv; one pair of outer quotes removed). */
function dotenvEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      continue;
    }
    const raw = match[2];
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    entries.set(match[1], quoted?.[2] ?? raw);
  }
  return entries;
}

function bindingDescriptions(): Record<string, string> {
  const parsed = JSON.parse(rootPackageJson) as {
    cloudflare?: { bindings?: Record<string, { description?: unknown }> };
  };
  const bindings = parsed.cloudflare?.bindings ?? {};
  return Object.fromEntries(
    Object.entries(bindings).map(([name, binding]) => [
      name,
      typeof binding.description === "string" ? binding.description : "",
    ]),
  );
}

describe("deploy form template (.dev.vars.example)", () => {
  const entries = dotenvEntries(devVarsExample);

  it("asks only for the access token, the parent PIN and the config", () => {
    expect([...entries.keys()]).toEqual(FORM_SECRETS);
  });

  it("keeps the Google feeds as commented, optional examples", () => {
    expect(devVarsExample).toMatch(/^# CAL_KINDER_URL=/m);
    expect(devVarsExample).not.toMatch(/^CAL_/m);
  });

  it("ships a single-line config with example children and no calendars", () => {
    const raw = entries.get("KIDBOARD_CONFIG") ?? "";
    expect(raw).not.toContain("\n");
    const result = parseConfig(JSON.parse(raw));
    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }
    expect(result.config.calendars).toEqual([]);
    expect(result.config.children.length).toBeGreaterThan(0);
  });

  it("keeps the template token and PIN unusable until replaced", () => {
    expect(entries.get("KIDBOARD_ACCESS_TOKEN")).toContain("REPLACE_ME");
    expect(entries.get("KIDBOARD_PARENT_PIN")).toContain("REPLACE_ME");
  });
});

describe("deploy form descriptions (package.json cloudflare.bindings)", () => {
  const descriptions = bindingDescriptions();

  it("describes exactly the form secrets and the auto-created bindings", () => {
    expect(Object.keys(descriptions).sort()).toEqual(
      [...FORM_SECRETS, ...AUTO_BINDINGS].sort(),
    );
  });

  it("gives every field a short plain description", () => {
    for (const [name, text] of Object.entries(descriptions)) {
      expect(text.length, name).toBeGreaterThan(20);
      expect(text.length, name).toBeLessThanOrEqual(240);
      expect(text, name).not.toMatch(/CAL_/);
    }
    for (const name of AUTO_BINDINGS) {
      expect(descriptions[name]).toMatch(/keep the default/i);
    }
    expect(descriptions.KIDBOARD_ACCESS_TOKEN).toMatch(/editor/);
    expect(descriptions.KIDBOARD_ACCESS_TOKEN).toContain("?key=");
  });
});
