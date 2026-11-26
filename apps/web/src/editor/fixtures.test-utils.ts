// Synthetic fixtures for the editor tests (not part of the app bundle).
import {
  type AppEntryDto,
  type EditorAppItem,
  type EditorEntryInput,
  EditorEntryInputSchema,
  type EditorGoogleItem,
  type EditorListResponse,
  type EditorTemplate,
  type PublicConfig,
} from "@kidboard/shared";

import { BEN, MIA } from "../components/fixtures.test-utils";
import { configFixture } from "../data/testing.test-utils";

/** Sunday 2026-11-22 in Europe/Berlin. */
export const TODAY = "2026-11-22";
export const NOW_ISO = "2026-11-22T12:00:00+01:00";
export const SESSION = "v1.0.TESTONLY-not-a-signature";

export function editorConfig(
  overrides: Partial<PublicConfig> = {},
): PublicConfig {
  return {
    ...configFixture({
      children: [MIA, BEN],
      calendars: [
        { id: "family", kind: "events" },
        { id: "meals", kind: "meals" },
      ],
    }),
    editor: true,
    ...overrides,
  };
}

export function input(data: Record<string, unknown>): EditorEntryInput {
  return EditorEntryInputSchema.parse(data);
}

export const SWIM = input({
  kind: "event",
  childIds: ["mia"],
  icon: "🏊",
  title: "Swimming",
  allDay: false,
  date: TODAY,
  startTime: "15:00",
  endTime: "16:00",
  repeat: { weekly: { weekdays: [7], interval: 1 } },
  bring: ["🩱"],
});

export const DENTIST = input({
  kind: "event",
  childIds: ["ben"],
  icon: "🦷",
  title: "Dentist",
  allDay: false,
  date: "2026-11-23",
  startTime: "09:00",
  endTime: "09:30",
});

export const PIZZA = input({
  kind: "meal",
  icon: "🍕",
  title: "Pizza",
  allDay: true,
  date: TODAY,
  slot: "dinner",
});

export function appEntry(
  data: EditorEntryInput,
  overrides: Partial<AppEntryDto> = {},
): AppEntryDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    kind: data.kind,
    data,
    exdates: [],
    overrides: {},
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

function times(entry: EditorEntryInput): { start: string; end: string } {
  if (entry.allDay || entry.startTime === undefined) {
    const [y, m, d] = entry.date.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return { start: entry.date, end: entry.endDate ?? next };
  }
  return {
    start: `${entry.date}T${entry.startTime}:00+01:00`,
    end: `${entry.date}T${entry.endTime ?? entry.startTime}:00+01:00`,
  };
}

/** A list item of an app entry (`occurrenceDate` for series occurrences). */
export function appItem(
  entry: EditorEntryInput,
  options: {
    entryId?: string;
    revision?: number;
    occurrenceDate?: string | null;
    override?: EditorEntryInput | null;
  } = {},
): EditorAppItem {
  const occurrenceDate =
    options.occurrenceDate === undefined
      ? entry.repeat === "none"
        ? null
        : entry.date
      : options.occurrenceDate;
  const shown =
    options.override ??
    (occurrenceDate === null ? entry : { ...entry, date: occurrenceDate });
  const entryId = options.entryId ?? "00000000-0000-4000-8000-000000000001";
  return {
    origin: "app",
    id: occurrenceDate === null ? entryId : `${entryId}/${occurrenceDate}`,
    entryId,
    revision: options.revision ?? 3,
    entry,
    occurrenceDate,
    override: options.override ?? null,
    kind: shown.kind,
    icon: shown.icon,
    title: shown.title,
    childIds: shown.childIds,
    allDay: shown.allDay,
    ...times(shown),
    date: shown.date,
    ...(shown.slot === undefined ? {} : { slot: shown.slot }),
    bring: shown.bring,
    countdown: shown.countdown,
  };
}

export function googleItem(
  overrides: Partial<EditorGoogleItem> = {},
): EditorGoogleItem {
  return {
    origin: "google",
    id: "g-piano",
    sourceId: "family",
    iconIsFallback: false,
    kind: "event",
    icon: "🎹",
    title: "Piano",
    childIds: ["ben"],
    allDay: false,
    start: "2026-11-23T16:30:00+01:00",
    end: "2026-11-23T17:15:00+01:00",
    date: "2026-11-23",
    bring: [],
    countdown: false,
    ...overrides,
  };
}

export function listResponse(
  overrides: Partial<EditorListResponse> = {},
): EditorListResponse {
  return {
    timeZone: "Europe/Berlin",
    range: { from: TODAY, to: "2026-12-06" },
    sources: [{ id: "family", status: "ok" }],
    items: [],
    unresolved: [],
    storageUnavailable: false,
    ...overrides,
  };
}

export function template(
  overrides: Partial<EditorTemplate> = {},
): EditorTemplate {
  return {
    kind: "event",
    icon: "⚽",
    title: "Football",
    childIds: ["ben"],
    allDay: false,
    startTime: "16:00",
    endTime: "17:00",
    bring: ["👟"],
    countdown: false,
    count: 4,
    origins: ["app"],
    ...overrides,
  };
}

export function writeResponse(entry: AppEntryDto | null): {
  entry: AppEntryDto | null;
  boardRefresh: "now";
} {
  return { entry, boardRefresh: "now" };
}
