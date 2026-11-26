import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Device-zone guard: shared tests run in a zone far from every configured zone
    // (UTC+14, no DST), so code that used the process zone instead of the explicit
    // `timeZone` would produce wrong dates. `deviceZone.test.ts` asserts it is active.
    env: { TZ: "Pacific/Kiritimati" },
  },
});
