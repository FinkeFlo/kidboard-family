import { addCalendarDays } from "@kidboard/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { type FormatContext } from "../i18n/format";
import { DURATION_PRESETS } from "./draft";
import { dayLabel } from "./labels";
import { TID } from "./testIds";
import { ChoiceChip, Field } from "./ui";

const INPUT =
  "min-h-touch-parent rounded-tile bg-surface-raised text-text inset-ring-input-border text-body focus-visible:outline-accent px-3 font-bold inset-ring-2 focus-visible:outline-4";

/** A labelled native date input (`YYYY-MM-DD`); empty input is ignored. */
export function DateInput({
  label,
  value,
  min,
  onChange,
  "data-testid": testId,
}: {
  label: string;
  value: string;
  min?: string;
  onChange: (date: string) => void;
  "data-testid"?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-body font-extrabold">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        data-testid={testId}
        onChange={(event) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
            onChange(event.target.value);
          }
        }}
        className={INPUT}
      />
    </span>
  );
}

/** Duration chip text, e.g. "45 min", "1 h", "1½ h". */
export function durationLabel(
  minutes: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (minutes < 60 || minutes % 30 !== 0) {
    return t("editor.form.minutes", { minutes });
  }
  const hours = minutes / 60;
  return Number.isInteger(hours)
    ? t("editor.form.hours", { hours })
    : t("editor.form.hoursHalf", { hours: Math.floor(hours) });
}

/**
 * "When?": today / tomorrow chips and a date field, "at a time" or "all day", the start
 * time and duration presets. An edited entry whose length is no preset keeps its own
 * length as an extra chip.
 */
export function WhenPicker({
  today,
  format,
  date,
  onDate,
  allDay,
  onAllDay,
  startTime,
  onStartTime,
  duration,
  onDuration,
  error,
  notice,
}: {
  today: string;
  format: FormatContext;
  date: string;
  onDate: (date: string) => void;
  allDay: boolean;
  onAllDay: (allDay: boolean) => void;
  startTime: string;
  onStartTime: (time: string) => void;
  duration: number;
  onDuration: (minutes: number) => void;
  error?: string | undefined;
  /** A gentle, non-blocking note (e.g. the start lies in the past). */
  notice?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dayName = useId();
  const kindName = useId();
  const durationName = useId();
  const timeId = useId();
  const tomorrow = addCalendarDays(today, 1);
  const durations: number[] = (DURATION_PRESETS as readonly number[]).includes(
    duration,
  )
    ? [...DURATION_PRESETS]
    : [...DURATION_PRESETS, duration].sort((a, b) => a - b);
  return (
    <Field
      legend={t("editor.form.when")}
      error={error}
      data-testid={TID.fieldWhen}
    >
      <div
        role="radiogroup"
        aria-label={t("editor.form.day")}
        className="flex flex-wrap items-center gap-3"
      >
        {[today, tomorrow].map((day) => (
          <ChoiceChip
            key={day}
            type="radio"
            name={dayName}
            checked={date === day}
            onChange={() => {
              onDate(day);
            }}
          >
            {dayLabel(day, today, format, t)}
          </ChoiceChip>
        ))}
        <DateInput
          label={t("editor.form.otherDay")}
          value={date}
          min={addCalendarDays(today, -1)}
          onChange={onDate}
          data-testid={TID.dateInput}
        />
      </div>
      <div
        role="radiogroup"
        aria-label={t("editor.form.timeKind")}
        className="flex flex-wrap items-center gap-3"
      >
        <ChoiceChip
          type="radio"
          name={kindName}
          checked={!allDay}
          onChange={() => {
            onAllDay(false);
          }}
        >
          {t("editor.form.atTime")}
        </ChoiceChip>
        <ChoiceChip
          type="radio"
          name={kindName}
          checked={allDay}
          onChange={() => {
            onAllDay(true);
          }}
        >
          {t("editor.form.allDay")}
        </ChoiceChip>
      </div>
      {!allDay && (
        <>
          <span className="inline-flex flex-wrap items-center gap-3">
            <label htmlFor={timeId} className="text-body font-extrabold">
              {t("editor.form.start")}
            </label>
            <input
              id={timeId}
              type="time"
              step={300}
              value={startTime}
              data-testid={TID.timeInput}
              onChange={(event) => {
                if (/^\d{2}:\d{2}$/.test(event.target.value)) {
                  onStartTime(event.target.value);
                }
              }}
              className={INPUT}
            />
          </span>
          <div
            role="radiogroup"
            aria-label={t("editor.form.duration")}
            className="flex flex-wrap gap-2"
          >
            {durations.map((minutes) => (
              <ChoiceChip
                key={minutes}
                type="radio"
                name={durationName}
                checked={duration === minutes}
                onChange={() => {
                  onDuration(minutes);
                }}
                className="text-meta"
              >
                {durationLabel(minutes, t)}
              </ChoiceChip>
            ))}
          </div>
        </>
      )}
      <p
        aria-live="polite"
        className="text-body text-text-muted empty:hidden"
        data-testid={TID.whenNotice}
      >
        {notice}
      </p>
    </Field>
  );
}
