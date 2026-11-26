/*
 * Built-in icons of the parent editor (T-45): activities in six groups, things to bring
 * and dishes. Every icon is one emoji within the ADR-0011 baseline (Emoji 13.0; checked
 * by `catalogue.test.ts` and the UI baseline test). The labels live in the locale files
 * (`editor.activity.<id>`, `editor.bring.<id>`, `editor.dish.<id>`), so a picked icon
 * pre-fills the title in the tablet's language.
 */

export interface CatalogueIcon<Id extends string = string> {
  id: Id;
  icon: string;
}

export const ACTIVITY_GROUP_IDS = [
  "sport",
  "school",
  "play",
  "appointments",
  "outings",
  "celebrations",
] as const;
export type ActivityGroupId = (typeof ACTIVITY_GROUP_IDS)[number];

const ACTIVITY_LIST = [
  // Sport
  { id: "swimming", icon: "🏊", group: "sport" },
  { id: "football", icon: "⚽", group: "sport" },
  { id: "gymnastics", icon: "🤸", group: "sport" },
  { id: "ballet", icon: "🩰", group: "sport" },
  { id: "riding", icon: "🐴", group: "sport" },
  { id: "cycling", icon: "🚴", group: "sport" },
  { id: "tennis", icon: "🎾", group: "sport" },
  { id: "judo", icon: "🥋", group: "sport" },
  // School and kindergarten
  { id: "school", icon: "🏫", group: "school" },
  { id: "kindergarten", icon: "🧸", group: "school" },
  { id: "homework", icon: "✏️", group: "school" },
  { id: "music", icon: "🎵", group: "school" },
  { id: "library", icon: "📚", group: "school" },
  { id: "parentsEvening", icon: "👩‍🏫", group: "school" },
  { id: "schoolTrip", icon: "🚌", group: "school" },
  // Friends and play
  { id: "playdate", icon: "🧒", group: "play" },
  { id: "playground", icon: "🎠", group: "play" },
  { id: "sleepover", icon: "🛌", group: "play" },
  { id: "games", icon: "🎲", group: "play" },
  { id: "crafts", icon: "✂️", group: "play" },
  { id: "building", icon: "🧱", group: "play" },
  { id: "kite", icon: "🪁", group: "play" },
  // Appointments
  { id: "doctor", icon: "🩺", group: "appointments" },
  { id: "dentist", icon: "🦷", group: "appointments" },
  { id: "haircut", icon: "💇", group: "appointments" },
  { id: "vaccination", icon: "💉", group: "appointments" },
  { id: "optician", icon: "👓", group: "appointments" },
  { id: "therapy", icon: "🗣️", group: "appointments" },
  { id: "vet", icon: "🐾", group: "appointments" },
  // Outings
  { id: "zoo", icon: "🦁", group: "outings" },
  { id: "museum", icon: "🏛️", group: "outings" },
  { id: "cinema", icon: "🎬", group: "outings" },
  { id: "forest", icon: "🌲", group: "outings" },
  { id: "grandparents", icon: "👵", group: "outings" },
  { id: "farm", icon: "🐄", group: "outings" },
  { id: "train", icon: "🚆", group: "outings" },
  { id: "theatre", icon: "🎭", group: "outings" },
  // Celebrations
  { id: "birthday", icon: "🎂", group: "celebrations" },
  { id: "party", icon: "🎉", group: "celebrations" },
  { id: "presents", icon: "🎁", group: "celebrations" },
  { id: "christmas", icon: "🎄", group: "celebrations" },
  { id: "easter", icon: "🐣", group: "celebrations" },
  { id: "holiday", icon: "✈️", group: "celebrations" },
  { id: "wedding", icon: "💒", group: "celebrations" },
  { id: "lanterns", icon: "🏮", group: "celebrations" },
] as const satisfies readonly (CatalogueIcon & { group: ActivityGroupId })[];

export type ActivityId = (typeof ACTIVITY_LIST)[number]["id"];
export interface Activity extends CatalogueIcon<ActivityId> {
  group: ActivityGroupId;
}
export const ACTIVITIES: readonly Activity[] = ACTIVITY_LIST;

/** The activities of one group, in catalogue order. */
export function activitiesOf(group: ActivityGroupId): Activity[] {
  return ACTIVITIES.filter((activity) => activity.group === group);
}

const BRING_LIST = [
  { id: "shoes", icon: "👟" },
  { id: "swimsuit", icon: "🩱" },
  { id: "goggles", icon: "🥽" },
  { id: "sunscreen", icon: "🧴" },
  { id: "cap", icon: "🧢" },
  { id: "jacket", icon: "🧥" },
  { id: "umbrella", icon: "☂️" },
  { id: "snack", icon: "🥪" },
  { id: "drink", icon: "🥤" },
  { id: "books", icon: "📚" },
  { id: "pencil", icon: "✏️" },
  { id: "ruler", icon: "📏" },
  { id: "money", icon: "💶" },
  { id: "socks", icon: "🧦" },
  { id: "gloves", icon: "🧤" },
  { id: "present", icon: "🎁" },
] as const satisfies readonly CatalogueIcon[];

export type BringId = (typeof BRING_LIST)[number]["id"];
export const BRING_ITEMS: readonly CatalogueIcon<BringId>[] = BRING_LIST;

const DISH_LIST = [
  { id: "spaghetti", icon: "🍝" },
  { id: "pizza", icon: "🍕" },
  { id: "soup", icon: "🍲" },
  { id: "curry", icon: "🍛" },
  { id: "rice", icon: "🍚" },
  { id: "noodles", icon: "🍜" },
  { id: "pancakes", icon: "🥞" },
  { id: "waffles", icon: "🧇" },
  { id: "burger", icon: "🍔" },
  { id: "fries", icon: "🍟" },
  { id: "fish", icon: "🐟" },
  { id: "chicken", icon: "🍗" },
  { id: "salad", icon: "🥗" },
  { id: "sandwich", icon: "🥪" },
  { id: "sushi", icon: "🍣" },
  { id: "tacos", icon: "🌮" },
  { id: "wrap", icon: "🌯" },
  { id: "dumplings", icon: "🥟" },
  { id: "eggs", icon: "🍳" },
  { id: "muesli", icon: "🥣" },
  { id: "bread", icon: "🍞" },
  { id: "potatoes", icon: "🥔" },
  { id: "vegetables", icon: "🥕" },
  { id: "fruit", icon: "🍎" },
] as const satisfies readonly CatalogueIcon[];

export type DishId = (typeof DISH_LIST)[number]["id"];
export const DISHES: readonly CatalogueIcon<DishId>[] = DISH_LIST;

/**
 * Built-in quick picks of the "Again" row: an activity plus how it usually happens.
 * `time`: wall clock start (`null`: all day); `weekly`: repeats on the chosen day's
 * weekday; `countdown`: "count the sleeps".
 */
export interface QuickPick {
  id: "swimmingWeekly" | "birthday" | "dentist";
  activity: ActivityId;
  time: string | null;
  weekly: boolean;
  countdown: boolean;
}

export const QUICK_PICKS: readonly QuickPick[] = [
  {
    id: "swimmingWeekly",
    activity: "swimming",
    time: "15:00",
    weekly: true,
    countdown: false,
  },
  {
    id: "birthday",
    activity: "birthday",
    time: null,
    weekly: false,
    countdown: true,
  },
  {
    id: "dentist",
    activity: "dentist",
    time: "09:00",
    weekly: false,
    countdown: false,
  },
];

/** The activity of `id` (always defined for the ids of {@link QUICK_PICKS}). */
export function activityById(id: ActivityId): Activity {
  const found = ACTIVITIES.find((activity) => activity.id === id);
  if (found === undefined) {
    throw new Error(`Unknown activity ${id}`);
  }
  return found;
}
