/** Why a feed could not be parsed. */
export type FeedParseErrorReason = "empty" | "not-ics" | "malformed";

const MESSAGES: Record<FeedParseErrorReason, string> = {
  empty: "Calendar feed is empty",
  "not-ics": "Calendar feed is not an iCalendar (VCALENDAR) document",
  malformed: "Calendar feed is malformed and could not be parsed",
};

/**
 * Thrown when a feed body is not a parseable iCalendar document.
 *
 * The message is one of a fixed set of strings and never contains any part of the
 * feed: feed bodies may contain private data, and upstream error pages may echo the
 * secret feed URL. The underlying parser error is deliberately not attached as
 * `cause` for the same reason (ical.js error messages quote the offending line).
 */
export class FeedParseError extends Error {
  override readonly name = "FeedParseError";
  readonly reason: FeedParseErrorReason;

  constructor(reason: FeedParseErrorReason) {
    super(MESSAGES[reason]);
    this.reason = reason;
  }
}
