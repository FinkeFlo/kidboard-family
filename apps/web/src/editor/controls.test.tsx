import { BRING_MAX } from "@kidboard/shared";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BEN, MIA } from "../components/fixtures.test-utils";
import { applyLocale } from "../i18n";
import type { FormatContext } from "../i18n/format";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { BringPicker } from "./BringPicker";
import { ChildPicker } from "./ChildPicker";
import type { RepeatMode } from "./draft";
import { TODAY } from "./fixtures.test-utils";
import { IconPicker } from "./IconPicker";
import { FailureNotice, Toast, TOAST_MS } from "./Notice";
import { RepeatPicker } from "./RepeatPicker";
import { ConfirmDialog } from "./ui";
import { WhenPicker } from "./WhenPicker";

const FORMAT: FormatContext = { locale: "en", timeZone: "Europe/Berlin" };

afterEach(() => {
  applyLocale("en");
  vi.useRealTimers();
});

describe("ChildPicker", () => {
  function Harness({
    initial = [],
    onValue,
  }: {
    initial?: string[];
    onValue: (ids: string[]) => void;
  }): React.JSX.Element {
    const [value, setValue] = useState(initial);
    return (
      <ChildPicker
        childList={[MIA, BEN]}
        value={value}
        onChange={(ids) => {
          setValue(ids);
          onValue(ids);
        }}
      />
    );
  }

  it("is a labelled group: Everyone is on exactly when nobody is picked", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const group = screen.getByRole("group", { name: en.editor.form.who });
    const everyone = within(group).getByRole("checkbox", {
      name: en.editor.form.everyone,
    });
    expect(everyone).toBeChecked();
    await userEvent.click(within(group).getByRole("checkbox", { name: "Ben" }));
    expect(everyone).not.toBeChecked();
    // Several children at once, kept in config order.
    await userEvent.click(within(group).getByRole("checkbox", { name: "Mia" }));
    expect(onValue).toHaveBeenLastCalledWith(["mia", "ben"]);
    await userEvent.click(everyone);
    expect(onValue).toHaveBeenLastCalledWith([]);
    expect(everyone).toBeChecked();
  });

  it("names a child that is no longer set up and lets it be removed", async () => {
    const onValue = vi.fn();
    render(<Harness initial={["mia", "lea"]} onValue={onValue} />);
    const unknown = screen.getByRole("checkbox", {
      name: "No longer set up (lea)",
    });
    expect(unknown).toBeChecked();
    await userEvent.click(unknown);
    expect(onValue).toHaveBeenLastCalledWith(["mia"]);
  });

  it("shows a field error and marks the group invalid", () => {
    render(
      <ChildPicker
        childList={[MIA]}
        value={[]}
        onChange={vi.fn()}
        error={en.editor.problem.children}
      />,
    );
    const group = screen.getByRole("group", { name: en.editor.form.who });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription(en.editor.problem.children);
  });
});

describe("IconPicker", () => {
  it("switches groups and passes the picked icon with its label", async () => {
    const onPick = vi.fn();
    render(<IconPicker icon="" onPick={onPick} />);
    const groups = screen.getByRole("radiogroup", {
      name: en.editor.form.groups,
    });
    expect(
      within(groups).getByRole("radio", { name: en.editor.group.sport }),
    ).toBeChecked();
    await userEvent.click(
      within(groups).getByRole("radio", {
        name: en.editor.group.appointments,
      }),
    );
    const icons = screen.getByRole("radiogroup", {
      name: en.editor.group.appointments,
    });
    await userEvent.click(
      within(icons).getByRole("radio", { name: /Dentist/u }),
    );
    expect(onPick).toHaveBeenCalledWith("🦷", "Dentist");
  });

  it("opens the group of the current icon with it checked", () => {
    render(<IconPicker icon="🎂" onPick={vi.fn()} />);
    expect(
      screen.getByRole("radio", { name: en.editor.group.celebrations }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /Birthday/u })).toBeChecked();
  });

  it("takes exactly one own emoji, without a label, and hints otherwise", async () => {
    const onPick = vi.fn();
    render(<IconPicker icon="" onPick={onPick} />);
    const own = screen.getByRole("textbox", { name: en.editor.form.ownEmoji });
    await userEvent.type(own, "ab");
    expect(own).toHaveAttribute("aria-invalid", "true");
    expect(own).toHaveAccessibleDescription(en.editor.form.ownEmojiInvalid);
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.clear(own);
    await userEvent.type(own, "🦖");
    expect(onPick).toHaveBeenLastCalledWith("🦖", null);
    expect(own).toHaveAttribute("aria-invalid", "false");
  });

  it("reports every typed text, also text that is no emoji", async () => {
    const onOwnText = vi.fn<(text: string) => void>();
    render(<IconPicker icon="" onPick={vi.fn()} onOwnText={onOwnText} />);
    const own = screen.getByRole("textbox", { name: en.editor.form.ownEmoji });
    await userEvent.type(own, "abc");
    expect(onOwnText).toHaveBeenLastCalledWith("abc");
    await userEvent.clear(own);
    expect(onOwnText).toHaveBeenLastCalledWith("");
  });

  it("long labels may wrap and hyphenate inside their chip", () => {
    applyLocale("de");
    render(<IconPicker icon="🌲" onPick={vi.fn()} />);
    const label = screen.getByText(de.editor.activity.forest);
    expect(label).toHaveClass("hyphens-auto", "break-words", "line-clamp-2");
    expect(label.closest("label")).toHaveClass("px-2");
  });

  it("marks an own icon as chosen", () => {
    render(<IconPicker icon="🦖" onPick={vi.fn()} />);
    expect(screen.getByTestId("own-icon")).toHaveTextContent(
      en.editor.form.ownEmojiChosen,
    );
    expect(
      within(screen.getByTestId("activity-icons")).queryByRole("radio", {
        checked: true,
      }),
    ).toBeNull();
  });
});

describe("WhenPicker", () => {
  function Harness(): React.JSX.Element {
    const [date, setDate] = useState(TODAY);
    const [allDay, setAllDay] = useState(false);
    const [startTime, setStartTime] = useState("15:00");
    const [duration, setDuration] = useState(75);
    return (
      <>
        <WhenPicker
          today={TODAY}
          format={FORMAT}
          date={date}
          onDate={setDate}
          allDay={allDay}
          onAllDay={setAllDay}
          startTime={startTime}
          onStartTime={setStartTime}
          duration={duration}
          onDuration={setDuration}
        />
        <output data-testid="state">
          {[date, String(allDay), startTime, String(duration)].join("|")}
        </output>
      </>
    );
  }
  const state = (): string | null => screen.getByTestId("state").textContent;

  it("shows a gentle notice without marking the field invalid", () => {
    const props = {
      today: TODAY,
      format: FORMAT,
      date: TODAY,
      onDate: vi.fn(),
      allDay: false,
      onAllDay: vi.fn(),
      startTime: "09:00",
      onStartTime: vi.fn(),
      duration: 60,
      onDuration: vi.fn(),
    };
    const { rerender } = render(
      <WhenPicker {...props} notice={en.editor.form.pastHint} />,
    );
    const notice = screen.getByTestId("when-notice");
    expect(notice).toHaveTextContent(en.editor.form.pastHint);
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("field-when")).not.toHaveAttribute(
      "aria-invalid",
    );
    rerender(<WhenPicker {...props} />);
    expect(notice).toBeEmptyDOMElement();
  });

  it("has today and tomorrow chips and a date field", async () => {
    render(<Harness />);
    const days = screen.getByRole("radiogroup", { name: en.editor.form.day });
    expect(within(days).getByRole("radio", { name: "Today" })).toBeChecked();
    await userEvent.click(
      within(days).getByRole("radio", { name: "Tomorrow" }),
    );
    expect(state()).toMatch(/^2026-11-23\|/u);
    const other = screen.getByLabelText(en.editor.form.otherDay);
    expect(other).toHaveValue("2026-11-23");
    expect(other).toHaveAttribute("min", "2026-11-21");
  });

  it("keeps a length that is no preset as its own chip and offers presets", async () => {
    render(<Harness />);
    const lengths = screen.getByRole("radiogroup", {
      name: en.editor.form.duration,
    });
    const names = within(lengths)
      .getAllByRole("radio")
      .map((radio) => radio.closest("label")?.textContent);
    expect(names).toEqual([
      "30 min",
      "45 min",
      "1 h",
      "75 min",
      "1½ h",
      "2 h",
      "3 h",
    ]);
    expect(
      within(lengths).getByRole("radio", { name: "75 min" }),
    ).toBeChecked();
    await userEvent.click(within(lengths).getByRole("radio", { name: "1½ h" }));
    expect(state()).toMatch(/\|90$/u);
  });

  it("all day hides the time and the duration", async () => {
    render(<Harness />);
    expect(screen.getByLabelText(en.editor.form.start)).toHaveValue("15:00");
    await userEvent.click(
      screen.getByRole("radio", { name: en.editor.form.allDay }),
    );
    expect(screen.queryByLabelText(en.editor.form.start)).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: en.editor.form.duration }),
    ).toBeNull();
    expect(state()).toContain("|true|");
  });
});

describe("RepeatPicker", () => {
  function Harness({
    onUntil = vi.fn(),
  }: {
    onUntil?: (until: string) => void;
  }): React.JSX.Element {
    const [repeat, setRepeat] = useState<RepeatMode>("none");
    const [weekdays, setWeekdays] = useState<number[]>([7]);
    const [interval, setInterval] = useState<1 | 2>(1);
    const [until, setUntil] = useState("2027-01-31");
    return (
      <RepeatPicker
        format={FORMAT}
        date={TODAY}
        repeat={repeat}
        onRepeat={setRepeat}
        weekdays={weekdays}
        onToggleWeekday={(day) => {
          setWeekdays((current) =>
            current.includes(day)
              ? current.filter((d) => d !== day)
              : [...current, day],
          );
        }}
        interval={interval}
        onInterval={setInterval}
        until={until}
        onUntil={(next) => {
          setUntil(next);
          onUntil(next);
        }}
      />
    );
  }

  it("shows weekdays, interval and the last day only for weekly", async () => {
    render(<Harness />);
    expect(
      screen.getByRole("radio", { name: en.editor.form.once }),
    ).toBeChecked();
    expect(screen.queryByRole("group", { name: en.editor.form.weekdays })).toBe(
      null,
    );
    await userEvent.click(
      screen.getByRole("radio", { name: en.editor.form.weekly }),
    );
    const days = screen.getByRole("group", { name: en.editor.form.weekdays });
    expect(within(days).getAllByRole("checkbox")).toHaveLength(7);
    // The date's own weekday (Sunday) is on and cannot be switched off.
    const sunday = within(days).getByRole("checkbox", { name: "Sunday" });
    expect(sunday).toBeChecked();
    expect(sunday).toBeDisabled();
    const tuesday = within(days).getByRole("checkbox", { name: "Tuesday" });
    await userEvent.click(tuesday);
    expect(tuesday).toBeChecked();
    await userEvent.click(
      screen.getByRole("radio", { name: en.editor.form.everyOtherWeek }),
    );
    expect(
      screen.getByRole("radio", { name: en.editor.form.everyOtherWeek }),
    ).toBeChecked();
  });

  it("clears the last day with one button", async () => {
    const onUntil = vi.fn();
    render(<Harness onUntil={onUntil} />);
    await userEvent.click(
      screen.getByRole("radio", { name: en.editor.form.weekly }),
    );
    expect(screen.getByLabelText(en.editor.form.until)).toHaveValue(
      "2027-01-31",
    );
    await userEvent.click(
      screen.getByRole("button", { name: en.editor.form.noEnd }),
    );
    expect(onUntil).toHaveBeenLastCalledWith("");
    expect(
      screen.queryByRole("button", { name: en.editor.form.noEnd }),
    ).toBeNull();
  });

  it("names the weekdays in German", async () => {
    act(() => {
      applyLocale("de");
    });
    render(<HarnessDe />);
    await userEvent.click(
      screen.getByRole("radio", { name: de.editor.form.weekly }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Sonntag" }),
    ).toBeInTheDocument();
  });

  function HarnessDe(): React.JSX.Element {
    const [repeat, setRepeat] = useState<RepeatMode>("none");
    return (
      <RepeatPicker
        format={{ locale: "de", timeZone: "Europe/Berlin" }}
        date={TODAY}
        repeat={repeat}
        onRepeat={setRepeat}
        weekdays={[7]}
        onToggleWeekday={vi.fn()}
        interval={1}
        onInterval={vi.fn()}
        until=""
        onUntil={vi.fn()}
      />
    );
  }
});

describe("BringPicker", () => {
  function Harness({
    initial = [],
  }: {
    initial?: string[];
  }): React.JSX.Element {
    const [value, setValue] = useState(initial);
    return (
      <>
        <BringPicker value={value} onChange={setValue} />
        <output data-testid="bring">{value.join(" ")}</output>
      </>
    );
  }

  it("toggles catalogue items and adds own emoji as removable chips", async () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: en.editor.form.bring });
    await userEvent.click(
      within(group).getByRole("checkbox", { name: /Swimsuit/u }),
    );
    const own = within(group).getByRole("textbox", {
      name: en.editor.form.ownBring,
    });
    const add = within(group).getByRole("button", { name: en.editor.form.add });
    expect(add).toBeDisabled();
    await userEvent.type(own, "🪀{Enter}");
    expect(screen.getByTestId("bring")).toHaveTextContent("🩱 🪀");
    expect(own).toHaveValue("");
    const ownChip = within(group).getByRole("checkbox", { name: "Bring 🪀" });
    await userEvent.click(ownChip);
    expect(screen.getByTestId("bring")).toHaveTextContent(/^🩱$/u);
    await userEvent.click(
      within(group).getByRole("checkbox", { name: /Swimsuit/u }),
    );
    expect(screen.getByTestId("bring")).toBeEmptyDOMElement();
  });

  it(`stops at ${String(BRING_MAX)} items: others disabled, no own field`, () => {
    render(
      <Harness initial={["👟", "🩱", "🥽", "🧴", "🧢", "🧥", "☂️", "🍎"]} />,
    );
    const group = screen.getByRole("group", { name: en.editor.form.bring });
    expect(
      within(group).getByRole("checkbox", { name: /Books/u }),
    ).toBeDisabled();
    expect(
      within(group).getByRole("checkbox", { name: /Swimsuit/u }),
    ).toBeEnabled();
    expect(
      within(group).queryByRole("textbox", { name: en.editor.form.ownBring }),
    ).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("focuses the safe choice, keeps Tab inside, cancels on Escape and restores focus", async () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            {"open"}
          </button>
          {open && (
            <ConfirmDialog
              title="Delete Swimming?"
              text="It disappears from the board."
              cancelLabel="Keep"
              onCancel={() => {
                onCancel();
                setOpen(false);
              }}
              actions={[{ label: "Delete", onSelect, tone: "primary" }]}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete Swimming?",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("It disappears from the board.");
    // Focus starts on the safe choice (last) and stays inside: Tab wraps around.
    const keep = screen.getByRole("button", { name: "Keep" });
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(keep).toHaveFocus();
    await userEvent.tab();
    expect(remove).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(keep).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    expect(keep).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("FailureNotice and Toast", () => {
  it("is one calm sentence with the code; locked offers the PIN, others retry", async () => {
    const onUnlock = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(
      <FailureNotice
        failure={{ kind: "locked", code: "KB-LOCK", issues: [] }}
        onUnlock={onUnlock}
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(en.editor.error.locked);
    expect(alert).toHaveTextContent("KB-LOCK");
    expect(
      screen.queryByRole("button", { name: en.editor.action.retry }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: en.editor.action.unlockAgain }),
    );
    expect(onUnlock).toHaveBeenCalledTimes(1);
    rerender(
      <FailureNotice
        failure={{ kind: "offline", code: "KB-NET", issues: [] }}
        onUnlock={onUnlock}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.editor.error.offline,
    );
    await userEvent.click(
      screen.getByRole("button", { name: en.editor.action.retry }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a toast can be closed at once and is not shown under a dialog", async () => {
    const onDone = vi.fn();
    const { rerender } = render(
      <Toast message="Saved." onDone={onDone} hidden />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    rerender(<Toast message="Saved." onDone={onDone} />);
    expect(region).toHaveTextContent("Saved.");
    // At the top of the editor, never over the list rows or the form's actions.
    expect(region).toHaveClass("top-0");
    expect(region).not.toHaveClass("bottom-6");
    await userEvent.click(
      within(region).getByRole("button", { name: en.editor.toast.close }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a toast is a polite status that hides itself", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<Toast message="Saved." onDone={onDone} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
