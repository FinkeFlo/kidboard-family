import { tzOffset } from "@date-fns/tz";
import {
  addCalendarDays,
  type AgendaResponse,
  type CalendarEvent,
  isDateKey,
  type Meal,
  type MealSlot,
  type PublicConfig,
  todayInZone,
  type WeatherDay,
  type WeatherResponse,
} from "@kidboard/shared";

/*
 * Synthetic demo data for manual development (`pnpm dev:demo`) and the README screenshots
 * (`pnpm screenshots`). Everything is derived from "today" (a date key in the config zone),
 * so the board always shows a realistic week and the countdown never runs out. All content
 * is made up (Mia and Ben are example children); there are no calendar URLs and no real data.
 */

export const DEMO_TIME_ZONE = "Europe/Berlin";

export const DEMO_CHILDREN = [
  { id: "mia", name: "Mia", color: "child-1", avatar: "🦊" },
  { id: "ben", name: "Ben", color: "child-2", avatar: "🐻" },
] as const;

/** Agenda days the API serves: today plus the 30 days the countdown looks ahead. */
const AGENDA_DAYS = 31;
/** Days until the demo birthday party (what the countdown shows by default). */
export const DEMO_COUNTDOWN_DAYS = 6;

export interface DemoOptions {
  /** Nights until the countdown event (0 = today). Default {@link DEMO_COUNTDOWN_DAYS}. */
  countdownDays?: number;
}

export function demoConfig(): PublicConfig {
  return {
    locale: "auto",
    timeZone: DEMO_TIME_ZONE,
    children: DEMO_CHILDREN.map((child) => ({ ...child })),
    calendars: [
      { id: "family", kind: "events" },
      { id: "meals", kind: "meals" },
    ],
    bands: {
      morningStart: "06:00",
      middayStart: "11:00",
      eveningStart: "17:00",
    },
    nightMode: { enabled: true, start: "19:30", end: "06:30" },
    countdown: { emojis: ["🎂", "🎉", "🎁", "🎄", "🐣", "✈️", "🏖️"] },
    refreshMinutes: 60,
    autoReturnSeconds: 120,
    editor: false,
    weather: true,
  };
}

/** `HH:mm` or `null` (all-day), as in a weekly template. */
interface Slot {
  title: string;
  icon: string;
  time: string | null;
  childIds?: string[];
  /** Length in minutes (default 60). */
  minutes?: number;
  /** Bring list (as parsed from a `Mitbringen:` line, ADR-0010). */
  bring?: string[];
  /** The icon comes from the fallback table (a school subject without an emoji in its title). */
  fallbackIcon?: boolean;
  /** Takes place Monday to Friday only; on Saturday and Sunday {@link Slot.weekend} replaces it. */
  weekend?: Omit<Slot, "weekend">;
}

/** Saturday or Sunday; pure calendar math on the `YYYY-MM-DD` key, no time zone. */
function isWeekend(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * One entry per day of a repeating week, indexed by `offset % 7` from today (so today is
 * always the busy day). Weekday-only slots (kindergarten) carry a weekend replacement.
 */
/** What Mia packs for swimming (a school lesson in the demo week). */
const SWIM_BRING = ["🩱", "🧴", "🥽"];

const WEEK: Slot[][] = [
  // Today: events in every band; the early ones are over by midday.
  [
    {
      title: "Swimming",
      icon: "🏊",
      time: "07:30",
      childIds: ["mia"],
      bring: SWIM_BRING,
    },
    {
      title: "Kindergarten",
      icon: "🏫",
      time: "08:30",
      childIds: ["ben"],
      weekend: {
        title: "Pancake breakfast",
        icon: "🥞",
        time: "08:30",
        childIds: ["ben"],
      },
    },
    { title: "Lunch with Grandma", icon: "👵", time: "12:30" },
    {
      title: "Football",
      icon: "⚽",
      time: "15:00",
      childIds: ["ben"],
      bring: ["👟", "🧦"],
    },
    { title: "Piano", icon: "🎹", time: "16:30", childIds: ["mia"] },
    { title: "Bath time", icon: "🛁", time: "18:00" },
    { title: "Story time", icon: "📖", time: "20:15", minutes: 30 },
    {
      title: "Zoo trip",
      icon: "🦁",
      time: null,
      childIds: ["mia", "ben"],
      bring: ["🧢", "🥪"],
    },
  ],
  [
    {
      title: "Swimming",
      icon: "🏊",
      time: "07:30",
      childIds: ["mia"],
      bring: SWIM_BRING,
    },
    // Tomorrow's bring lists fill the 🎒 area from the evening before (T-36). The school
    // subjects carry no emoji in their title: their icons are the fallback ones (T-34).
    {
      title: "Math",
      icon: "🔢",
      fallbackIcon: true,
      time: "08:30",
      childIds: ["mia"],
      bring: ["📏", "✏️"],
      weekend: { title: "Playdate", icon: "🧸", time: "10:00" },
    },
    {
      title: "PE",
      icon: "👟",
      fallbackIcon: true,
      time: "10:00",
      childIds: ["ben"],
      bring: ["👟", "🩳"],
      weekend: { title: "Bike ride", icon: "🚲", time: "10:00" },
    },
    {
      title: "Art",
      icon: "🎨",
      fallbackIcon: true,
      time: "11:30",
      childIds: ["mia", "ben"],
      bring: ["👕"],
      weekend: { title: "Park picnic", icon: "🧺", time: "11:30" },
    },
    {
      title: "Library",
      icon: "📚",
      time: "15:30",
      childIds: ["ben", "mia"],
      bring: ["📕"],
    },
  ],
  [
    { title: "Dentist", icon: "🦷", time: "09:00", childIds: ["ben"] },
    { title: "Music class", icon: "🎻", time: "10:30", childIds: ["mia"] },
    { title: "Playground", icon: "🎠", time: "16:00" },
    { title: "Story time", icon: "📖", time: "19:00" },
  ],
  [{ title: "Playdate", icon: "🧸", time: "15:00", childIds: ["ben"] }],
  [
    {
      title: "Swimming",
      icon: "🏊",
      time: "07:30",
      childIds: ["mia"],
      bring: SWIM_BRING,
    },
    {
      title: "Football",
      icon: "⚽",
      time: "15:00",
      childIds: ["ben"],
      bring: ["👟", "🧦"],
    },
    { title: "Piano", icon: "🎹", time: "16:30", childIds: ["mia"] },
    { title: "Pizza night", icon: "🍕", time: "18:00" },
  ],
  [
    { title: "Farmers market", icon: "🥕", time: "10:00" },
    { title: "Bike ride", icon: "🚲", time: "14:00", childIds: ["mia", "ben"] },
  ],
  [
    { title: "Park picnic", icon: "🧺", time: "11:30" },
    { title: "Movie evening", icon: "🎬", time: "18:30" },
  ],
];

const MEAL_WEEK: { slot: MealSlot; title: string; icon: string }[][] = [
  [
    { slot: "breakfast", title: "Oatmeal with berries", icon: "🥣" },
    { slot: "lunch", title: "Spaghetti with tomato sauce", icon: "🍝" },
    { slot: "dinner", title: "Vegetable soup and bread", icon: "🍲" },
    { slot: "lunch", title: "Apple slices", icon: "🍎" },
  ],
  [
    { slot: "breakfast", title: "Toast with jam", icon: "🍞" },
    { slot: "lunch", title: "Rice with vegetables", icon: "🍚" },
    { slot: "dinner", title: "Potato wedges", icon: "🥔" },
  ],
  [
    { slot: "breakfast", title: "Muesli with yoghurt", icon: "🥛" },
    { slot: "lunch", title: "Fish fingers and peas", icon: "🐟" },
    { slot: "dinner", title: "Cheese sandwiches", icon: "🧀" },
  ],
  [
    { slot: "breakfast", title: "Scrambled eggs", icon: "🍳" },
    { slot: "lunch", title: "Pancakes", icon: "🥞" },
    { slot: "dinner", title: "Carrot soup", icon: "🥕" },
  ],
  [
    { slot: "breakfast", title: "Porridge with banana", icon: "🍌" },
    { slot: "lunch", title: "Lentil stew", icon: "🥘" },
    { slot: "dinner", title: "Pizza", icon: "🍕" },
  ],
  [
    { slot: "breakfast", title: "Bread rolls", icon: "🥐" },
    { slot: "lunch", title: "Macaroni and cheese", icon: "🧀" },
    { slot: "dinner", title: "Tomato salad", icon: "🍅" },
  ],
  [
    { slot: "breakfast", title: "Fruit salad", icon: "🍓" },
    { slot: "lunch", title: "Chicken with corn", icon: "🌽" },
    { slot: "dinner", title: "Pasta salad", icon: "🥗" },
  ],
];

/** Today's date key in {@link DEMO_TIME_ZONE} at `nowMs`. */
export function demoToday(nowMs: number): string {
  return todayInZone(nowMs, DEMO_TIME_ZONE);
}

/**
 * The day the demo agenda starts on for a request: its `from` query parameter when that
 * is a valid date key (as the worker honours it), else today at `nowMs`. So a browser
 * whose clock is set to another day (Playwright `page.clock`) gets an agenda for its own
 * day instead of a range mismatch (which the client rejects as an invalid response).
 */
export function demoAgendaStart(search: string, nowMs: number): string {
  const from = new URLSearchParams(search).get("from");
  return from !== null && isDateKey(from) ? from : demoToday(nowMs);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * ISO instant with offset for the wall-clock `time` (`HH:mm`) of `date` in `timeZone`.
 * The offset is looked up at the resulting instant, so DST days come out right (a time
 * inside a spring-forward gap lands an hour later, which is fine for demo data).
 */
export function isoInZone(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // First guess with the offset at the wall time read as UTC, then correct it once.
  const guess = wallAsUtc - tzOffset(timeZone, new Date(wallAsUtc)) * 60_000;
  const offset = tzOffset(timeZone, new Date(guess));
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Adds `minutes` to `HH:mm` (clamped to 23:59 so the demo never crosses midnight). */
function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const total = Math.min(hour * 60 + minute + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The demo agenda for `today` (`YYYY-MM-DD` in {@link DEMO_TIME_ZONE}) at `generatedAt`
 * (ISO instant): a repeating week of events and meals for 31 days, and one countdown
 * event ("Birthday party") `countdownDays` nights ahead. Valid against `AgendaResponseSchema`.
 */
export function demoAgenda(
  today: string,
  generatedAt: string,
  { countdownDays = DEMO_COUNTDOWN_DAYS }: DemoOptions = {},
): AgendaResponse {
  const events: CalendarEvent[] = [];
  const meals: Meal[] = [];
  const base = { sourceId: "family" } as const;
  for (let offset = 0; offset < AGENDA_DAYS; offset += 1) {
    const date = addCalendarDays(today, offset);
    const weekend = isWeekend(date);
    (WEEK[offset % 7] ?? []).forEach((template, index) => {
      const slot =
        weekend && template.weekend !== undefined ? template.weekend : template;
      const id = `demo-${String(offset)}-${String(index)}`;
      const childIds = slot.childIds ?? [];
      const bring = slot.bring === undefined ? {} : { bring: slot.bring };
      const iconIsFallback = slot.fallbackIcon ?? false;
      if (slot.time === null) {
        events.push({
          ...base,
          id,
          title: slot.title,
          icon: slot.icon,
          iconIsFallback,
          childIds,
          ...bring,
          allDay: true,
          start: date,
          end: addCalendarDays(date, 1),
          countdown: false,
        });
        return;
      }
      events.push({
        ...base,
        id,
        title: slot.title,
        icon: slot.icon,
        iconIsFallback,
        childIds,
        ...bring,
        allDay: false,
        start: isoInZone(date, slot.time, DEMO_TIME_ZONE),
        end: isoInZone(
          date,
          addMinutes(slot.time, slot.minutes ?? 60),
          DEMO_TIME_ZONE,
        ),
        countdown: false,
      });
    });
    (MEAL_WEEK[offset % 7] ?? []).forEach((meal, index) => {
      meals.push({
        id: `demo-meal-${String(offset)}-${String(index)}`,
        sourceId: "meals",
        date,
        slot: meal.slot,
        title: meal.title,
        icon: meal.icon,
        iconIsFallback: false,
      });
    });
  }
  const partyDate = addCalendarDays(today, countdownDays);
  events.push({
    ...base,
    id: "demo-countdown",
    title: "Birthday party",
    icon: "🎂",
    iconIsFallback: false,
    childIds: ["ben"],
    allDay: false,
    start: isoInZone(partyDate, "17:30", DEMO_TIME_ZONE),
    end: isoInZone(partyDate, "19:00", DEMO_TIME_ZONE),
    countdown: true,
  });
  return {
    generatedAt,
    timeZone: DEMO_TIME_ZONE,
    range: { from: today, to: addCalendarDays(today, AGENDA_DAYS) },
    stale: false,
    sources: [
      { id: "family", status: "ok", fetchedAt: generatedAt },
      { id: "meals", status: "ok", fetchedAt: generatedAt },
    ],
    events,
    meals,
  };
}

/** A forecast day without its date, as in {@link DEMO_WEATHER_DAYS}. */
type DemoWeatherDay = Omit<WeatherDay, "date">;

/**
 * Seven synthetic forecast days from today (°C): a mild, mostly sunny today (a jacket),
 * a cold rainy tomorrow (so the evening clothing row shows 🌂 👢 🧥, the knitted hat and
 * 🧤), then cloud, snow, sun, fog and showers, so every overview and week column has a
 * chip.
 */
export const DEMO_WEATHER_DAYS: readonly DemoWeatherDay[] = [
  {
    code: 1,
    tempMax: 12,
    tempMin: 4,
    feelsMin: 9,
    feelsMax: 11,
    rain: false,
    snow: false,
    uvMax: 2,
  },
  {
    code: 63,
    tempMax: 7,
    tempMin: 2,
    feelsMin: 1,
    feelsMax: 4,
    rain: true,
    snow: false,
    uvMax: 1,
  },
  {
    code: 3,
    tempMax: 9,
    tempMin: 3,
    feelsMin: 5,
    feelsMax: 7,
    rain: false,
    snow: false,
    uvMax: 1,
  },
  {
    code: 71,
    tempMax: 1,
    tempMin: -3,
    feelsMin: -5,
    feelsMax: -1,
    rain: false,
    snow: true,
    uvMax: 1,
  },
  {
    code: 2,
    tempMax: 10,
    tempMin: 2,
    feelsMin: 4,
    feelsMax: 8,
    rain: false,
    snow: false,
    uvMax: 2,
  },
  {
    code: 45,
    tempMax: 8,
    tempMin: 3,
    feelsMin: 4,
    feelsMax: 6,
    rain: false,
    snow: false,
    uvMax: 1,
  },
  {
    code: 80,
    tempMax: 9,
    tempMin: 4,
    feelsMin: 6,
    feelsMax: 7,
    rain: true,
    snow: false,
    uvMax: 1,
  },
];

/** The current temperature of the demo (today, °C). */
export const DEMO_CURRENT_TEMPERATURE = 8;

/**
 * The demo `/api/weather` answer for `today` (`YYYY-MM-DD` in {@link DEMO_TIME_ZONE}),
 * fetched at `fetchedAt` (ISO instant): {@link DEMO_WEATHER_DAYS} from today on. Valid
 * against `WeatherResponseSchema`; no place and no coordinates (as the worker's).
 */
export function demoWeather(today: string, fetchedAt: string): WeatherResponse {
  return {
    fetchedAt,
    unit: "celsius",
    current: { temperature: DEMO_CURRENT_TEMPERATURE, code: 1 },
    days: DEMO_WEATHER_DAYS.map((day, offset) => ({
      date: addCalendarDays(today, offset),
      ...day,
    })),
    stale: false,
  };
}
