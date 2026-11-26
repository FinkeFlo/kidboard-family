import { BRING_MAX } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import { BRING_ITEMS } from "./catalogue";
import { IconChoice, OwnEmojiInput, sameIcon } from "./IconPicker";
import { TID } from "./testIds";
import { ChoiceChip, Field } from "./ui";

/**
 * "Bring along": common items as toggle chips plus own emoji (at most
 * {@link BRING_MAX}, ADR-0010). Own icons appear as chips of their own so they can be
 * removed again.
 */
export function BringPicker({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (bring: string[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const full = value.length >= BRING_MAX;
  const has = (icon: string): boolean => value.some((v) => sameIcon(v, icon));
  const toggle = (icon: string): void => {
    onChange(
      has(icon)
        ? value.filter((v) => !sameIcon(v, icon))
        : full
          ? [...value]
          : [...value, icon],
    );
  };
  const own = value.filter(
    (icon) => !BRING_ITEMS.some((item) => sameIcon(item.icon, icon)),
  );
  return (
    <Field
      legend={t("editor.form.bring")}
      hint={t("editor.form.bringHint", { count: BRING_MAX })}
      data-testid={TID.fieldBring}
    >
      <div className="flex flex-wrap gap-2">
        {BRING_ITEMS.map((item) => (
          <IconChoice
            key={item.id}
            type="checkbox"
            item={item}
            label={t(`editor.bring.${item.id}`)}
            checked={has(item.icon)}
            disabled={full && !has(item.icon)}
            onChange={() => {
              toggle(item.icon);
            }}
          />
        ))}
        {own.map((icon) => (
          <ChoiceChip
            key={icon}
            type="checkbox"
            checked
            onChange={() => {
              toggle(icon);
            }}
            label={t("editor.form.ownBringItem", { icon })}
            className="rounded-tile w-32 flex-col px-2 py-2"
          >
            <Emoji emoji={icon} className="text-[2rem]" />
          </ChoiceChip>
        ))}
      </div>
      {!full && (
        <OwnEmojiInput
          label={t("editor.form.ownBring")}
          buttonLabel={t("editor.form.add")}
          onEmoji={(icon) => {
            if (!has(icon)) onChange([...value, icon]);
          }}
          data-testid={TID.ownBring}
        />
      )}
    </Field>
  );
}
