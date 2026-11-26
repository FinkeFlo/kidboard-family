import type {
  CalendarEvent,
  Child,
  MealSlot,
  PublicConfig,
} from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import { EventTile } from "../components/EventTile";
import { TimeOfDayIcon } from "../components/TimeOfDayIcon";
import type { FormatContext } from "../i18n/format";
import { bandOf, type DayBand } from "../time";
import { TID } from "./testIds";

/**
 * Time of day of a timed event in the configured bands (for the tile's icon); before
 * `morningStart` it is the morning, as on the board (`buildDayModel`).
 */
export function timeOfDayOf(
  event: CalendarEvent,
  config: Pick<PublicConfig, "bands" | "timeZone">,
): DayBand | null {
  if (event.allDay) return null;
  const band = bandOf(Date.parse(event.start), config.bands, config.timeZone);
  return band === "night" ? "morning" : band;
}

/** Live preview: the tile exactly as the children will see it on the board. */
export function EventPreview({
  event,
  childList,
  format,
  config,
}: {
  event: CalendarEvent | null;
  childList: readonly Child[];
  format: FormatContext;
  config: Pick<PublicConfig, "bands" | "timeZone">;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("editor.form.preview")}
      data-testid={TID.entryPreview}
      className="bg-surface-sunken rounded-column flex flex-col gap-3 p-4"
    >
      <h3 className="text-meta text-text-muted">{t("editor.form.preview")}</h3>
      {event === null ? (
        <p className="text-body text-text-muted">
          {t("editor.form.previewEmpty")}
        </p>
      ) : (
        // The emoji a little smaller than on the board's disc, so wide glyphs (🏊)
        // stay inside their circle in the narrow preview instead of touching its edge.
        <div className="bg-surface-raised rounded-tile @container p-2 [&_[data-testid=emoji-disc]>span]:text-[2.75rem]">
          <EventTile
            event={event}
            childList={childList}
            format={format}
            timeOfDay={timeOfDayOf(event, config)}
            size="large"
          />
        </div>
      )}
    </section>
  );
}

const SLOT_BAND: Record<MealSlot, DayBand | null> = {
  breakfast: "morning",
  lunch: "midday",
  dinner: "evening",
  unspecified: null,
};

/** Live preview of a meal: the plate with its time-of-day badge and name. */
export function MealPreview({
  icon,
  title,
  slot,
}: {
  icon: string | null;
  title: string;
  slot: MealSlot;
}): React.JSX.Element {
  const { t } = useTranslation();
  const band = SLOT_BAND[slot];
  return (
    <section
      aria-label={t("editor.form.preview")}
      data-testid={TID.mealPreview}
      className="bg-surface-sunken rounded-column flex flex-col gap-3 p-4"
    >
      <h3 className="text-meta text-text-muted">{t("editor.form.preview")}</h3>
      {icon === null ? (
        <p className="text-body text-text-muted">
          {t("editor.meal.previewEmpty")}
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <span className="bg-surface-raised rounded-pill inset-ring-border relative flex size-24 items-center justify-center inset-ring-1">
            <Emoji
              emoji={icon}
              label={t("meal.plate", { slot: t(`meal.slot.${slot}`), title })}
              className="text-[3rem]"
            />
            {band !== null && (
              <span className="absolute -end-1 -bottom-1">
                <TimeOfDayIcon timeOfDay={band} className="size-7" />
              </span>
            )}
          </span>
          <p className="text-tile min-w-0 break-words">
            <span className="text-text-muted text-meta block">
              {t(`meal.slot.${slot}`)}
            </span>
            {title}
          </p>
        </div>
      )}
    </section>
  );
}
