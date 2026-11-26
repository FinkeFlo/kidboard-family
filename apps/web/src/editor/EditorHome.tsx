import type {
  EditorAppItem,
  EditorGoogleItem,
  EditorTemplate,
  EditorUnresolvedEntry,
  PublicConfig,
} from "@kidboard/shared";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import type { ApiClient } from "../data";
import type { FormatContext } from "../i18n/format";
import type { QuickPick } from "./catalogue";
import { DataSection } from "./DataSection";
import { EntryList } from "./EntryList";
import { type EditorFailure, STORAGE_FAILURE } from "./failure";
import { FailureNotice } from "./Notice";
import { PhoneFeed } from "./PhoneFeed";
import { jumpTo } from "./reveal";
import { TemplatesRow } from "./TemplatesRow";
import { TID } from "./testIds";
import { EditorButton, FOCUS_RING } from "./ui";
import type { Backup } from "./useBackup";
import type { EditorData } from "./useEditorData";

/** The jump bar: section headings of the home view and their labels. */
const JUMP_TARGETS = [
  { id: "editor-list", label: "editor.jump.list" },
  { id: "editor-data", label: "editor.jump.data" },
] as const;

/** The first action of the home view: where "Back to top" lands. */
const TOP_ANCHOR = "editor-top";

interface HomeProps {
  api: ApiClient;
  token: string;
  config: PublicConfig;
  today: string;
  format: FormatContext;
  data: EditorData;
  backup: Backup;
  busy: boolean;
  /** Failure of the last write or copy, shown above the Data section. */
  failure: EditorFailure | null;
  onNewEvent: () => void;
  onNewMeal: () => void;
  onTemplate: (template: EditorTemplate) => void;
  onQuickPick: (pick: QuickPick) => void;
  onEdit: (item: EditorAppItem) => void;
  onGoogle: (item: EditorGoogleItem) => void;
  onFix: (entry: EditorUnresolvedEntry) => void;
  onDeleteUnresolved: (entry: EditorUnresolvedEntry) => void;
  onUnlock: () => void;
}

/**
 * The editor's home view: new entry / new meal, the jump bar, the "Again" row, the
 * 14-day list and the Data section.
 */
export function EditorHome({
  api,
  token,
  config,
  today,
  format,
  data,
  backup,
  busy,
  failure,
  onNewEvent,
  onNewMeal,
  onTemplate,
  onQuickPick,
  onEdit,
  onGoogle,
  onFix,
  onDeleteUnresolved,
  onUnlock,
}: HomeProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="h-full min-h-0 overflow-y-auto pe-2 pb-8"
      data-testid={TID.editorHome}
    >
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-8">
        <div className="flex flex-wrap gap-3">
          <EditorButton
            tone="primary"
            id={TOP_ANCHOR}
            className="text-title"
            data-testid={TID.newEntry}
            onClick={onNewEvent}
          >
            <Emoji emoji="➕" className="text-[1.5rem]" />
            {t("editor.home.newEntry")}
          </EditorButton>
          <EditorButton
            className="text-title"
            data-testid={TID.newMeal}
            onClick={onNewMeal}
          >
            <Emoji emoji="🍽️" className="text-[1.5rem]" />
            {t("editor.home.newMeal")}
          </EditorButton>
        </div>
        <nav
          aria-labelledby="editor-jump"
          className="flex flex-wrap items-center gap-3"
          data-testid={TID.jumpBar}
        >
          <span id="editor-jump" className="text-meta text-text-muted">
            {t("editor.jump.label")}
          </span>
          {JUMP_TARGETS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`min-h-touch-parent rounded-pill text-body text-text px-3 font-extrabold underline underline-offset-4 ${FOCUS_RING}`}
              onClick={() => {
                const target = document.getElementById(id);
                if (target !== null) jumpTo(target);
              }}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <TemplatesRow
          templates={data.templates}
          childList={config.children}
          onTemplate={onTemplate}
          onQuickPick={onQuickPick}
        />
        <section aria-labelledby="editor-list" className="flex flex-col gap-4">
          <h3 id="editor-list" className="text-heading">
            {t("editor.list.title")}
          </h3>
          {data.failure !== null && (
            <FailureNotice
              failure={data.failure}
              onRetry={data.reload}
              onUnlock={onUnlock}
            />
          )}
          {data.list?.storageUnavailable === true && (
            <FailureNotice
              failure={STORAGE_FAILURE}
              onRetry={data.reload}
              data-testid={TID.storageUnavailable}
            />
          )}
          {data.list === null ? (
            data.failure === null && (
              <p className="text-body text-text-muted" role="status">
                {t("editor.list.loading")}
              </p>
            )
          ) : (
            <EntryList
              data={data.list}
              config={config}
              today={today}
              format={format}
              onEdit={onEdit}
              onTemplate={onGoogle}
              onFix={onFix}
              onDeleteUnresolved={onDeleteUnresolved}
            />
          )}
        </section>
        {failure !== null && <FailureNotice failure={failure} />}
        <DataSection
          busy={busy}
          failure={backup.dataFailure}
          onExport={() => {
            void backup.exportBackup();
          }}
          onImport={backup.importBackup}
          onTop={() => {
            const top = document.getElementById(TOP_ANCHOR);
            if (top !== null) jumpTo(top);
          }}
        >
          <PhoneFeed key={token} api={api} token={token} />
        </DataSection>
      </div>
    </div>
  );
}
