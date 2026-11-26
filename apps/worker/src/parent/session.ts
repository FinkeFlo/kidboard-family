import { PARENT_SESSION_HEADER } from "@kidboard/shared";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

import { SchemaGate } from "../entries/schema";
import type { Env } from "../env";
import { notFound } from "../http/errors";
import { editorEnabled } from "./pin";

/** ADR-0013: a parent session is valid for 15 minutes. */
export const SESSION_TTL_SECONDS = 15 * 60;

/** `kb_meta` key of the random server secret (ADR-0013). */
export const SERVER_SECRET_KEY = "parent_session_secret";
/** ADR-0013: 32 random bytes. */
export const SERVER_SECRET_BYTES = 32;

const TOKEN_VERSION = "v1";
/** `v1.<expiry epoch seconds>.<base64url HMAC-SHA-256, 32 bytes = 43 chars>`. */
const TOKEN_RE = /^v1\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
/** Domain separation of the HKDF step (key = f(server secret, PIN)). */
const KEY_INFO_PREFIX = "kidboard parent session v1\u0000";

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * Decodes unpadded, canonical base64url; `null` for anything else (including
 * encodings whose unused trailing bits are set, which would decode to the same bytes
 * as the canonical text).
 */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    return null;
  }
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

/**
 * Derives the HMAC-SHA-256 session key from the server secret and the PIN (HKDF-SHA-256,
 * the PIN in `info`): a new PIN or a new secret gives a new key, so every session
 * signed with the old one stops verifying.
 */
export async function deriveSessionKey(
  serverSecret: Uint8Array,
  pin: string,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    serverSecret,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(KEY_INFO_PREFIX + pin),
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** Signs a session that expires at `expiresAtSeconds` (epoch seconds). */
export async function signSession(
  key: CryptoKey,
  expiresAtSeconds: number,
): Promise<string> {
  const payload = `${TOKEN_VERSION}.${String(expiresAtSeconds)}`;
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

/**
 * Verifies a session token: format, MAC (constant time via `crypto.subtle.verify`) and
 * `now < expiry <= now + TTL` (a token that claims to live longer than any token this
 * worker issues is rejected too). Returns the expiry in epoch seconds or `null`.
 */
export async function verifySession(
  key: CryptoKey,
  token: string,
  nowSeconds: number,
): Promise<number | null> {
  const match = TOKEN_RE.exec(token);
  const expText = match?.[1];
  const mac = fromBase64Url(match?.[2] ?? "");
  if (expText === undefined || mac?.length !== 32) {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    mac,
    encoder.encode(`${TOKEN_VERSION}.${expText}`),
  );
  const exp = Number(expText);
  if (!valid || exp <= nowSeconds || exp > nowSeconds + SESSION_TTL_SECONDS) {
    return null;
  }
  return exp;
}

/**
 * Reads the server secret from `kb_meta`, generating it on first use. Race-safe: an
 * `INSERT OR IGNORE` of a fresh random value followed by a read in the same batch, so
 * concurrent first requests all end up with the one value that won. Once it exists,
 * this is a single read (no write).
 */
export async function loadServerSecret(db: D1Database): Promise<Uint8Array> {
  const select = db
    .prepare("SELECT value FROM kb_meta WHERE key = ?1")
    .bind(SERVER_SECRET_KEY);
  let value = await select.first<string>("value");
  if (value === null) {
    const fresh = toBase64Url(
      crypto.getRandomValues(new Uint8Array(SERVER_SECRET_BYTES)),
    );
    const results = await db.batch<{ value: unknown }>([
      db
        .prepare("INSERT OR IGNORE INTO kb_meta (key, value) VALUES (?1, ?2)")
        .bind(SERVER_SECRET_KEY, fresh),
      select,
    ]);
    const stored = results[1]?.results[0]?.value;
    value = typeof stored === "string" ? stored : null;
  }
  const secret = typeof value === "string" ? fromBase64Url(value) : null;
  if (secret?.length !== SERVER_SECRET_BYTES) {
    // Never include the value: it is the signing secret.
    throw new Error("kb_meta holds no valid parent session secret");
  }
  return secret;
}

/**
 * Per-isolate cache of the session key per database binding. The key depends on the
 * PIN, so a changed `KIDBOARD_PARENT_PIN` derives a new key on the next request. A
 * failed load is not remembered.
 */
export class SessionKeys {
  private readonly gate = new SchemaGate();
  private readonly memo = new WeakMap<
    D1Database,
    { pin: string; key: Promise<CryptoKey> }
  >();

  key(db: D1Database, pin: string): Promise<CryptoKey> {
    const known = this.memo.get(db);
    if (known?.pin === pin) {
      return known.key;
    }
    const entry = { pin, key: this.load(db, pin) };
    this.memo.set(db, entry);
    entry.key.catch(() => {
      if (this.memo.get(db) === entry) {
        this.memo.delete(db);
      }
    });
    return entry.key;
  }

  /** Schema gate shared with the unlock route (both use `kb_meta`). */
  async ensureSchema(db: D1Database): Promise<void> {
    await this.gate.ensure(db);
  }

  private async load(db: D1Database, pin: string): Promise<CryptoKey> {
    const secret = await this.gate.run(db, () => loadServerSecret(db));
    return deriveSessionKey(secret, pin);
  }
}

/** Hono environment of routes behind {@link requireParentSession}. */
export interface ParentEnv {
  Bindings: Env;
  Variables: {
    /** Expiry of the verified parent session, epoch seconds. */
    parentSessionExpiresAt: number;
  };
}

export interface ParentSessionOptions {
  keys: SessionKeys;
  /** Clock, epoch ms. */
  now: () => number;
}

/**
 * Guard for editor routes (ADR-0013): runs after the access token check and needs a
 * valid, unexpired session token in {@link PARENT_SESSION_HEADER}. Editor off → 404
 * `not_found`; missing, malformed, tampered, expired or signed under another PIN or
 * server secret → 403 `parent_locked` (401 is reserved for the access token: the board
 * client forgets its access token on any 401). Sets `parentSessionExpiresAt`.
 */
export function requireParentSession(
  options: ParentSessionOptions,
): MiddlewareHandler<ParentEnv> {
  return createMiddleware<ParentEnv>(async (c, next) => {
    const db = c.env.KIDBOARD_DATA;
    const pin = c.env.KIDBOARD_PARENT_PIN;
    if (!editorEnabled(c.env) || db === undefined || pin === undefined) {
      return notFound(c);
    }
    const token = c.req.header(PARENT_SESSION_HEADER) ?? "";
    const exp =
      token === ""
        ? null
        : await verifySession(
            await options.keys.key(db, pin),
            token,
            Math.floor(options.now() / 1000),
          );
    if (exp === null) {
      return c.json(
        { error: "parent_locked", message: "Parent session required" },
        403,
      );
    }
    c.set("parentSessionExpiresAt", exp);
    await next();
  });
}
