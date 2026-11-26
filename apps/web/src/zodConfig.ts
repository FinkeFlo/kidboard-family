import { z } from "zod";

/**
 * Must be the first import of `main.tsx`: zod decides at schema construction whether it
 * may compile parsers with `new Function`, probing once. Under the production CSP (no
 * `'unsafe-eval'`, apps/web/headers/staticHeaders.ts) that probe is blocked and reported
 * as a CSP violation, so the JIT is switched off before any schema module runs.
 */
z.config({ jitless: true });
