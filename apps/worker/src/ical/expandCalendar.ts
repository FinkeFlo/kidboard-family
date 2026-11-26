import {
  formatCalendarDate,
  formatInstant,
  isValidTimeZone,
  naiveUtcMs,
  parseCalendarDate,
  shiftCalendarDate,
  startOfDayMs,
  type WallTime,
  wallTimeAt,
  wallTimeToEpochMs,
} from "@kidboard/shared";
import ICAL from "ical.js";

import { FeedParseError } from "./errors";
import { fastForwardStart } from "./fastForward";

/** One concrete occurrence of a VEVENT inside the requested window. */
export interface Occurrence {
  uid: string;
  /**
   * Original start of this instance for recurring series (and RECURRENCE-ID overrides),
   * formatted like `start`; `null` for non-recurring events. Stable across runs.
   */
  recurrenceId: string | null;
  summary: string;
  description: string;
  /** Timed: ISO 8601 with the configured zone's offset. All-day: `YYYY-MM-DD`. */
  start: string;
  /** Exclusive end, same format as `start`. */
  end: string;
  allDay: boolean;
}

/** Something the caller may want to log or surface; never contains feed text except the UID. */
export type ExpandWarning =
  /** A series hit `maxIterations`; its instances after that point are missing. */
  | { code: "iteration-cap"; uid: string }
  /** The feed-wide `maxTotalIterations` budget ran out; later series are missing or cut. */
  | { code: "iteration-budget" }
  /** A single VEVENT could not be interpreted (e.g. an unparsable DTEND) and was skipped. */
  | { code: "invalid-event"; uid: string };

export interface ExpandResult {
  /** Occurrences overlapping the window, sorted by start (deterministic). */
  occurrences: Occurrence[];
  warnings: ExpandWarning[];
  /** True if an iteration cap or the budget was hit, i.e. occurrences may be missing. */
  truncated: boolean;
}

export interface ExpandOptions {
  /** First day of the window, `YYYY-MM-DD` in `timeZone` (inclusive). */
  from: string;
  /** Day after the last day of the window, `YYYY-MM-DD` in `timeZone` (exclusive). */
  to: string;
  /** Configured IANA zone: output offsets, window bounds and floating times. */
  timeZone: string;
  /** Recurrence iterations per series (default {@link DEFAULT_MAX_ITERATIONS}). */
  maxIterations?: number;
  /** Recurrence iterations for the whole feed (default {@link DEFAULT_MAX_TOTAL_ITERATIONS}). */
  maxTotalIterations?: number;
  /**
   * Fast-forwarding and floating wall-time iteration (default true). `false` runs the
   * plain full iteration from DTSTART in the feed's zones; it exists as the reference
   * for the differential tests.
   */
  optimize?: boolean;
}

/**
 * Iteration cap per recurring series (ADR-0003). Bounds CPU for rules that cannot be
 * fast-forwarded (COUNT, sub-daily, exotic BY-parts), e.g. an unbounded FREQ=MINUTELY.
 */
export const DEFAULT_MAX_ITERATIONS = 10_000;

/** Iteration budget for one feed across all series (ADR-0003). */
export const DEFAULT_MAX_TOTAL_ITERATIONS = 50_000;

interface Window {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  timeZone: string;
  /**
   * Wall-clock bounds (fields read as UTC) widened by {@link NAIVE_MARGIN_MS}: any
   * wall time outside them is outside the window in every zone (offsets are within
   * -12 h…+14 h), which lets the expansion loop skip exact zone conversions.
   */
  naiveFrom: number;
  naiveTo: number;
}

const NAIVE_MARGIN_MS = 86_400_000;

interface Built {
  sortMs: number;
  occurrence: Occurrence;
}

interface Context {
  window: Window;
  maxIterations: number;
  budget: { remaining: number };
  optimize: boolean;
  out: Built[];
  warnings: ExpandWarning[];
}

/**
 * Parses an iCalendar feed and expands all VEVENTs (RRULE/RDATE/EXDATE, RECURRENCE-ID
 * overrides) into the occurrences that overlap `[from, to)` in `timeZone`, sorted by
 * start. Cancelled events and cancelled instances are dropped.
 *
 * Time zones (see ADR-0003 and `zonedTime.ts`): a TZID that the runtime knows as an
 * IANA zone is converted with the runtime tz database, whether or not the feed carries
 * a VTIMEZONE for it. Non-IANA TZIDs use the feed's VTIMEZONE through ical.js. Floating
 * times and TZIDs that are neither IANA nor defined in the feed use `timeZone`.
 *
 * @throws FeedParseError if the input is empty, not iCalendar, or malformed.
 * @throws RangeError if the options are invalid (programming error, not feed content).
 */
export function expandCalendar(
  icsText: string,
  opts: ExpandOptions,
): ExpandResult {
  const window = resolveWindow(opts);
  const maxIterations = positiveInteger(
    opts.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    "maxIterations",
  );
  const maxTotal = positiveInteger(
    opts.maxTotalIterations ?? DEFAULT_MAX_TOTAL_ITERATIONS,
    "maxTotalIterations",
  );

  const context: Context = {
    window,
    maxIterations,
    budget: { remaining: maxTotal },
    optimize: opts.optimize ?? true,
    out: [],
    warnings: [],
  };
  for (const calendar of parseFeed(icsText)) {
    expandVCalendar(calendar, context);
  }

  context.out.sort(compareBuilt);
  return {
    occurrences: context.out.map(({ occurrence }) => occurrence),
    warnings: context.warnings,
    truncated: context.warnings.some((w) => w.code !== "invalid-event"),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function resolveWindow(opts: ExpandOptions): Window {
  if (!isValidTimeZone(opts.timeZone)) {
    throw new RangeError("timeZone must be a valid IANA time zone");
  }
  const from = parseCalendarDate(opts.from);
  const to = parseCalendarDate(opts.to);
  if (from === null || to === null) {
    throw new RangeError("from and to must be YYYY-MM-DD dates");
  }
  if (opts.from >= opts.to) {
    throw new RangeError("from must be before to");
  }
  const midnight = { hour: 0, minute: 0, second: 0 };
  return {
    from: opts.from,
    to: opts.to,
    fromMs: startOfDayMs(from, opts.timeZone),
    toMs: startOfDayMs(to, opts.timeZone),
    timeZone: opts.timeZone,
    naiveFrom: naiveUtcMs({ ...from, ...midnight }) - NAIVE_MARGIN_MS,
    naiveTo: naiveUtcMs({ ...to, ...midnight }) + NAIVE_MARGIN_MS,
  };
}

function parseFeed(icsText: string): ICAL.Component[] {
  const text = icsText.replace(/^\uFEFF/, "").trim();
  if (text === "") {
    throw new FeedParseError("empty");
  }
  // Cheap pre-check: HTML error pages, JSON, login pages etc. are not iCalendar.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!/^BEGIN:VCALENDAR\s*$/i.test(firstLine)) {
    throw new FeedParseError("not-ics");
  }

  let jcal: unknown;
  try {
    // ical.js decodes all values here, so an invalid RRULE or DTSTART fails the feed.
    jcal = ICAL.parse(text);
  } catch {
    // The parser message quotes feed lines: never propagate it (see FeedParseError).
    throw new FeedParseError("malformed");
  }

  // ical.js returns one jCal component, or an array of them for multiple roots.
  if (!Array.isArray(jcal) || jcal.length === 0) {
    throw new FeedParseError("malformed");
  }
  const roots: unknown[] = typeof jcal[0] === "string" ? [jcal] : jcal;
  const calendars: ICAL.Component[] = [];
  for (const root of roots) {
    if (!Array.isArray(root)) {
      throw new FeedParseError("malformed");
    }
    const component = new ICAL.Component(root);
    if (component.name === "vcalendar") {
      calendars.push(component);
    }
  }
  if (calendars.length === 0) {
    throw new FeedParseError("not-ics");
  }
  return calendars;
}

function expandVCalendar(calendar: ICAL.Component, context: Context): void {
  const masters = new Map<string, ICAL.Component[]>();
  const exceptions = new Map<string, Map<string, ICAL.Event>>();
  const standalone: ICAL.Component[] = [];

  for (const component of calendar.getAllSubcomponents("vevent")) {
    if (!component.hasProperty("dtstart")) {
      continue; // Invalid for our purposes (RFC 5545 requires DTSTART without METHOD).
    }
    const uid = textProp(component, "uid");
    if (uid === "") {
      standalone.push(component);
    } else if (component.hasProperty("recurrence-id")) {
      guarded(context, uid, () => {
        addException(exceptions, uid, toEvent(component), context);
      });
    } else {
      const list = masters.get(uid) ?? [];
      list.push(component);
      masters.set(uid, list);
    }
  }

  for (const component of standalone) {
    guarded(context, "", () => {
      expandMaster(toEvent(component), [], context);
    });
  }
  for (const [uid, components] of masters) {
    const related = [...(exceptions.get(uid)?.values() ?? [])];
    for (const component of components) {
      guarded(context, uid, () => {
        expandMaster(toEvent(component), related, context);
      });
    }
  }
  // Overrides are emitted from their own DTSTART/DTEND, independent of the master's
  // iteration: this covers instances moved into the window from outside it, and
  // overrides whose master is not in the feed (single shared instance).
  for (const [uid, byId] of exceptions) {
    for (const exception of byId.values()) {
      guarded(context, uid, () => {
        const recurrenceId = formatRecurrenceId(
          exception.recurrenceId,
          tzidParam(exception.component.getFirstProperty("recurrence-id")),
          context.window,
        );
        emit(
          exception,
          exception.startDate,
          exception.endDate,
          startHint(exception),
          endHint(exception),
          recurrenceId,
          context.window,
          context.out,
        );
      });
    }
  }
}

/**
 * Wraps a VEVENT. Without `exceptions`, ical.js's Event constructor scans every VEVENT
 * of the calendar and relates *all* RECURRENCE-ID components to it regardless of UID
 * (O(n²), and wrong for `getOccurrenceDetails`); exceptions are related explicitly.
 */
function toEvent(component: ICAL.Component): ICAL.Event {
  return new ICAL.Event(component, { exceptions: [] });
}

/**
 * A single VEVENT that ical.js rejects lazily (e.g. an unparsable DTEND) or whose rule
 * never matches ({@link UnsatisfiableRuleError}) must not hide the rest of the feed: its
 * occurrences are discarded and it is reported.
 */
function guarded(context: Context, uid: string, fn: () => void): void {
  const mark = context.out.length;
  try {
    fn();
  } catch (error) {
    context.out.length = mark;
    if (error instanceof BudgetExhaustedError) {
      addBudgetWarning(context);
    } else {
      context.warnings.push({ code: "invalid-event", uid });
    }
  }
}

function addBudgetWarning(context: Context): void {
  if (!context.warnings.some((w) => w.code === "iteration-budget")) {
    context.warnings.push({ code: "iteration-budget" });
  }
}

/** A rule needed more than {@link MAX_CHECKS_PER_INSTANCE} candidates for one instance. */
class UnsatisfiableRuleError extends Error {}

/** The feed-wide budget ran out inside ical.js. */
class BudgetExhaustedError extends Error {}

/**
 * Candidates ical.js may test for a single instance. Its `RecurIterator#next` loops
 * until a candidate passes the BY-part filters (`check_contracting_rules`) and, for
 * SECONDLY…WEEKLY rules (and MONTHLY with only some months valid), has no exit for
 * rules that can never match, e.g. `FREQ=DAILY;INTERVAL=7;BYDAY=MO` with a Tuesday
 * DTSTART or `FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30`. Such a call never returns, and
 * workerd's clock does not advance during CPU work, so time limits cannot catch it.
 * Each check costs ~10 µs; 5 000 covers gaps of almost 14 years between daily
 * candidates (e.g. Feb 29 on a given weekday).
 */
const MAX_CHECKS_PER_INSTANCE = 5_000;

/**
 * Makes the iterators created from `rule` (our own copy, or the parsed value of this
 * feed) count candidate checks: per instance against {@link MAX_CHECKS_PER_INSTANCE},
 * and against the feed-wide budget. Only public, typed methods of the instances are
 * wrapped; nothing global is patched. `check_contracting_rules` is an undocumented
 * ical.js internal: ical.js is pinned and the canary test in `expandCalendar.test.ts`
 * verifies the guard is effective (ADR-0003). Exported for that test; `stats` counts
 * all checks.
 */
export function guardRule(
  rule: ICAL.Recur,
  budget: { remaining: number },
  stats?: { checks: number },
): void {
  const createIterator = rule.iterator.bind(rule);
  rule.iterator = (aStart: ICAL.Time): ICAL.RecurIterator => {
    const iterator = createIterator(aStart);
    const check = iterator.check_contracting_rules.bind(iterator);
    const next = iterator.next.bind(iterator);
    let checks = 0;
    iterator.check_contracting_rules = (): boolean => {
      if (stats !== undefined) {
        stats.checks++;
      }
      if (++checks > MAX_CHECKS_PER_INSTANCE) {
        throw new UnsatisfiableRuleError();
      }
      if (--budget.remaining < 0) {
        throw new BudgetExhaustedError();
      }
      return check();
    };
    iterator.next = (again?: boolean): ICAL.Time => {
      checks = 0;
      return next(again);
    };
    return iterator;
  };
}

function addException(
  exceptions: Map<string, Map<string, ICAL.Event>>,
  uid: string,
  exception: ICAL.Event,
  context: Context,
): void {
  const byId = exceptions.get(uid) ?? new Map<string, ICAL.Event>();
  const key = instanceKey(
    exception.recurrenceId,
    tzidParam(exception.component.getFirstProperty("recurrence-id")),
    context.window.timeZone,
  );
  const existing = byId.get(key);
  // Duplicate overrides of the same instance: the highest SEQUENCE wins.
  if (existing === undefined || exception.sequence > existing.sequence) {
    byId.set(key, exception);
  }
  exceptions.set(uid, byId);
}

/**
 * Identity of an instance for matching EXDATE and RECURRENCE-ID: the absolute instant
 * for date-times (so a UTC RECURRENCE-ID matches a TZID series even when ical.js could
 * not resolve the TZID), the calendar date for dates.
 */
function instanceKey(
  time: ICAL.Time,
  tzid: string | null,
  configZone: string,
): string {
  return keyOf(time, time.isDate ? null : toEpochMs(time, tzid, configZone));
}

/** {@link instanceKey} with the instant already known (null for dates). */
function keyOf(time: ICAL.Time, epochMs: number | null): string {
  return epochMs === null
    ? `D${formatCalendarDate(time)}`
    : `T${String(epochMs)}`;
}

interface Series {
  /** Component that is iterated: a clone with EXDATE removed and RDATE periods split. */
  iterated: ICAL.Event;
  /** TZID hint for the iterated times. */
  hint: string | null;
  /** End of RDATE;VALUE=PERIOD instances, by {@link periodKey} of their start. */
  periodEnds: Map<string, { end: ICAL.Time; hint: string | null }>;
  /** Cleared EXDATE keys ({@link instanceKey}); `D` keys also match timed instances. */
  excluded: Set<string>;
}

function expandMaster(
  master: ICAL.Event,
  related: ICAL.Event[],
  context: Context,
): void {
  const { window } = context;
  if (!master.isRecurring()) {
    emit(
      master,
      master.startDate,
      master.endDate,
      startHint(master),
      endHint(master),
      null,
      window,
      context.out,
    );
    return;
  }

  const hasRangeOverride = related.some((e) => e.modifiesFuture());
  const series = prepareSeries(master, hasRangeOverride, context);
  const { iterated, hint } = series;
  const directKeys = new Set<string>();
  for (const exception of related) {
    directKeys.add(
      instanceKey(
        exception.recurrenceId,
        tzidParam(exception.component.getFirstProperty("recurrence-id")),
        window.timeZone,
      ),
    );
  }
  if (hasRangeOverride) {
    for (const exception of related) {
      iterated.relateException(exception);
    }
  }
  // ical.js derives ends as start + duration in the start's zone; the master's
  // duration is taken from the original component (the clone may be floating).
  const duration = master.duration;
  const durationMs = Math.max(0, duration.toSeconds() * 1000);

  const emitInstance = (
    start: ICAL.Time,
    key: string,
    startMs: number | null,
  ): void => {
    if (directKeys.has(key) || isExcluded(series, start, key)) {
      return; // EXDATE, or overridden: emitted from the override itself.
    }
    const periodEnd = series.periodEnds.get(periodKey(start));
    let item = master;
    let itemStart = start;
    let end: ICAL.Time;
    let startTzid = hint;
    let endTzid = hint;
    if (hasRangeOverride) {
      // RANGE=THISANDFUTURE overrides shift and re-time later instances.
      const details = iterated.getOccurrenceDetails(start);
      if (details.item !== iterated) {
        item = details.item;
        startTzid = startHint(item);
        endTzid = startTzid;
      }
      itemStart = details.startDate;
      end = details.endDate;
    } else {
      end = start.clone();
      end.addDuration(duration);
    }
    if (periodEnd !== undefined && item === master) {
      end = periodEnd.end;
      endTzid = periodEnd.hint;
    }
    const recurrenceId =
      startMs === null
        ? formatCalendarDate(start)
        : formatInstant(startMs, window.timeZone);
    emit(
      item,
      itemStart,
      end,
      startTzid,
      endTzid,
      recurrenceId,
      window,
      context.out,
      itemStart === start ? startMs : null,
    );
  };

  // RFC 5545: DTSTART is always the first instance of the recurrence set. ical.js's
  // RecurExpansion only yields it through an RRULE iterator, so an RDATE-only event
  // needs it added here (unless excluded by EXDATE or listed again as an RDATE).
  const seen = new Set<string>();
  const rdateOnly = !iterated.component.hasProperty("rrule");
  if (rdateOnly) {
    const start = iterated.startDate;
    const startMs = start.isDate
      ? null
      : toEpochMs(start, hint, window.timeZone);
    const key = keyOf(start, startMs);
    seen.add(key);
    emitInstance(start, key, startMs);
  }

  const expansion = iterated.iterator();
  for (let iteration = 0; ; iteration++) {
    if (context.budget.remaining <= 0) {
      addBudgetWarning(context);
      return;
    }
    context.budget.remaining--;

    const next = nextOccurrence(expansion);
    if (next === null) {
      return;
    }
    if (iteration >= context.maxIterations) {
      // A further instance exists beyond the cap.
      context.warnings.push({ code: "iteration-cap", uid: master.uid });
      return;
    }
    const naive = naiveUtcMs(next);
    if (naive >= window.naiveTo) {
      // Certainly past the window; occurrences come in ascending order (within less
      // than the margin even when ical.js compares zones approximately).
      return;
    }
    if (!hasRangeOverride && naive + durationMs < window.naiveFrom) {
      continue; // Certainly ends before the window.
    }
    const startMs = next.isDate ? null : toEpochMs(next, hint, window.timeZone);
    const key = keyOf(next, startMs);
    if (rdateOnly && seen.has(key)) {
      continue;
    }
    emitInstance(next, key, startMs);
  }
}

/**
 * Builds what ical.js iterates. Without RANGE overrides this is a minimal VEVENT with
 * only DTSTART, RRULE and RDATE (cheaper than cloning the component):
 * - EXDATEs are left out and applied by {@link isExcluded} on absolute instants, which
 *   stays correct when ical.js treats an unresolved TZID as floating.
 * - RDATE;VALUE=PERIOD values become plain start times; their ends are kept aside
 *   (RFC 5545 §3.8.5.2: a period defines that instance's own end).
 * - With `optimize`, a timed series in an IANA zone (or floating) is rewritten to
 *   floating wall time in that zone: ical.js then compares times without evaluating
 *   VTIMEZONE rules, and UNTIL/RDATE are converted to the same wall clock so that
 *   comparisons are exact. DTSTART keeps its wall-clock fields.
 * - With `optimize`, DTSTART is fast-forwarded by whole periods (see `fastForward.ts`).
 *
 * With RANGE=THISANDFUTURE overrides the original event is iterated unchanged, because
 * `getOccurrenceDetails` needs its full state; EXDATEs are then also applied by ical.js,
 * which is harmless.
 */
function prepareSeries(
  master: ICAL.Event,
  hasRangeOverride: boolean,
  context: Context,
): Series {
  const { window } = context;
  const original = master.component;
  const start = master.startDate;
  const startTzid = startHint(master);
  const optimize = context.optimize && !hasRangeOverride;
  const floatingZone = optimize
    ? floatingSeriesZone(start, startTzid, window.timeZone)
    : null;
  const hint = floatingZone ?? startTzid;

  const excluded = new Set<string>();
  for (const property of original.getAllProperties("exdate")) {
    const exdateTzid = tzidParam(property);
    for (const value of timeValues(property)) {
      excluded.add(instanceKey(value, exdateTzid, window.timeZone));
    }
  }

  const toSeriesTime = (time: ICAL.Time, tzid: string | null): ICAL.Time => {
    if (floatingZone === null || time.isDate) {
      return time;
    }
    const zoneName =
      time.zone === ICAL.Timezone.localTimezone ? tzid : time.zone.tzid;
    const wall =
      zoneName === floatingZone
        ? wallOf(time)
        : wallTimeAt(toEpochMs(time, tzid, window.timeZone), floatingZone);
    return floatingTime(wall);
  };

  const periodEnds: Series["periodEnds"] = new Map();
  const rdates: ICAL.Time[] = [];
  for (const property of original.getAllProperties("rdate")) {
    const rdateTzid = tzidParam(property);
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Period) {
        const rdateStart = toSeriesTime(value.start, rdateTzid);
        periodEnds.set(periodKey(rdateStart), {
          end: toSeriesTime(value.getEnd(), rdateTzid),
          hint: floatingZone ?? rdateTzid,
        });
        rdates.push(rdateStart);
      } else if (value instanceof ICAL.Time) {
        rdates.push(toSeriesTime(value, rdateTzid));
      }
    }
  }

  // UNTIL must be on the clock of the iterated DTSTART: ical.js compares a floating
  // DTSTART (floating, rewritten to floating, or a TZID it could not resolve) with a
  // UTC UNTIL without any offset.
  const untilZone =
    floatingZone ??
    (start.isDate || start.zone !== ICAL.Timezone.localTimezone
      ? null
      : startTzid !== null && isIanaZone(startTzid)
        ? startTzid
        : window.timeZone);
  const prepareRule = (rule: ICAL.Recur): void => {
    const until = rule.until;
    if (
      untilZone !== null &&
      until !== null &&
      !until.isDate &&
      until.zone !== ICAL.Timezone.localTimezone
    ) {
      rule.until = floatingTime(
        wallTimeAt(toEpochMs(until, null, window.timeZone), untilZone),
      );
    }
    guardRule(rule, context.budget);
  };

  if (hasRangeOverride) {
    // Iterated in place: adjust this feed's own parsed rule values.
    for (const property of original.getAllProperties("rrule")) {
      const value = property.getFirstValue();
      if (value instanceof ICAL.Recur) {
        prepareRule(value);
      }
    }
    return { iterated: master, hint, periodEnds, excluded };
  }

  const rules: ICAL.Recur[] = [];
  for (const property of original.getAllProperties("rrule")) {
    const value = property.getFirstValue();
    if (value instanceof ICAL.Recur) {
      const rule = value.clone();
      prepareRule(rule);
      rules.push(rule);
    }
  }

  let newStart = floatingZone === null ? start : floatingTime(wallOf(start));
  const [onlyRule] = rules;
  const plainZone =
    floatingZone !== null || start.isDate || isUtcZone(start.zone);
  if (optimize && plainZone && rules.length === 1 && onlyRule !== undefined) {
    const shifted = fastForwardStart(
      onlyRule,
      wallOf(start),
      window.naiveFrom - Math.max(0, master.duration.toSeconds() * 1000),
    );
    if (shifted !== null) {
      newStart = ICAL.Time.fromData(
        { ...shifted, isDate: start.isDate },
        newStart.zone,
      );
    }
  }

  const component = new ICAL.Component("vevent", original.parent);
  component.addPropertyWithValue("dtstart", newStart);
  for (const rule of rules) {
    component.addPropertyWithValue("rrule", rule);
  }
  for (const rdate of rdates) {
    component.addPropertyWithValue("rdate", rdate);
  }
  return { iterated: toEvent(component), hint, periodEnds, excluded };
}

/**
 * Zone a timed series can be iterated in as floating wall time: its IANA zone, or the
 * configured zone for floating/unknown TZIDs. Null for UTC (already cheap), dates and
 * non-IANA VTIMEZONEs (left to ical.js).
 */
function floatingSeriesZone(
  start: ICAL.Time,
  tzid: string | null,
  configZone: string,
): string | null {
  if (start.isDate || isUtcZone(start.zone)) {
    return null;
  }
  const resolved = start.zone !== ICAL.Timezone.localTimezone;
  const name = resolved ? start.zone.tzid : tzid;
  if (name !== null && isIanaZone(name)) {
    return name;
  }
  return resolved ? null : configZone;
}

function isExcluded(series: Series, start: ICAL.Time, key: string): boolean {
  if (series.excluded.has(key)) {
    return true;
  }
  // A DATE EXDATE on a DATE-TIME series excludes that whole local day (as ical.js does).
  return !start.isDate && series.excluded.has(`D${formatCalendarDate(start)}`);
}

function periodKey(time: ICAL.Time): string {
  return `${time.zone.tzid}|${time.toString()}`;
}

function timeValues(property: ICAL.Property): ICAL.Time[] {
  const values: ICAL.Time[] = [];
  for (const value of property.getValues()) {
    if (value instanceof ICAL.Time) {
      values.push(value);
    } else if (value instanceof ICAL.Period) {
      values.push(value.start);
    }
  }
  return values;
}

/**
 * `RecurExpansion#next` is typed as returning `Time`, but returns null once the set is
 * exhausted, and a `Period` for RDATE;VALUE=PERIOD values (which `prepareSeries`
 * already splits into plain start times; mapped to the start defensively).
 */
function nextOccurrence(expansion: ICAL.RecurExpansion): ICAL.Time | null {
  const value: unknown = expansion.next();
  if (value instanceof ICAL.Period) {
    return value.start;
  }
  return value instanceof ICAL.Time ? value : null;
}

function wallOf(time: ICAL.Time): WallTime {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  };
}

function floatingTime(wall: WallTime): ICAL.Time {
  return ICAL.Time.fromData(
    { ...wall, isDate: false },
    ICAL.Timezone.localTimezone,
  );
}

function emit(
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  startTzid: string | null,
  endTzid: string | null,
  recurrenceId: string | null,
  window: Window,
  out: Built[],
  knownStartMs: number | null = null,
): void {
  const text = eventText(item);
  if (text.cancelled) {
    return;
  }
  const base = {
    uid: text.uid,
    recurrenceId,
    summary: text.summary,
    description: text.description,
  };

  if (start.isDate) {
    const startDate = formatCalendarDate(start);
    let endDate = formatCalendarDate(end);
    if (endDate <= startDate) {
      endDate = formatCalendarDate(shiftCalendarDate(start, 1)); // Zero/negative length → 1 day.
    }
    if (startDate < window.to && endDate > window.from) {
      out.push({
        sortMs: startOfDayMs(start, window.timeZone),
        occurrence: { ...base, start: startDate, end: endDate, allDay: true },
      });
    }
    return;
  }

  // Cheap wall-clock pre-filter before exact zone conversion (see Window).
  const startNaive = naiveUtcMs(start);
  const endNaive = end.isDate ? startNaive : naiveUtcMs(end);
  if (
    startNaive >= window.naiveTo ||
    Math.max(startNaive, endNaive) < window.naiveFrom
  ) {
    return;
  }
  const startMs = knownStartMs ?? toEpochMs(start, startTzid, window.timeZone);
  const endMs = Math.max(
    startMs,
    end.isDate ? startMs : toEpochMs(end, endTzid, window.timeZone),
  );
  const overlaps =
    startMs < window.toMs &&
    (endMs > window.fromMs ||
      // Zero-length events count as "at" their start instant.
      (endMs === startMs && startMs >= window.fromMs));
  if (overlaps) {
    out.push({
      sortMs: startMs,
      occurrence: {
        ...base,
        start: formatInstant(startMs, window.timeZone),
        end: formatInstant(endMs, window.timeZone),
        allDay: false,
      },
    });
  }
}

interface EventText {
  uid: string;
  summary: string;
  description: string;
  cancelled: boolean;
}

const textCache = new WeakMap<ICAL.Event, EventText>();

/** Text fields of an event, decoded once per event (series emit many instances). */
function eventText(event: ICAL.Event): EventText {
  let text = textCache.get(event);
  if (text === undefined) {
    const component = event.component;
    text = {
      uid: textProp(component, "uid"),
      summary: textProp(component, "summary"),
      description: textProp(component, "description"),
      cancelled: textProp(component, "status").toUpperCase() === "CANCELLED",
    };
    textCache.set(event, text);
  }
  return text;
}

function formatRecurrenceId(
  time: ICAL.Time,
  tzid: string | null,
  window: Window,
): string {
  return time.isDate
    ? formatCalendarDate(time)
    : formatInstant(toEpochMs(time, tzid, window.timeZone), window.timeZone);
}

const ianaCache = new Map<string, boolean>();

function isIanaZone(name: string): boolean {
  let known = ianaCache.get(name);
  if (known === undefined) {
    known = isValidTimeZone(name);
    ianaCache.set(name, known);
  }
  return known;
}

function isUtcZone(zone: ICAL.Timezone): boolean {
  return zone === ICAL.Timezone.utcTimezone || zone.tzid === "UTC";
}

/**
 * Absolute instant of an ical.js date-time.
 *
 * `tzid` is the TZID parameter of the property the time came from: ical.js turns a
 * TZID it cannot resolve (no VTIMEZONE in the feed, which Google sometimes omits) into
 * a floating time and loses the name, so it is passed alongside.
 */
function toEpochMs(
  time: ICAL.Time,
  tzid: string | null,
  configZone: string,
): number {
  const zone = time.zone;
  const wall = wallOf(time);
  if (isUtcZone(zone)) {
    return wallTimeToEpochMs(wall, "UTC");
  }
  const resolved = zone !== ICAL.Timezone.localTimezone;
  const name = resolved ? zone.tzid : tzid;
  if (name !== null && isIanaZone(name)) {
    return wallTimeToEpochMs(wall, name);
  }
  if (resolved) {
    // Non-IANA TZID defined by a VTIMEZONE in the feed: let ical.js apply its rules.
    return time.toUnixTime() * 1000;
  }
  // Floating time, or a TZID that is neither IANA nor defined in the feed.
  return wallTimeToEpochMs(wall, configZone);
}

function startHint(event: ICAL.Event): string | null {
  return tzidParam(event.component.getFirstProperty("dtstart"));
}

function endHint(event: ICAL.Event): string | null {
  const dtend = event.component.getFirstProperty("dtend");
  // Without DTEND, ical.js computes the end from DTSTART (+ DURATION) in its zone.
  return dtend === null ? startHint(event) : tzidParam(dtend);
}

function tzidParam(property: ICAL.Property | null): string | null {
  if (property === null) {
    return null;
  }
  const value: unknown = property.getParameter("tzid");
  return typeof value === "string" && value !== "" ? value : null;
}

function textProp(component: ICAL.Component, name: string): string {
  const value: unknown = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value : "";
}

function compareBuilt(a: Built, b: Built): number {
  if (a.sortMs !== b.sortMs) {
    return a.sortMs - b.sortMs;
  }
  const x = a.occurrence;
  const y = b.occurrence;
  if (x.allDay !== y.allDay) {
    return x.allDay ? -1 : 1;
  }
  const keys = [
    [x.end, y.end],
    [x.uid, y.uid],
    [x.recurrenceId ?? "", y.recurrenceId ?? ""],
    [x.summary, y.summary],
    [x.description, y.description],
  ] as const;
  for (const [left, right] of keys) {
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}
