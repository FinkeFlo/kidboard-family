import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import { TowardsArrow } from "../day/BringArea";
import type { ClothingRowModel } from "./buildBoardWeather";
import { ClothingIcon, EMOJI_BOX } from "./ClothingIcon";
import { temperatureText, WEATHER_PILL, weatherName } from "./WeatherChip";

/** Test hook of the row's "→" (the 🎒 area's is `bring-arrow`). */
const ARROW_TEST_ID = "clothing-arrow";

/**
 * Icon sizes of the row in rem, largest first: the heading row picks the largest that
 * keeps chip and pill on one line (`TodayWeatherHead`). Full class names for Tailwind.
 */
export const CLOTHING_ICON_STEPS = [
  { rem: 2, icon: "text-[2rem]", lead: "text-[1.75rem]", gap: "gap-1" },
  { rem: 1.75, icon: "text-[1.75rem]", lead: "text-[1.75rem]", gap: "gap-0.5" },
  { rem: 1.5, icon: "text-[1.5rem]", lead: "text-[1.5rem]", gap: "gap-px" },
] as const;

export type ClothingIconStep = (typeof CLOTHING_ICON_STEPS)[number];

/**
 * What to wear, in today's overview column: a pill in the heading row just before
 * today's chip (T-49), always on one line (the head picks the icon size, `step`). One to
 * five clothing pictures through {@link ClothingIcon}. Until `bands.eveningStart` the
 * clothes are today's (today's chip beside the pill is their weather); from then they are
 * tomorrow's and the pill leads with tomorrow's weather: "→", its icon and high in a
 * weather pill (the 🎒 area below carries the weekday). A labelled list ("Wear today:
 * jacket, scarf" / "Tomorrow: Rain, high 7 degrees. Wear: …"), not a live region,
 * nothing interactive; the pictures are dimmed at night like every emoji.
 */
export function ClothingRow({
  row,
  step = CLOTHING_ICON_STEPS[0],
}: {
  row: ClothingRowModel;
  step?: ClothingIconStep;
}): React.JSX.Element {
  const { t } = useTranslation();
  const names = row.items.map((item) => t(`weather.clothing.${item.key}`));
  const label =
    row.when === "tomorrow"
      ? t("weather.wear.tomorrow", {
          weather: weatherName(t, row.forecast, { current: false }),
          items: names,
        })
      : t("weather.wear.today", { items: names });
  return (
    <div
      data-testid="clothing-row"
      data-when={row.when}
      data-date={row.date}
      data-icon-rem={step.rem}
      className="rounded-pill bg-surface-sunken flex h-9 shrink-0 items-center gap-1 ps-1 pe-1"
    >
      {row.when === "tomorrow" && (
        // The list's name says "tomorrow" and its weather; the lead is for the eyes.
        <span
          aria-hidden="true"
          data-testid="clothing-lead"
          className="flex shrink-0 items-center gap-0.5"
        >
          <TowardsArrow testId={ARROW_TEST_ID} />
          <span
            data-testid="clothing-forecast"
            data-kind={row.forecast.kind}
            className={`${WEATHER_PILL} h-8 ps-0.5 pe-1.5`}
          >
            <Emoji
              emoji={row.forecast.icon}
              className={`${EMOJI_BOX} ${step.lead}`}
            />
            <span className="text-body leading-none font-black tracking-tight whitespace-nowrap">
              {t("weather.temperature", {
                value: temperatureText(row.forecast.high),
              })}
            </span>
          </span>
        </span>
      )}
      <ul aria-label={label} className={`flex items-center ${step.gap}`}>
        {row.items.map((item, index) => (
          <li
            key={item.key}
            data-testid="clothing-item"
            data-key={item.key}
            className="flex items-center"
          >
            <span role="img" aria-label={names[index]} className="flex">
              <ClothingIcon item={item} className={step.icon} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
