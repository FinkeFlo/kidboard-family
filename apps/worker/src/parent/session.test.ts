import { reset } from "cloudflare:test";
import { env as testEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { ensureSchema } from "../entries/schema";
import {
  deriveSessionKey,
  fromBase64Url,
  loadServerSecret,
  SERVER_SECRET_BYTES,
  SERVER_SECRET_KEY,
  SESSION_TTL_SECONDS,
  SessionKeys,
  signSession,
  toBase64Url,
  verifySession,
} from "./session";

const db = testEnv.KIDBOARD_DATA;
const PIN = "246813";
const NOW_S = 1_773_046_800; // 2026-03-09T09:00:00Z
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

afterEach(async () => {
  await reset();
});

describe("base64url", () => {
  it("round-trips bytes without padding or + and /", () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xfe, 0x00, 0x3e]);
    const text = toBase64Url(bytes);
    expect(text).toBe("-__-AD4");
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it.each(["a+b", "a/b", "abc=", "a", "ab cd", "AB", "AAB"])(
    "rejects %j (non-canonical trailing bits included)",
    (text) => {
      expect(fromBase64Url(text)).toBeNull();
    },
  );
});

describe("session tokens", () => {
  it("has the format v1.<exp>.<43-char base64url MAC> and verifies until expiry", async () => {
    const key = await deriveSessionKey(SECRET, PIN);
    const exp = NOW_S + SESSION_TTL_SECONDS;
    const token = await signSession(key, exp);
    expect(token).toMatch(
      new RegExp(`^v1\\.${String(exp)}\\.[A-Za-z0-9_-]{43}$`),
    );
    expect(await verifySession(key, token, NOW_S)).toBe(exp);
    expect(await verifySession(key, token, exp - 1)).toBe(exp);
    expect(await verifySession(key, token, exp)).toBeNull();
    expect(await verifySession(key, token, exp + 3600)).toBeNull();
  });

  it("rejects tokens signed under another PIN or another server secret", async () => {
    const exp = NOW_S + 60;
    const token = await signSession(await deriveSessionKey(SECRET, PIN), exp);
    const otherPin = await deriveSessionKey(SECRET, "246814");
    const otherSecret = await deriveSessionKey(
      Uint8Array.from({ length: 32 }, () => 7),
      PIN,
    );
    expect(await verifySession(otherPin, token, NOW_S)).toBeNull();
    expect(await verifySession(otherSecret, token, NOW_S)).toBeNull();
  });

  it("rejects tampered and malformed tokens", async () => {
    const key = await deriveSessionKey(SECRET, PIN);
    const exp = NOW_S + 600;
    const token = await signSession(key, exp);
    const [, , mac = ""] = token.split(".");
    const flipped = `${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
    // Same 32 bytes, other text: the last char carries 2 unused bits.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(mac.slice(-1));
    const nonCanonical = `${mac.slice(0, 42)}${alphabet[last ^ 1] ?? ""}`;
    const candidates = [
      `v1.${String(exp + 1)}.${mac}`, // extended expiry
      `v1.${String(exp)}.${flipped}`, // changed MAC
      `v1.${String(exp)}.${nonCanonical}`, // same MAC bytes, non-canonical text
      `v2.${String(exp)}.${mac}`,
      `v1.0${String(exp)}.${mac}`, // same number, other text
      `v1.${String(exp)}.${mac}=`,
      `v1.${String(exp)}.${mac.slice(0, 42)}`,
      `v1.${String(exp)}`,
      `${token}.x`,
      ` ${token}`,
      "",
    ];
    for (const candidate of candidates) {
      expect(await verifySession(key, candidate, NOW_S), candidate).toBeNull();
    }
  });

  it("rejects a correctly signed token that lives longer than the TTL", async () => {
    const key = await deriveSessionKey(SECRET, PIN);
    const exp = NOW_S + SESSION_TTL_SECONDS + 1;
    expect(
      await verifySession(key, await signSession(key, exp), NOW_S),
    ).toBeNull();
  });
});

describe("loadServerSecret", () => {
  it("generates 32 random bytes once and returns the same value afterwards", async () => {
    await ensureSchema(db);
    const first = await loadServerSecret(db);
    expect(first).toHaveLength(SERVER_SECRET_BYTES);
    expect(first.some((b) => b !== 0)).toBe(true);
    expect(await loadServerSecret(db)).toEqual(first);
    const rows = await db
      .prepare("SELECT COUNT(*) AS n FROM kb_meta WHERE key = ?1")
      .bind(SERVER_SECRET_KEY)
      .first<number>("n");
    expect(rows).toBe(1);
  });

  it("is race-safe: concurrent first calls agree on one secret", async () => {
    await ensureSchema(db);
    const secrets = await Promise.all(
      Array.from({ length: 6 }, () => loadServerSecret(db)),
    );
    for (const secret of secrets) {
      expect(secret).toEqual(secrets[0]);
    }
  });

  it("fails closed on a corrupt stored secret without quoting it", async () => {
    await ensureSchema(db);
    await db
      .prepare("INSERT INTO kb_meta (key, value) VALUES (?1, ?2)")
      .bind(SERVER_SECRET_KEY, "TESTONLY-short")
      .run();
    await expect(loadServerSecret(db)).rejects.toThrow(
      /^kb_meta holds no valid parent session secret$/,
    );
  });
});

describe("SessionKeys", () => {
  it("creates the schema on an empty database and caches the key per PIN", async () => {
    const keys = new SessionKeys();
    const key = await keys.key(db, PIN);
    expect(await keys.key(db, PIN)).toBe(key);
    const token = await signSession(key, NOW_S + 60);
    const other = await keys.key(db, "135791");
    expect(other).not.toBe(key);
    expect(await verifySession(other, token, NOW_S)).toBeNull();
    // A fresh isolate derives the same key from the stored secret.
    const fresh = await new SessionKeys().key(db, PIN);
    expect(await verifySession(fresh, token, NOW_S)).toBe(NOW_S + 60);
  });
});
