import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import {
  ACTIVITIES,
  activitiesOf,
  ACTIVITY_GROUP_IDS,
  type ActivityGroupId,
  type CatalogueIcon,
} from "./catalogue";
import { isEmoji } from "./draft";
import { TID } from "./testIds";
import { ChoiceChip, Field } from "./ui";

const stripVs16 = (value: string): string => value.replace(/️/gu, "");

/** Same emoji, ignoring the emoji presentation selector. */
export function sameIcon(a: string, b: string): boolean {
  return stripVs16(a.trim()) === stripVs16(b.trim());
}

/**
 * A text field for one emoji of the parent's choice, checked with `EmojiSchema`: a
 * valid emoji is reported at once, anything else gets a calm hint and is not used.
 */
export function OwnEmojiInput({
  label,
  onEmoji,
  onTextChange,
  buttonLabel,
  "data-testid": testId,
}: {
  label: string;
  onEmoji: (emoji: string) => void;
  /**
   * Every change of the typed text (also when it is no emoji), so a form can refuse to
   * save while the field holds something it would silently ignore.
   */
  onTextChange?: ((text: string) => void) | undefined;
  /** With a button the emoji is taken on press (and the field cleared), else on input. */
  buttonLabel?: string;
  "data-testid"?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const inputId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const value = text.trim();
  const invalid = value !== "" && !isEmoji(value);
  const take = (): void => {
    if (value === "" || invalid) return;
    onEmoji(value);
    setText("");
    onTextChange?.("");
  };
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={testId}>
      <label htmlFor={inputId} className="text-body font-extrabold">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        value={text}
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={invalid}
        aria-describedby={hintId}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          onTextChange?.(next);
          if (buttonLabel === undefined && isEmoji(next)) {
            onEmoji(next.trim());
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && buttonLabel !== undefined) {
            event.preventDefault();
            take();
          }
        }}
        className="min-h-touch-parent rounded-tile bg-surface-raised text-text inset-ring-input-border focus-visible:outline-accent font-emoji w-24 px-3 text-center text-[1.75rem] inset-ring-2 focus-visible:outline-4"
      />
      {buttonLabel !== undefined && (
        <button
          type="button"
          onClick={take}
          disabled={value === "" || invalid}
          className="min-h-touch-parent rounded-pill bg-surface-sunken text-text inset-ring-border text-body focus-visible:outline-accent disabled:text-text-muted px-5 font-extrabold inset-ring-2 focus-visible:outline-4"
        >
          {buttonLabel}
        </button>
      )}
      <p
        id={hintId}
        aria-live="polite"
        className={`text-meta ${invalid ? "text-danger" : "text-text-muted"}`}
      >
        {invalid
          ? t("editor.form.ownEmojiInvalid")
          : t("editor.form.ownEmojiHint")}
      </p>
    </div>
  );
}

/** A square chip with an emoji and its label below (catalogue icons). */
export function IconChoice({
  item,
  label,
  name,
  type = "radio",
  checked,
  onChange,
  disabled,
}: {
  item: CatalogueIcon;
  label: string;
  name?: string;
  type?: "radio" | "checkbox";
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <ChoiceChip
      type={type}
      name={name}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="rounded-tile w-32 flex-col gap-0.5 px-2 py-2"
      data-testid={`icon-${item.id}`}
    >
      <Emoji emoji={item.icon} className="text-[2rem]" />
      <span className="text-meta line-clamp-2 w-full text-center leading-tight break-words hyphens-auto">
        {label}
      </span>
    </ChoiceChip>
  );
}

/**
 * "What?": the activity catalogue in six groups (one group shown at a time, the group
 * of the current icon first) plus "your own emoji". Picking a catalogue icon passes its
 * label so the form can pre-fill the title.
 */
export function IconPicker({
  icon,
  onPick,
  onOwnText,
  error,
}: {
  icon: string;
  onPick: (icon: string, label: string | null) => void;
  /** The text typed into "your own emoji" (see {@link OwnEmojiInput}). */
  onOwnText?: ((text: string) => void) | undefined;
  error?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const groupName = useId();
  const iconName = useId();
  const current = ACTIVITIES.find((activity) => sameIcon(activity.icon, icon));
  const [group, setGroup] = useState<ActivityGroupId>(
    current?.group ?? "sport",
  );
  const own = icon !== "" && current === undefined;
  return (
    <Field
      legend={t("editor.form.what")}
      error={error}
      data-testid={TID.fieldWhat}
    >
      <div
        role="radiogroup"
        aria-label={t("editor.form.groups")}
        className="flex flex-wrap gap-2"
      >
        {ACTIVITY_GROUP_IDS.map((id) => (
          <ChoiceChip
            key={id}
            type="radio"
            name={groupName}
            checked={group === id}
            onChange={() => {
              setGroup(id);
            }}
            className="text-meta"
          >
            {t(`editor.group.${id}`)}
          </ChoiceChip>
        ))}
      </div>
      <div
        role="radiogroup"
        aria-label={t(`editor.group.${group}`)}
        className="flex flex-wrap gap-2"
        data-testid={TID.activityIcons}
        data-invalid-focus=""
      >
        {activitiesOf(group).map((activity) => {
          const label = t(`editor.activity.${activity.id}`);
          return (
            <IconChoice
              key={activity.id}
              item={activity}
              label={label}
              name={iconName}
              checked={current?.id === activity.id}
              onChange={() => {
                onPick(activity.icon, label);
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {own && (
          <span
            className="rounded-tile bg-nav-active text-on-nav-active min-h-touch-parent inline-flex items-center gap-2 px-4 font-extrabold"
            data-testid={TID.ownIcon}
          >
            <Emoji emoji={icon} className="text-[2rem]" />
            {t("editor.form.ownEmojiChosen")}
          </span>
        )}
        <OwnEmojiInput
          label={t("editor.form.ownEmoji")}
          onEmoji={(emoji) => {
            onPick(emoji, null);
          }}
          onTextChange={onOwnText}
          data-testid={TID.ownEmoji}
        />
      </div>
    </Field>
  );
}
