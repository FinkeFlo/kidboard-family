import { APP_NAME, type AppConfig } from "@kidboard/shared";
import ICAL from "ical.js";
import { tzlib_get_ical_block } from "timezones-ical-library";

import type { AppEntry } from "../entries/entryStore";
import { appEventComponents } from "../entries/renderCalendar";
import { logWarn } from "../log";

/** `PRODID` of the published phone feed. */
export const FEED_PRODID = "-//KidBoard//Phone feed//EN";

/**
 * Suggested poll interval for subscribers (RFC 7986 `REFRESH-INTERVAL`, plus the older
 * `X-PUBLISHED-TTL`). Only a hint: Google Calendar polls subscriptions on its own
 * schedule (hours).
 */
export const FEED_REFRESH_INTERVAL = "PT1H";

/** Zones already warned about (no VTIMEZONE available), once per isolate. */
const warnedZones = new Set<string>();

/**
 * The VTIMEZONE of an IANA zone from `timezones-ical-library` (tzdb data, vzic-style
 * rules), with its `TZID` set to `timeZone` (a link such as `Europe/Busingen` may come
 * back under its canonical name). `null` when the library does not know the zone or
 * the block does not parse.
 */
export function vtimezoneFor(timeZone: string): ICAL.Component | null {
  let block: string | undefined;
  try {
    const result = tzlib_get_ical_block(timeZone);
    block = Array.isArray(result) ? result[0] : result;
  } catch {
    block = undefined;
  }
  if (block === undefined || !block.includes("BEGIN:VTIMEZONE")) {
    return null;
  }
  let component: ICAL.Component;
  try {
    component = ICAL.Component.fromString(block);
  } catch {
    return null;
  }
  if (
    component.name !== "vtimezone" ||
    component.getAllSubcomponents().length === 0
  ) {
    return null;
  }
  component.updatePropertyWithValue("tzid", timeZone);
  if (component.hasProperty("x-lic-location")) {
    component.updatePropertyWithValue("x-lic-location", timeZone);
  }
  return component;
}

/**
 * The phone feed (ADR-0014 "Getting data out"): all app entries, events and meals in
 * one calendar (one subscription for parents; meals are all-day or timed per entry,
 * exactly as the board renders them), built from the same VEVENTs as the board's
 * virtual sources (`appEventComponents`), so a subscriber sees the board's
 * occurrences.
 *
 * Times stay wall-clock with `TZID` = the configured zone and series keep their
 * `RRULE`/`EXDATE`/`RECURRENCE-ID`. RFC 5545 requires a VTIMEZONE for every TZID;
 * Google and Apple map IANA names on their own, but other clients (e.g. Outlook) need
 * the definition, so the feed carries one (`X-WR-TIMEZONE` names the zone as well).
 * Without one (zone unknown to the library) the feed still works for Google and Apple
 * and a warning is logged once.
 */
export function renderAppFeed(
  entries: readonly AppEntry[],
  config: AppConfig,
): string {
  const timeZone = config.timeZone;
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("prodid", FEED_PRODID);
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  calendar.addPropertyWithValue("method", "PUBLISH");
  calendar.addPropertyWithValue("x-wr-calname", APP_NAME);
  calendar.addPropertyWithValue("x-wr-timezone", timeZone);
  calendar.addPropertyWithValue(
    "refresh-interval",
    ICAL.Duration.fromString(FEED_REFRESH_INTERVAL),
  );
  calendar.addPropertyWithValue("x-published-ttl", FEED_REFRESH_INTERVAL);

  const vtimezone = vtimezoneFor(timeZone);
  if (vtimezone === null) {
    if (!warnedZones.has(timeZone)) {
      warnedZones.add(timeZone);
      logWarn(
        `phone feed: no VTIMEZONE for "${timeZone}"; the feed relies on the TZID name`,
      );
    }
  } else {
    calendar.addSubcomponent(vtimezone);
  }

  for (const component of appEventComponents(
    entries,
    ["event", "meal"],
    config,
  )) {
    calendar.addSubcomponent(component);
  }
  return calendar.toString();
}
