import { isoWeekday } from "@kidboard/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { FormatContext } from "../i18n/format";
import type { RepeatMode } from "./draft";
import { weekdayLong, weekdayShort } from "./labels";
import { TID } from "./testIds";
import { ChoiceChip, EditorButton, Field } from "./ui";
import { DateInput } from "./WhenPicker";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * "Repeat?": once or weekly. Weekly shows the weekday chips (the chosen date's weekday
 * is always on, so the series starts on it), every one or two weeks and an optional
 * last day.
 */
export function RepeatPicker({
  format,
  date,
  repeat,
  onRepeat,
  weekdays,
  onToggleWeekday,
  interval,
  onInterval,
  until,
  onUntil,
  error,
}: {
  format: FormatContext;
  date: string;
  repeat: RepeatMode;
  onRepeat: (repeat: RepeatMode) => void;
  weekdays: readonly number[];
  onToggleWeekday: (day: number) => void;
  interval: 1 | 2;
  onInterval: (interval: 1 | 2) => void;
  until: string;
  onUntil: (until: string) => void;
  error?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const modeName = useId();
  const intervalName = useId();
  const startDay = isoWeekday(date);
  return (
    <Field
      legend={t("editor.form.repeat")}
      error={error}
      data-testid={TID.fieldRepeat}
    >
      <div
        role="radiogroup"
        aria-label={t("editor.form.repeat")}
        className="flex flex-wrap gap-3"
      >
        <ChoiceChip
          type="radio"
          name={modeName}
          checked={repeat === "none"}
          onChange={() => {
            onRepeat("none");
          }}
        >
          {t("editor.form.once")}
        </ChoiceChip>
        <ChoiceChip
          type="radio"
          name={modeName}
          checked={repeat === "weekly"}
          onChange={() => {
            onRepeat("weekly");
          }}
        >
          {t("editor.form.weekly")}
        </ChoiceChip>
      </div>
      {repeat === "weekly" && (
        <>
          <div
            role="group"
            aria-label={t("editor.form.weekdays")}
            className="flex flex-wrap gap-2"
          >
            {WEEKDAYS.map((day) => (
              <ChoiceChip
                key={day}
                type="checkbox"
                checked={weekdays.includes(day)}
                disabled={day === startDay}
                onChange={() => {
                  onToggleWeekday(day);
                }}
                label={weekdayLong(day, format)}
                className="text-meta min-w-touch-parent px-3"
              >
                <span aria-hidden="true">{weekdayShort(day, format)}</span>
              </ChoiceChip>
            ))}
          </div>
          <div
            role="radiogroup"
            aria-label={t("editor.form.interval")}
            className="flex flex-wrap gap-3"
          >
            {([1, 2] as const).map((value) => (
              <ChoiceChip
                key={value}
                type="radio"
                name={intervalName}
                checked={interval === value}
                onChange={() => {
                  onInterval(value);
                }}
              >
                {t(
                  value === 1
                    ? "editor.form.everyWeek"
                    : "editor.form.everyOtherWeek",
                )}
              </ChoiceChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateInput
              label={t("editor.form.until")}
              value={until}
              min={date}
              onChange={onUntil}
              data-testid={TID.untilInput}
            />
            {until !== "" && (
              <EditorButton
                tone="quiet"
                onClick={() => {
                  onUntil("");
                }}
              >
                {t("editor.form.noEnd")}
              </EditorButton>
            )}
          </div>
        </>
      )}
    </Field>
  );
}
