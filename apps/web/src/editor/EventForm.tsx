import type { PublicConfig } from "@kidboard/shared";
import {
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Emoji } from "../components/Emoji";
import type { FormatContext } from "../i18n/format";
import { useNow } from "../time";
import { BringPicker } from "./BringPicker";
import { ACTIVITIES } from "./catalogue";
import { ChildPicker } from "./ChildPicker";
import {
  draftChanged,
  type DraftProblem,
  type EventDraft,
  eventDraftProblems,
  isCountdownIcon,
  isEmoji,
  previewEvent,
  problemsOf,
  ruleDate,
  startsInPast,
  toggleWeekday,
  withDate,
} from "./draft";
import type { EditorFailure } from "./failure";
import { IconPicker, sameIcon } from "./IconPicker";
import { FailureNotice } from "./Notice";
import { EventPreview } from "./Preview";
import { RepeatPicker } from "./RepeatPicker";
import { revealFirstInvalid } from "./reveal";
import { TID } from "./testIds";
import { ChoiceChip, ConfirmDialog, EditorButton, Field } from "./ui";
import { WhenPicker } from "./WhenPicker";

export interface FormShellProps {
  heading: string;
  config: PublicConfig;
  today: string;
  format: FormatContext;
  /** A save or delete is running: the actions are disabled, the form stays. */
  busy: boolean;
  /** The last failed save or delete (the form keeps what was entered). */
  failure: EditorFailure | null;
  onCancel: () => void;
  /** Edit mode only. */
  onDelete?: (() => void) | undefined;
  /** For a `locked` failure: show the PIN pad again. */
  onUnlock: () => void;
}

export interface EventFormProps extends FormShellProps {
  initial: EventDraft;
  onSubmit: (draft: EventDraft) => void;
}

const MAX_TITLE = 60;

/** The title field: pre-filled from the picked icon's label, optional to change. */
export function TitleInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (title: string) => void;
  error?: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  return (
    <div className="flex scroll-mt-4 flex-col gap-2" data-editor-field="">
      <label htmlFor={id} className="text-title">
        {t("editor.form.name")}
      </label>
      <p id={hintId} className="text-meta text-text-muted">
        {t("editor.form.nameHint")}
      </p>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={MAX_TITLE}
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-touch-parent rounded-tile bg-surface-raised text-text inset-ring-input-border text-tile focus-visible:outline-accent w-full max-w-[36rem] px-4 inset-ring-2 focus-visible:outline-4"
      />
      {error !== undefined && (
        <p id={errorId} className="text-body text-danger" data-field-error="">
          {error}
        </p>
      )}
    </div>
  );
}

/** Calm field messages of a draft's problems. */
export function useProblemMessages(
  problems: readonly DraftProblem[],
): Partial<Record<DraftProblem, string>> {
  const { t } = useTranslation();
  const messages: Partial<Record<DraftProblem, string>> = {};
  for (const problem of problems) {
    messages[problem] = t(`editor.problem.${problem}`);
  }
  return messages;
}

/** True when `text` (typed into "your own emoji") is something that is no emoji. */
export function ownEmojiInvalid(text: string): boolean {
  return text.trim() !== "" && !isEmoji(text);
}

/**
 * Whether a newly picked catalogue icon may replace the title: it is empty, still the
 * label of the picked icon, or still the default name of the previous icon (`previous`,
 * e.g. an edited entry that kept the catalogue name), never a name the parent typed.
 */
export function titleFollowsPicture(
  current: { title: string; titleFromLabel: boolean },
  previous: string | null,
): boolean {
  const title = current.title.trim();
  return (
    title === "" ||
    current.titleFromLabel ||
    (previous !== null && title === previous)
  );
}

/**
 * Cancel of a form: leaves at once when nothing changed, otherwise asks once whether
 * to drop the changes (the safe choice keeps editing).
 */
export function useDiscardGuard(
  changed: boolean,
  onCancel: () => void,
): { cancel: () => void; dialog: React.ReactNode } {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const cancel = (): void => {
    if (changed) setAsking(true);
    else onCancel();
  };
  const dialog = asking ? (
    <ConfirmDialog
      title={t("editor.discard.title")}
      text={t("editor.discard.text")}
      cancelLabel={t("editor.discard.keep")}
      onCancel={() => {
        setAsking(false);
      }}
      actions={[
        {
          label: t("editor.discard.action"),
          tone: "danger",
          "data-testid": TID.confirmDiscard,
          onSelect: () => {
            setAsking(false);
            onCancel();
          },
        },
      ]}
    />
  ) : null;
  return { cancel, dialog };
}

/**
 * After a save that was refused (by the form, `attempts` counts them, or by the worker
 * as `invalid`): the first invalid field is scrolled into view and focused.
 */
export function useRevealInvalid(
  form: RefObject<HTMLFormElement | null>,
  attempts: number,
  failure: EditorFailure | null,
): void {
  useEffect(() => {
    if (attempts > 0) revealFirstInvalid(form.current);
  }, [form, attempts]);
  useEffect(() => {
    if (failure?.kind === "invalid") revealFirstInvalid(form.current);
  }, [form, failure]);
}

/** Save / Cancel / Delete, the failure notice and the preview beside the form. */
export function FormAside({
  preview,
  shell,
  onCancel,
  general,
  saveLabel,
  children,
}: {
  preview: React.ReactNode;
  shell: FormShellProps;
  /** Cancel (asks first when the form has changes, see {@link useDiscardGuard}). */
  onCancel: () => void;
  /** A problem that belongs to no single field. */
  general?: string | undefined;
  saveLabel: string;
  /** More actions below the buttons (e.g. "repeat last week's meals"). */
  children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <aside className="gap-gutter flex min-h-0 flex-col overflow-y-auto">
      {preview}
      {shell.failure !== null && (
        <FailureNotice failure={shell.failure} onUnlock={shell.onUnlock} />
      )}
      {general !== undefined && (
        <p className="text-body text-danger" role="alert">
          {general}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <EditorButton
          type="submit"
          tone="primary"
          disabled={shell.busy}
          className="text-title min-w-40 flex-1"
          data-testid={TID.editorSave}
        >
          {shell.busy ? t("editor.action.saving") : saveLabel}
        </EditorButton>
        <EditorButton
          onClick={onCancel}
          disabled={shell.busy}
          data-testid={TID.editorCancel}
        >
          {t("editor.action.cancel")}
        </EditorButton>
      </div>
      {shell.onDelete !== undefined && (
        <EditorButton
          onClick={shell.onDelete}
          disabled={shell.busy}
          className="self-start"
          data-testid={TID.editorDelete}
        >
          <Emoji emoji="🗑️" className="text-[1.5rem]" />
          {t("editor.action.delete")}
        </EditorButton>
      )}
      {children}
    </aside>
  );
}

/**
 * The one-screen form of an event (T-45 criterion 2): who, what (catalogue, own emoji,
 * name), when, repeat, bring along and the countdown, with the live preview, the
 * actions and any failure beside it. Nothing typed is lost on a failed save: the form
 * keeps its state and the parent can try again.
 */
export function EventForm(props: EventFormProps): React.JSX.Element {
  const { initial, config, today, format, failure, onSubmit, heading } = props;
  const { t } = useTranslation();
  const now = useNow();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [refused, setRefused] = useState(0);
  const [ownText, setOwnText] = useState("");
  const update = (patch: Partial<EventDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const local = useMemo(
    () => eventDraftProblems(draft, config),
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
  const whatError =
    messages.icon ??
    (attempted && ownInvalid ? t("editor.problem.ownEmoji") : undefined);
  const forcedCountdown = isCountdownIcon(draft.icon, config);
  const fallbackTitle = t("editor.form.previewTitle");
  const preview = previewEvent(draft, config.timeZone, fallbackTitle);
  const past = startsInPast(draft, today, now, config.timeZone);
  const headingId = useId();
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
      data-testid={TID.eventForm}
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
        <ChildPicker
          childList={config.children}
          value={draft.childIds}
          onChange={(childIds) => {
            update({ childIds });
          }}
          error={messages.children}
        />
        <IconPicker
          icon={draft.icon}
          error={whatError}
          onOwnText={setOwnText}
          onPick={(icon, label) => {
            setDraft((current) => {
              const previous = ACTIVITIES.find((activity) =>
                sameIcon(activity.icon, current.icon),
              );
              const replaceTitle =
                label !== null &&
                titleFollowsPicture(
                  current,
                  previous === undefined
                    ? null
                    : t(`editor.activity.${previous.id}`),
                );
              return {
                ...current,
                icon,
                ...(replaceTitle ? { title: label, titleFromLabel: true } : {}),
                ...(isCountdownIcon(icon, config) ? { countdown: true } : {}),
              };
            });
          }}
        />
        <TitleInput
          value={draft.title}
          error={messages.title}
          onChange={(title) => {
            update({ title, titleFromLabel: false });
          }}
        />
        <WhenPicker
          today={today}
          format={format}
          date={draft.date}
          onDate={(date) => {
            setDraft((current) => withDate(current, date));
          }}
          allDay={draft.allDay}
          onAllDay={(allDay) => {
            update({ allDay });
          }}
          startTime={draft.startTime}
          onStartTime={(startTime) => {
            update({ startTime });
          }}
          duration={draft.duration}
          onDuration={(duration) => {
            update({ duration });
          }}
          error={messages.time}
          notice={past ? t("editor.form.pastHint") : undefined}
        />
        <RepeatPicker
          format={format}
          date={ruleDate(draft)}
          repeat={draft.repeat}
          onRepeat={(repeat) => {
            update({ repeat });
          }}
          weekdays={draft.weekdays}
          onToggleWeekday={(day) => {
            setDraft((current) => toggleWeekday(current, day));
          }}
          interval={draft.interval}
          onInterval={(interval) => {
            update({ interval });
          }}
          until={draft.until}
          onUntil={(until) => {
            update({ until });
          }}
          error={messages.until}
        />
        <BringPicker
          value={draft.bring}
          onChange={(bring) => {
            update({ bring });
          }}
        />
        <Field
          legend={t("editor.form.countdown")}
          hint={
            forcedCountdown
              ? t("editor.form.countdownForced")
              : t("editor.form.countdownHint")
          }
          data-testid={TID.fieldCountdown}
        >
          <div>
            <ChoiceChip
              type="checkbox"
              checked={draft.countdown || forcedCountdown}
              disabled={forcedCountdown}
              onChange={() => {
                update({ countdown: !draft.countdown });
              }}
            >
              <Emoji emoji="🌙" className="text-[1.5rem]" />
              {t("editor.form.countdownToggle")}
            </ChoiceChip>
          </div>
        </Field>
      </div>
      <FormAside
        shell={props}
        onCancel={guard.cancel}
        saveLabel={t("editor.action.save")}
        general={messages.invalid}
        preview={
          <EventPreview
            event={preview}
            childList={config.children}
            format={format}
            config={config}
          />
        }
      />
      {guard.dialog}
    </form>
  );
}
