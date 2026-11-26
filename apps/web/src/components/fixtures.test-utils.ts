import type { CalendarEvent, Child, Meal } from "@kidboard/shared";

export const MIA: Child = {
  id: "mia",
  name: "Mia",
  color: "child-1",
  avatar: "🦊",
};
export const BEN: Child = {
  id: "ben",
  name: "Ben",
  color: "#0072b2",
  avatar: "🐻",
};

export function eventFixture(
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: "e1",
    sourceId: "family",
    title: "Swimming",
    icon: "🏊",
    iconIsFallback: false,
    childIds: [],
    allDay: false,
    start: "2026-11-22T14:30:00+01:00",
    end: "2026-11-22T15:30:00+01:00",
    countdown: false,
    ...overrides,
  };
}

export function mealFixture(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m1",
    sourceId: "meals",
    date: "2026-11-22",
    slot: "lunch",
    title: "Pasta",
    icon: "🍝",
    iconIsFallback: false,
    ...overrides,
  };
}
