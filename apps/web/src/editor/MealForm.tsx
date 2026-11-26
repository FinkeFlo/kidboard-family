import { addCalendarDays, type MealSlot } from "@kidboard/shared";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DISHES } from "./catalogue";
import {
  draftChanged,
  type DraftProblem,
  isEmoji,
  type MealDraft,
  mealDraftProblems,
  problemsOf,
} from "./draft";
import {
  FormAside,
  type FormShellProps,
  ownEmojiInvalid,
  titleFollowsPicture,
  TitleInput,
  useDiscardGuard,
  useProblemMessages,
  useRevealInvalid,
} from "./EventForm";
import { IconChoice, OwnEmojiInput, sameIcon } from "./IconPicker";
import { dayLabel } from "./labels";
import { MealPreview } from "./Preview";
import { TID } from "./testIds";
import { ChoiceChip, Field } from "./ui";
import { DateInput } from "./WhenPicker";

export const MEAL_SLOTS: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "unspecified",
];

/** Day chips of the meal form: today and the next six days. */
const MEAL_DAY_CHIPS = 7;

/** A meal already planned on a day (in the editor's 14-day window). */
export interface TakenMeal {
  date: string;
  slot: MealSlot;
  title: string;
}

export interface MealFormProps extends FormShellProps {
  initial: MealDraft;
  onSubmit: (draft: MealDraft) => void;
  /**
   * Meals already planned (without the edited one): when the chosen day and slot
   * already hold one, a gentle hint names it; saving stays possible.
   */
  takenMeals?: readonly TakenMeal[];
  /** "Repeat last week's meals" (new meals only). */
  copyAction?: React.ReactNode;
}

/**
 * "Add a meal" (T-45 criterion 4): day and slot chips, the dish catalogue,
 * own emoji and name, the plate preview. Meals are all-day entries in a slot.
 */
export function MealForm(props: MealFormProps): React.JSX.Element {
  const { initial, config, today, format, failure, onSubmit, heading } = props;
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [refused, setRefused] = useState(0);
  const [ownText, setOwnText] = useState("");
  const dayName = useId();
  const slotName = useId();
  const dishName = useId();
  const headingId = useId();
  const local = useMemo(
    () => mealDraftProblems(draft, config),
    [draft, config],
  );
  const ownInvalid = ownEmojiInvalid(ownText);
  const problems: DraftProblem[] = [
    ...new Set([
      ...(attempted ? local : []),
      ...(failure?.kind === "invalid" ? problemsOf(failure.issues) : []),
    ]),
  ];
  const messages = useProblemMessages(problems);
  const dishError =
    messages.icon ??
    (attempted && ownInvalid ? t("editor.problem.ownEmoji") : undefined);
  const days = Array.from({ length: MEAL_DAY_CHIPS }, (_, i) =>
    addCalendarDays(today, i),
  );
  const pick = (icon: string, label: string | null): void => {
    setDraft((current) => {
      const previous = DISHES.find((dish) => sameIcon(dish.icon, current.icon));
      const replaceTitle =
        label !== null &&
        titleFollowsPicture(
          current,
          previous === undefined ? null : t(`editor.dish.${previous.id}`),
        );
      return {
        ...current,
        icon,
        ...(replaceTitle ? { title: label, titleFromLabel: true } : {}),
      };
    });
  };
  const currentDish = DISHES.find((dish) => sameIcon(dish.icon, draft.icon));
  const taken = (props.takenMeals ?? [])
    .filter((meal) => meal.date === draft.date && meal.slot === draft.slot)
    .map((meal) => meal.title);
  const guard = useDiscardGuard(
    draftChanged(draft, initial) || ownText.trim() !== "",
    props.onCancel,
  );
  useRevealInvalid(formRef, refused, failure);

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      noValidate
      data-testid={TID.mealForm}
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (local.length > 0 || ownInvalid) {
          setRefused((count) => count + 1);
          return;
        }
        if (!props.busy) onSubmit(draft);
      }}
      className="gap-gutter grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]"
    >
      <div className="flex min-h-0 flex-col gap-8 overflow-y-auto pe-2 pb-8">
        <h3 id={headingId} className="text-heading">
          {heading}
        </h3>
        <Field legend={t("editor.meal.day")} data-testid={TID.fieldMealDay}>
          <div
            role="radiogroup"
            aria-label={t("editor.meal.day")}
            className="flex flex-wrap items-center gap-2"
          >
            {days.map((day) => (
              <ChoiceChip
                key={day}
                type="radio"
                name={dayName}
                checked={draft.date === day}
                onChange={() => {
                  setDraft((current) => ({ ...current, date: day }));
                }}
                className="text-meta"
              >
                {dayLabel(day, today, format, t)}
              </ChoiceChip>
            ))}
          </div>
          <DateInput
            label={t("editor.form.otherDay")}
            value={draft.date}
            min={addCalendarDays(today, -1)}
            onChange={(date) => {
              setDraft((current) => ({ ...current, date }));
            }}
            data-testid={TID.mealDateInput}
          />
        </Field>
        <Field legend={t("editor.meal.slot")} data-testid={TID.fieldMealSlot}>
          <div
            role="radiogroup"
            aria-label={t("editor.meal.slot")}
            className="flex flex-wrap gap-3"
          >
            {MEAL_SLOTS.map((slot) => (
              <ChoiceChip
                key={slot}
                type="radio"
                name={slotName}
                checked={draft.slot === slot}
                onChange={() => {
                  setDraft((current) => ({ ...current, slot }));
                }}
              >
                {t(`editor.meal.slots.${slot}`)}
              </ChoiceChip>
            ))}
          </div>
          <p
            aria-live="polite"
            className="text-body text-text-muted empty:hidden"
            data-testid={TID.mealTaken}
          >
            {taken.length > 0
              ? t("editor.meal.taken", { titles: taken.join(", ") })
              : null}
          </p>
        </Field>
        <Field
          legend={t("editor.meal.dish")}
          error={dishError}
          data-testid={TID.fieldDish}
        >
          <div
            role="radiogroup"
            aria-label={t("editor.meal.dish")}
            className="flex flex-wrap gap-2"
            data-invalid-focus=""
          >
            {DISHES.map((dish) => {
              const label = t(`editor.dish.${dish.id}`);
              return (
                <IconChoice
                  key={dish.id}
                  item={dish}
                  label={label}
                  name={dishName}
                  checked={currentDish?.id === dish.id}
                  onChange={() => {
                    pick(dish.icon, label);
                  }}
                />
              );
            })}
          </div>
          <OwnEmojiInput
            label={t("editor.form.ownEmoji")}
            onEmoji={(emoji) => {
              pick(emoji, null);
            }}
            onTextChange={setOwnText}
            data-testid={TID.ownDish}
          />
        </Field>
        <TitleInput
          value={draft.title}
          error={messages.title}
          onChange={(title) => {
            setDraft((current) => ({
              ...current,
              title,
              titleFromLabel: false,
            }));
          }}
        />
      </div>
      <FormAside
        shell={props}
        onCancel={guard.cancel}
        saveLabel={t("editor.action.save")}
        general={messages.invalid ?? messages.time ?? messages.until}
        preview={
          <MealPreview
            icon={isEmoji(draft.icon) ? draft.icon.trim() : null}
            title={
              draft.title.trim() === ""
                ? t("editor.form.previewTitle")
                : draft.title.trim()
            }
            slot={draft.slot}
          />
        }
      >
        {props.copyAction}
      </FormAside>
      {guard.dialog}
    </form>
  );
}
