import type { Meal, MealSlot } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import { TimeOfDayIcon } from "../components/TimeOfDayIcon";
import type { DayBand } from "../time";

type FixedSlot = Exclude<MealSlot, "unspecified">;

const ROWS: readonly { slot: FixedSlot; timeOfDay: DayBand }[] = [
  { slot: "breakfast", timeOfDay: "morning" },
  { slot: "lunch", timeOfDay: "midday" },
  { slot: "dinner", timeOfDay: "evening" },
];

/**
 * The day's meals at the bottom of a week column as a three-row list: breakfast, lunch
 * and dinner at fixed positions (an empty row for a missing meal, several meals of a slot
 * side by side), each led by its time-of-day symbol. Meals without a slot
 * (`unspecified`) get a row of their own below, without a symbol, and only when present.
 * Each meal emoji is an image named "Lunch: Spaghetti".
 */
export function MealRows({
  meals,
}: {
  meals: readonly Meal[];
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (meals.length === 0) return null;
  const unspecified = meals.filter((meal) => meal.slot === "unspecified");
  const emoji = (meal: Meal): React.JSX.Element => (
    <Emoji
      key={meal.id}
      emoji={meal.icon}
      label={t("meal.plate", {
        slot: t(`meal.slot.${meal.slot}`),
        title: meal.title,
      })}
      className="text-[1.625rem]"
    />
  );
  return (
    <ul
      aria-label={t("week.meals")}
      data-testid="meal-rows"
      className="bg-surface rounded-tile mt-auto flex shrink-0 flex-col gap-1 px-2 py-1.5"
    >
      {ROWS.map(({ slot, timeOfDay }) => {
        const ofSlot = meals.filter((meal) => meal.slot === slot);
        return (
          <li
            key={slot}
            data-slot={slot}
            aria-hidden={ofSlot.length === 0 ? true : undefined}
            className="flex h-8 min-w-0 items-center gap-2"
          >
            <TimeOfDayIcon timeOfDay={timeOfDay} className="text-caption" />
            {ofSlot.map(emoji)}
          </li>
        );
      })}
      {unspecified.length > 0 && (
        <li
          data-slot="unspecified"
          className="flex h-8 min-w-0 items-center gap-2"
        >
          <span aria-hidden="true" className="text-caption w-[1em] shrink-0" />
          {unspecified.map(emoji)}
        </li>
      )}
    </ul>
  );
}
