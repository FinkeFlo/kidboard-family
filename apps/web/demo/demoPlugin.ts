import type { IncomingMessage } from "node:http";

import type { Plugin } from "vite";

import type * as DemoApiModule from "./demoApi.ts";

/** Largest request body the demo reads (the worker's import limit is ~8 MiB). */
const MAX_BODY_BYTES = 9 * 1024 * 1024;

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (request.method === "GET" || request.method === "HEAD") {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("demo request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(
        chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8"),
      );
    });
    request.on("error", reject);
  });
}

/**
 * Dev-only Vite plugin (`pnpm dev:demo`): answers `/api/config`, `/api/agenda`,
 * `/api/weather` and the parent routes (`/api/parent/*`: unlock with the demo PIN, session, the editor API)
 * from the synthetic demo data and an in-memory editor store (`demoApi.ts`), so board
 * and editor can be tried without a worker, secrets, D1 or a calendar. It only exists
 * in the dev server (`apply: "serve"`), never in a build.
 *
 * The API module is loaded through the dev server (`ssrLoadModule`) because it imports
 * the TypeScript sources of `@kidboard/shared`, which Node cannot load while Vite reads
 * its config; this file itself only imports types. The store is created once per dev
 * server and kept in this closure.
 */
export function demoApiPlugin(): Plugin {
  let api: DemoApiModule.DemoApi | undefined;
  return {
    name: "kidboard-demo-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const [path = "", search = ""] = (request.url ?? "").split("?");
        if (!path.startsWith("/api/")) {
          next();
          return;
        }
        Promise.all([
          server.ssrLoadModule("/demo/demoApi.ts"),
          readBody(request),
        ])
          // `ssrLoadModule` is untyped (Record<string, any>); the cast is the module's shape.
          .then(([module, body]) => {
            const demo = module as typeof DemoApiModule;
            api ??= demo.createDemoApi();
            const header = request.headers["x-kidboard-parent"];
            const answer = api.handle({
              method: request.method ?? "GET",
              path,
              search,
              body,
              session: typeof header === "string" ? header : null,
            }) ?? { status: 404, json: { error: "not_found", message: "" } };
            response.statusCode = answer.status;
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            for (const [name, value] of Object.entries(answer.headers ?? {})) {
              response.setHeader(name, value);
            }
            response.end(JSON.stringify(answer.json));
          })
          .catch((error: unknown) => {
            next(error);
          });
      });
    },
  };
}
