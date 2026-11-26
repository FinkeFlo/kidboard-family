import type { Child, EditorTemplate } from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { ChildAvatar } from "../components/ChildAvatar";
import { Emoji } from "../components/Emoji";
import { activityById, QUICK_PICKS, type QuickPick } from "./catalogue";
import { TID } from "./testIds";
import { FOCUS_RING } from "./ui";

const CARD = `min-h-touch-parent rounded-tile bg-surface-raised text-text inset-ring-border flex shrink-0 items-center gap-3 px-4 py-2 text-start inset-ring-2 ${FOCUS_RING}`;

/**
 * The "Again" row (T-45 criterion 3): suggestions from recent events (T-43
 * `/templates`, most frequent first) and the built-in quick picks, each pre-filling a
 * new entry with one tap.
 */
export function TemplatesRow({
  templates,
  childList,
  onTemplate,
  onQuickPick,
}: {
  templates: readonly EditorTemplate[];
  childList: readonly Child[];
  onTemplate: (template: EditorTemplate) => void;
  onQuickPick: (pick: QuickPick) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // The row starts new entries (events); meal suggestions would open the event form.
  const events = templates.filter((template) => template.kind === "event");
  return (
    <section
      aria-labelledby="editor-again"
      className="flex flex-col gap-3"
      data-testid={TID.templatesRow}
    >
      <h3 id="editor-again" className="text-title">
        {t("editor.templates.title")}
      </h3>
      {/*
        One row that scrolls sideways (padded for the focus ring), so the list stays in
        view. The end fades out (and has room to scroll clear of the fade), so a chip at
        the edge is read as "more to the side", not as cut off.
      */}
      <ul
        className="-m-2 flex gap-3 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)] p-2 pe-14"
        data-testid={TID.templatesList}
      >
        {events.map((template, index) => {
          const kids = template.childIds.flatMap((id) => {
            const child = childList.find((c) => c.id === id);
            return child === undefined ? [] : [child];
          });
          return (
            <li
              key={`${template.icon}-${template.title}-${String(index)}`}
              className="shrink-0"
            >
              <button
                type="button"
                className={CARD}
                data-testid={TID.template}
                onClick={() => {
                  onTemplate(template);
                }}
              >
                <Emoji emoji={template.icon} className="text-[2rem]" />
                <span className="text-body max-w-48 truncate font-extrabold">
                  {template.title}
                </span>
                {kids.map((child) => (
                  <ChildAvatar
                    key={child.id}
                    child={child}
                    className="text-meta size-7"
                  />
                ))}
              </button>
            </li>
          );
        })}
        {QUICK_PICKS.map((pick) => (
          <li key={pick.id} className="shrink-0">
            <button
              type="button"
              className={CARD}
              data-testid={`quick-${pick.id}`}
              onClick={() => {
                onQuickPick(pick);
              }}
            >
              <Emoji
                emoji={activityById(pick.activity).icon}
                className="text-[2rem]"
              />
              <span className="text-body font-extrabold">
                {t(`editor.templates.quick.${pick.id}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
