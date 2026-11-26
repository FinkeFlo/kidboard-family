import type { Child } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { ChildAvatar } from "../components/ChildAvatar";
import { Emoji } from "../components/Emoji";
import { TID } from "./testIds";
import { ChoiceChip, Field } from "./ui";

/**
 * "Who?": one chip per configured child (avatar and name, several at once) and
 * "Everyone", which is on exactly when no child is picked. Unknown ids of an entry
 * (a child removed from the config) are shown as "no longer configured" so they can be
 * dropped.
 */
export function ChildPicker({
  childList,
  value,
  onChange,
  error,
}: {
  childList: readonly Child[];
  value: readonly string[];
  onChange: (childIds: string[]) => void;
  error?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const known = new Set(childList.map((child) => child.id));
  const unknown = value.filter((id) => !known.has(id));
  const toggle = (id: string): void => {
    onChange(
      value.includes(id)
        ? value.filter((other) => other !== id)
        : // Config order, so titles read the same as on the board.
          childList
            .map((child) => child.id)
            .filter((other) => other === id || value.includes(other)),
    );
  };
  return (
    <Field
      legend={t("editor.form.who")}
      error={error}
      data-testid={TID.fieldWho}
    >
      <div className="flex flex-wrap gap-3">
        <ChoiceChip
          type="checkbox"
          checked={value.length === 0}
          onChange={() => {
            onChange([]);
          }}
        >
          <Emoji emoji="👨‍👩‍👧" className="text-[1.75rem]" />
          {t("editor.form.everyone")}
        </ChoiceChip>
        {childList.map((child) => (
          <ChoiceChip
            key={child.id}
            type="checkbox"
            checked={value.includes(child.id)}
            onChange={() => {
              toggle(child.id);
            }}
          >
            <ChildAvatar
              child={child}
              decorative
              className="text-body size-9"
            />
            {child.name}
          </ChoiceChip>
        ))}
        {unknown.map((id) => (
          <ChoiceChip
            key={id}
            type="checkbox"
            checked
            onChange={() => {
              onChange(value.filter((other) => other !== id));
            }}
          >
            {t("editor.form.unknownChild", { id })}
          </ChoiceChip>
        ))}
      </div>
    </Field>
  );
}
