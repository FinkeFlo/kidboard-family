import {
  addCalendarDays,
  type CalendarEvent,
  type Child,
  type EditorAppItem,
  type EditorGoogleItem,
  type EditorListItem,
  type EditorListResponse,
  type EditorUnresolvedEntry,
  type MealSlot,
  type PublicConfig,
} from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import { EventTile } from "../components/EventTile";
import {
  type FormatContext,
  formatDayMonth,
  formatWeekday,
} from "../i18n/format";
import { dayLabel } from "./labels";
import { timeOfDayOf } from "./Preview";
import { TID } from "./testIds";
import { EditorButton } from "./ui";

/** The board's view of a list item, so the row shows the tile the children see. */
export function itemEvent(item: EditorListItem): CalendarEvent {
  return {
    id: item.id,
    sourceId: item.origin === "app" ? "app-events" : item.sourceId,
    title: item.title,
    icon: item.icon,
    iconIsFallback: item.origin === "google" ? item.iconIsFallback : false,
    childIds: item.childIds,
    allDay: item.allDay,
    start: item.start,
    end: item.end,
    countdown: item.countdown,
    ...(item.bring.length > 0 ? { bring: item.bring } : {}),
  };
}

const SLOT_ORDER: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "unspecified",
];

export interface EntryListProps {
  data: EditorListResponse;
  config: PublicConfig;
  today: string;
  format: FormatContext;
  onEdit: (item: EditorAppItem) => void;
  onTemplate: (item: EditorGoogleItem) => void;
  onFix: (entry: EditorUnresolvedEntry) => void;
  onDeleteUnresolved: (entry: EditorUnresolvedEntry) => void;
}

/**
 * The line below an app row: 🔁 with the repeat in words ("Every week" / "Every 2
 * weeks", as in the form) and, for a series day changed on its own, a tag saying so.
 */
function SeriesNote({
  item,
}: {
  item: EditorAppItem;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (item.occurrenceDate === null || item.entry.repeat === "none") return null;
  const label =
    item.entry.repeat.weekly.interval === 2
      ? t("editor.form.everyOtherWeek")
      : t("editor.form.everyWeek");
  return (
    <p
      data-testid={TID.seriesMark}
      className="text-meta text-text-muted mt-1 flex flex-wrap items-center gap-2"
    >
      <Emoji emoji="🔁" className="text-[1.25rem]" />
      <span>{label}</span>
      {item.override !== null && (
        <span
          data-testid={TID.changedTag}
          className="bg-notice text-on-notice rounded-pill px-3"
        >
          {t("editor.list.changed")}
        </span>
      )}
    </p>
  );
}

function GoogleNote(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="text-meta text-text-muted mt-1" data-testid={TID.googleNote}>
      {t("editor.list.fromGoogle")}
    </p>
  );
}

/** What goes below a row's tile: where it comes from or how it repeats. */
function RowNote({ item }: { item: EditorListItem }): React.JSX.Element | null {
  return item.origin === "google" ? <GoogleNote /> : <SeriesNote item={item} />;
}

/**
 * The action of a row ("Change" or "Use as template") in a column of one width, so the
 * buttons of app and Google rows line up.
 */
function ItemActions({
  item,
  onEdit,
  onTemplate,
}: {
  item: EditorListItem;
  onEdit: (item: EditorAppItem) => void;
  onTemplate: (item: EditorGoogleItem) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex w-56 shrink-0" data-testid={TID.rowAction}>
      {item.origin === "app" ? (
        <EditorButton
          className="w-full"
          aria-label={t("editor.list.editNamed", { title: item.title })}
          onClick={() => {
            onEdit(item);
          }}
          data-testid={TID.editEntry}
        >
          {t("editor.list.edit")}
        </EditorButton>
      ) : (
        <EditorButton
          className="w-full"
          aria-label={t("editor.list.templateNamed", { title: item.title })}
          onClick={() => {
            onTemplate(item);
          }}
          data-testid={TID.useTemplate}
        >
          {t("editor.list.template")}
        </EditorButton>
      )}
    </div>
  );
}

function EventRow({
  item,
  childList,
  format,
  config,
  onEdit,
  onTemplate,
}: {
  item: EditorListItem;
  childList: readonly Child[];
  format: FormatContext;
  config: PublicConfig;
  onEdit: (item: EditorAppItem) => void;
  onTemplate: (item: EditorGoogleItem) => void;
}): React.JSX.Element {
  const event = itemEvent(item);
  return (
    <li
      data-testid={TID.editorItem}
      data-origin={item.origin}
      className="flex items-center gap-3"
    >
      <div className="@container min-w-0 flex-1">
        <EventTile
          event={event}
          childList={childList}
          format={format}
          timeOfDay={timeOfDayOf(event, config)}
          size="compact"
        />
        <RowNote item={item} />
      </div>
      <ItemActions item={item} onEdit={onEdit} onTemplate={onTemplate} />
    </li>
  );
}

function MealRow({
  item,
  onEdit,
  onTemplate,
}: {
  item: EditorListItem;
  onEdit: (item: EditorAppItem) => void;
  onTemplate: (item: EditorGoogleItem) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const slot = item.slot ?? "unspecified";
  return (
    <li
      data-testid={TID.editorItem}
      data-origin={item.origin}
      data-kind="meal"
      className="flex items-center gap-3"
    >
      <div className="min-w-0 flex-1">
        <div className="bg-surface-raised rounded-tile flex min-w-0 items-center gap-3 px-3 py-2">
          <span className="bg-surface-sunken rounded-pill flex size-12 shrink-0 items-center justify-center">
            <Emoji emoji={item.icon} className="text-[1.75rem]" />
          </span>
          <p className="text-tile-compact min-w-0 truncate">
            <span className="text-text-muted text-meta me-2">
              {t(`editor.meal.slots.${slot}`)}
            </span>
            {item.title}
          </p>
        </div>
        <RowNote item={item} />
      </div>
      <ItemActions item={item} onEdit={onEdit} onTemplate={onTemplate} />
    </li>
  );
}

/** Day heading: "Today · Sunday, November 22". */
function DayHeading({
  date,
  today,
  format,
}: {
  date: string;
  today: string;
  format: FormatContext;
}): React.JSX.Element {
  const { t } = useTranslation();
  const full = t("editor.day.full", {
    weekday: formatWeekday(date, format),
    date: formatDayMonth(date, format),
  });
  const near = date === today || date === addCalendarDays(today, 1);
  return (
    <h4 className="text-title">
      {near
        ? t("editor.day.relative", {
            day: dayLabel(date, today, format, t),
            date: full,
          })
        : full}
    </h4>
  );
}

function issueText(
  entry: EditorUnresolvedEntry,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return entry.issues.some((issue) => issue.code === "unknown_child")
    ? t("editor.list.unresolvedChild")
    : t("editor.list.unresolvedOther");
}

/**
 * The next 14 days grouped by day (today first): every entry as the tile the children
 * see, meals per slot, 🔁 on series, Google entries read-only with "use as template",
 * and the app entries the config can no longer show with a way to fix or delete them.
 */
export function EntryList({
  data,
  config,
  today,
  format,
  onEdit,
  onTemplate,
  onFix,
  onDeleteUnresolved,
}: EntryListProps): React.JSX.Element {
  const { t } = useTranslation();
  const days = [...new Set(data.items.map((item) => item.date))].sort();
  return (
    <div className="flex flex-col gap-8" data-testid={TID.entryList}>
      {data.unresolved.length > 0 && (
        <section
          aria-labelledby="editor-unresolved"
          className="bg-notice text-on-notice rounded-column flex flex-col gap-3 p-4"
          data-testid={TID.unresolved}
        >
          <h4 id="editor-unresolved" className="text-title">
            {t("editor.list.unresolved")}
          </h4>
          <ul className="flex flex-col gap-3">
            {data.unresolved.map((entry) => (
              <li
                key={entry.entryId}
                className="flex flex-wrap items-center gap-3"
                data-testid={TID.unresolvedEntry}
              >
                <Emoji emoji={entry.entry.icon} className="text-[2rem]" />
                <div className="min-w-0 flex-1">
                  <p className="text-tile-compact break-words">
                    {entry.entry.title}
                  </p>
                  <p className="text-meta">{issueText(entry, t)}</p>
                </div>
                <EditorButton
                  aria-label={t("editor.list.fixNamed", {
                    title: entry.entry.title,
                  })}
                  onClick={() => {
                    onFix(entry);
                  }}
                >
                  {t("editor.list.fix")}
                </EditorButton>
                <EditorButton
                  aria-label={t("editor.list.deleteNamed", {
                    title: entry.entry.title,
                  })}
                  onClick={() => {
                    onDeleteUnresolved(entry);
                  }}
                >
                  {t("editor.action.delete")}
                </EditorButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {days.length === 0 && (
        <p
          className="text-body text-text-muted"
          data-testid={TID.entryListEmpty}
        >
          {t("editor.list.empty")}
        </p>
      )}
      {days.map((date) => {
        const items = data.items.filter((item) => item.date === date);
        const events = items.filter((item) => item.kind === "event");
        const meals = items
          .filter((item) => item.kind === "meal")
          .sort(
            (a, b) =>
              SLOT_ORDER.indexOf(a.slot ?? "unspecified") -
              SLOT_ORDER.indexOf(b.slot ?? "unspecified"),
          );
        return (
          <section
            key={date}
            data-testid={TID.editorDay}
            data-date={date}
            className="flex flex-col gap-3"
          >
            <DayHeading date={date} today={today} format={format} />
            {events.length > 0 && (
              <ul className="flex flex-col gap-3">
                {events.map((item) => (
                  <EventRow
                    key={item.id}
                    item={item}
                    childList={config.children}
                    format={format}
                    config={config}
                    onEdit={onEdit}
                    onTemplate={onTemplate}
                  />
                ))}
              </ul>
            )}
            {meals.length > 0 && (
              <ul
                aria-label={t("editor.list.meals")}
                className="flex flex-col gap-2"
              >
                {meals.map((item) => (
                  <MealRow
                    key={item.id}
                    item={item}
                    onEdit={onEdit}
                    onTemplate={onTemplate}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
