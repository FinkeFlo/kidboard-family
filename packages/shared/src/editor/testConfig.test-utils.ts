import { type AppConfig, AppConfigSchema } from "../config";

/** Synthetic config shared by the editor tests (no real data). */
export function editorTestConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    ...AppConfigSchema.parse({
      locale: "de",
      timeZone: "Europe/Berlin",
      children: [
        { id: "mia", name: "Mia", color: "#cc0000", avatar: "🦊" },
        { id: "ben", name: "Ben", color: "#0000cc", avatar: "🐻" },
        { id: "juergen", name: "Jürgen", color: "#008800", avatar: "🐸" },
        { id: "emile", name: "Émile", color: "#008080", avatar: "🐧" },
        { id: "anna", name: "Anna-Lena", color: "#ff69b4", avatar: "🦄" },
      ],
      calendars: [
        { id: "kinder", kind: "events" },
        { id: "mia-cal", kind: "events", childId: "mia" },
        { id: "ben-cal", kind: "events", childId: "ben" },
        { id: "juergen-cal", kind: "events", childId: "juergen" },
        { id: "essen", kind: "meals" },
      ],
    }),
    ...overrides,
  };
}
