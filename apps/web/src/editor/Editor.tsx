import type {
  EditorAppItem,
  EditorGoogleItem,
  EditorTemplate,
  EditorUnresolvedEntry,
  PublicConfig,
} from "@kidboard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ApiClient, useConfig } from "../data";
import { useApiClient } from "../data/apiContext";
import { QUERY_ROOT } from "../data/queryKeys";
import { type FormatContext, useFormatContext } from "../i18n/format";
import { useParentGate } from "../parent/parentGate";
import { PinPad } from "../parent/PinPad";
import { useToday } from "../time";
import { activityById, type QuickPick } from "./catalogue";
import {
  defaultStart,
  eventDraftFromEntry,
  eventDraftFromGoogle,
  eventDraftFromTemplate,
  mealDraftFromEntry,
  newEventDraft,
  newMealDraft,
} from "./draft";
import type { EditorActionContext } from "./editorActions";
import { EditorDialogs } from "./EditorDialogs";
import { EditorHome } from "./EditorHome";
import {
  draftOfItem,
  type EditTarget,
  type Pending,
  type View,
} from "./editorState";
import { EventForm } from "./EventForm";
import type { EditorFailure } from "./failure";
import { MealCopySection } from "./MealCopySection";
import { MealForm, type TakenMeal } from "./MealForm";
import { Toast } from "./Notice";
import { TID } from "./testIds";
import { DialogTrackerContext } from "./ui";
import { useBackup } from "./useBackup";
import { useEditorData } from "./useEditorData";
import { useEntryWrites } from "./useEntryWrites";
import { useMealCopy } from "./useMealCopy";

/**
 * The parent editor (T-45) inside the unlocked {@link EditorScreen}: the home view
 * (actions, "Again" row, the 14-day list, the Data section) and the event and meal
 * forms. Every write refetches the board's agenda at once. Failures are calm notices
 * with a `KB-*` code; a failed save keeps the form. When the worker reports the session
 * as locked, the PIN pad opens above the form, which stays.
 */
export function Editor(): React.JSX.Element | null {
  const config = useConfig().data;
  const { session } = useParentGate();
  const today = useToday(config?.timeZone);
  const format = useFormatContext(config?.timeZone ?? "UTC");
  const api = useApiClient();
  if (config === undefined || today === undefined || session === null) {
    return null;
  }
  return (
    <EditorBody
      api={api}
      config={config}
      today={today}
      token={session.token}
      format={format}
    />
  );
}

interface BodyProps {
  api: ApiClient;
  config: PublicConfig;
  today: string;
  token: string;
  format: FormatContext;
}

interface BodyProps {
  api: ApiClient;
  config: PublicConfig;
  today: string;
  token: string;
  format: FormatContext;
}

function EditorBody({
  api,
  config,
  today,
  token,
  format,
}: BodyProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const data = useEditorData(api, token, today);
  const [view, setView] = useState<View>({ kind: "home" });
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<EditorFailure | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The session the PIN pad was asked for: a new unlock (new token) hides it.
  const [relockFor, setRelockFor] = useState<string | null>(null);
  const clearToast = useCallback(() => {
    setToast(null);
  }, []);
  // Dialogs open anywhere in the editor (also those of the forms): the toast waits.
  const [dialogs, setDialogs] = useState(0);
  const trackDialog = useCallback(() => {
    setDialogs((count) => count + 1);
    return () => {
      setDialogs((count) => count - 1);
    };
  }, []);

  const refreshBoard = (): void => {
    data.reload();
    void queryClient.invalidateQueries({ queryKey: [QUERY_ROOT, "agenda"] });
  };
  const context: EditorActionContext = {
    api,
    token,
    setView,
    setPending,
    setToast,
    setBusy,
    setFailure,
    reload: data.reload,
    refreshBoard,
  };
  const writes = useEntryWrites(context);
  const backup = useBackup(context);
  const mealCopy = useMealCopy(context, today, data.list?.items ?? []);
  const unlock = (): void => {
    setRelockFor(token);
  };

  const open = (next: Exclude<View, { kind: "home" }>): void => {
    setFailure(null);
    mealCopy.clearCopy();
    setView(next);
  };
  const nextKey = (): number => {
    const key = formKey + 1;
    setFormKey(key);
    return key;
  };
  const home = (): void => {
    setFailure(null);
    mealCopy.clearCopy();
    setView({ kind: "home" });
  };

  const unresolvedTarget = (entry: EditorUnresolvedEntry): EditTarget => ({
    entryId: entry.entryId,
    revision: entry.revision,
    master: entry.entry,
    occurrenceDate: null,
    shownDate: entry.entry.date,
    hasOverride: false,
  });

  const editItem = (item: EditorAppItem): void => {
    const opened = draftOfItem(item);
    const target: EditTarget = {
      entryId: item.entryId,
      revision: item.revision,
      master: item.entry,
      occurrenceDate: item.occurrenceDate,
      shownDate: opened.draft.date,
      hasOverride: item.override !== null,
    };
    open(
      opened.kind === "event"
        ? { kind: "event", key: nextKey(), draft: opened.draft, target }
        : { kind: "meal", key: nextKey(), draft: opened.draft, target },
    );
  };

  const fixUnresolved = (entry: EditorUnresolvedEntry): void => {
    const target = unresolvedTarget(entry);
    open(
      entry.entry.kind === "meal"
        ? {
            kind: "meal",
            key: nextKey(),
            draft: mealDraftFromEntry(entry.entry),
            target,
          }
        : {
            kind: "event",
            key: nextKey(),
            draft: eventDraftFromEntry(entry.entry),
            target,
          },
    );
  };

  const fromGoogle = (item: EditorGoogleItem): void => {
    if (item.kind === "meal") {
      open({
        kind: "meal",
        key: nextKey(),
        target: null,
        draft: {
          ...newMealDraft(
            item.date < today ? today : item.date,
            item.slot ?? "unspecified",
          ),
          icon: item.iconIsFallback ? "" : item.icon,
          title: item.title.slice(0, 60),
        },
      });
      return;
    }
    open({
      kind: "event",
      key: nextKey(),
      target: null,
      draft: eventDraftFromGoogle(item, today),
    });
  };

  /** A suggestion of the "Again" row (events only, see `TemplatesRow`). */
  const fromTemplate = (template: EditorTemplate): void => {
    open({
      kind: "event",
      key: nextKey(),
      target: null,
      draft: eventDraftFromTemplate(template, today),
    });
  };

  const fromQuickPick = (pick: QuickPick): void => {
    const activity = activityById(pick.activity);
    const base = newEventDraft(today);
    open({
      kind: "event",
      key: nextKey(),
      target: null,
      draft: {
        ...base,
        icon: activity.icon,
        title: t(`editor.activity.${activity.id}`),
        titleFromLabel: true,
        allDay: pick.time === null,
        startTime: pick.time ?? base.startTime,
        repeat: pick.weekly ? "weekly" : "none",
        countdown: pick.countdown,
      },
    });
  };

  const shell = {
    config,
    today,
    format,
    busy,
    failure,
    onCancel: home,
    onUnlock: unlock,
  };

  let content: React.JSX.Element;
  if (view.kind === "event") {
    const target = view.target;
    content = (
      <EventForm
        key={view.key}
        {...shell}
        heading={t(
          target === null ? "editor.form.newTitle" : "editor.form.editTitle",
        )}
        initial={view.draft}
        onSubmit={(draft) => {
          writes.saveEvent(draft, target);
        }}
        onDelete={
          target === null
            ? undefined
            : () => {
                setPending({
                  kind: "delete",
                  title: view.draft.title.trim() || target.master.title,
                  target,
                });
              }
        }
      />
    );
  } else if (view.kind === "meal") {
    const target = view.target;
    // Meals of the 14-day list other than the edited entry, for the "already planned" hint.
    const takenMeals: TakenMeal[] = (data.list?.items ?? []).flatMap((item) =>
      item.kind === "meal" &&
      !(item.origin === "app" && item.entryId === target?.entryId)
        ? [
            {
              date: item.date,
              slot: item.slot ?? "unspecified",
              title: item.title,
            },
          ]
        : [],
    );
    content = (
      <MealForm
        key={view.key}
        {...shell}
        takenMeals={takenMeals}
        heading={t(
          target === null ? "editor.meal.newTitle" : "editor.meal.editTitle",
        )}
        initial={view.draft}
        onSubmit={(draft) => {
          writes.saveMeal(draft, target);
        }}
        onDelete={
          target === null
            ? undefined
            : () => {
                setPending({
                  kind: "delete",
                  title: view.draft.title.trim() || target.master.title,
                  target,
                });
              }
        }
        copyAction={
          target === null ? (
            <MealCopySection
              busy={busy}
              copy={mealCopy.copy}
              onStart={() => {
                void mealCopy.prepareCopy();
              }}
              onUnlock={unlock}
            />
          ) : undefined
        }
      />
    );
  } else {
    content = (
      <EditorHome
        api={api}
        token={token}
        config={config}
        today={today}
        format={format}
        data={data}
        backup={backup}
        busy={busy}
        failure={failure}
        onNewEvent={() => {
          const start = defaultStart(today, Date.now(), config.timeZone);
          open({
            kind: "event",
            key: nextKey(),
            target: null,
            draft: newEventDraft(start.date, start.startTime),
          });
        }}
        onNewMeal={() => {
          open({
            kind: "meal",
            key: nextKey(),
            target: null,
            draft: newMealDraft(today, "dinner"),
          });
        }}
        onTemplate={fromTemplate}
        onQuickPick={fromQuickPick}
        onEdit={editItem}
        onGoogle={fromGoogle}
        onFix={fixUnresolved}
        onDeleteUnresolved={(entry) => {
          setPending({
            kind: "delete",
            title: entry.entry.title,
            target: unresolvedTarget(entry),
          });
        }}
        onUnlock={unlock}
      />
    );
  }

  return (
    <DialogTrackerContext value={trackDialog}>
      <div className="h-full min-h-0" data-testid={TID.editor}>
        {content}
        <EditorDialogs
          pending={pending}
          today={today}
          format={format}
          onClose={() => {
            setPending(null);
          }}
          onDelete={writes.remove}
          onCopy={(plan) => {
            void mealCopy.runCopy(plan);
          }}
        />
        <Toast
          message={toast}
          onDone={clearToast}
          hidden={dialogs > 0 || relockFor === token}
        />
        {relockFor === token && <PinPad />}
      </div>
    </DialogTrackerContext>
  );
}
