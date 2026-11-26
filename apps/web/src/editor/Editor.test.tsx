import { addCalendarDays, type PublicConfig } from "@kidboard/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEN, eventFixture, MIA } from "../components/fixtures.test-utils";
import { TEST_TOKEN } from "../data/testing.test-utils";
import en from "../i18n/locales/en.json";
import { type EditorHarness, renderEditor } from "./editor.test-utils";
import {
  DENTIST,
  editorConfig,
  NOW_ISO,
  PIZZA,
  SESSION,
  SWIM,
  TODAY,
} from "./fixtures.test-utils";

/*
 * The whole editor (T-45) against the in-memory fake editor API: every flow goes
 * through the real ApiClient (session header, query, body) and the list is read back
 * from the fake, so the tests check what the worker would store. Only `Date` is faked
 * (Sunday 2026-11-22 12:00 in Berlin), advancing with real time.
 */

const user = userEvent.setup();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse(NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function home(): Promise<HTMLElement> {
  const list = await screen.findByTestId("entry-list");
  return list;
}

function form(name: string): HTMLElement {
  return screen.getByRole("form", { name });
}

async function save(): Promise<void> {
  await user.click(screen.getByRole("button", { name: en.editor.action.save }));
}

function writes(h: EditorHarness): string[] {
  return h.editor.writes.map(
    (w) => `${w.method} ${w.path.replace(/[0-9a-f-]{36}/u, ":id")}?${w.query}`,
  );
}

describe("Editor: home", () => {
  it("lists the next 14 days with the session and shows the empty state", async () => {
    const h = renderEditor();
    expect(await screen.findByTestId("entry-list-empty")).toHaveTextContent(
      en.editor.list.empty,
    );
    expect(h.requests).toContain(
      `GET /api/parent/entries?from=${TODAY}&days=14`,
    );
    expect(h.requests).toContain("GET /api/parent/templates");
    expect(
      screen.getByRole("heading", { name: en.editor.list.title }),
    ).toBeInTheDocument();
    for (const name of [
      en.editor.templates.quick.swimmingWeekly,
      en.editor.templates.quick.birthday,
      en.editor.templates.quick.dentist,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("groups by day (today first) with meals per slot and the series mark", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
        editor.seed(SWIM);
        editor.seed(PIZZA);
        editor.seed({
          ...PIZZA,
          icon: "🥣",
          title: "Muesli",
          slot: "breakfast",
        });
      },
    });
    await home();
    const days = screen.getAllByTestId("editor-day");
    expect(days.map((d) => d.dataset["date"])).toEqual([
      TODAY,
      "2026-11-23",
      "2026-11-29",
    ]);
    const first = days[0];
    if (first === undefined) throw new Error("no day");
    expect(within(first).getByRole("heading", { level: 4 })).toHaveTextContent(
      /^Today · Sunday, /u,
    );
    const meals = within(first).getByRole("list", {
      name: en.editor.list.meals,
    });
    expect(
      within(meals)
        .getAllByTestId("editor-item")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("Muesli"),
      expect.stringContaining("Pizza"),
    ]);
    // Swimming repeats every Sunday: marked on each occurrence, single entries are not.
    const marks = within(first).getAllByTestId("series-mark");
    expect(marks).toHaveLength(1);
    // The repeat is visible text (the form's words), not only an icon.
    expect(marks[0]).toHaveTextContent(en.editor.form.everyWeek);
    expect(within(first).queryByTestId("changed-tag")).toBeNull();
    expect(
      within(days[1] as HTMLElement).queryByTestId("series-mark"),
    ).toBeNull();
  });

  it("shows Google entries read-only with 'use as template'", async () => {
    renderEditor({
      google: () => ({
        events: [
          eventFixture({
            id: "g-piano",
            title: "Piano",
            icon: "🎹",
            childIds: ["ben"],
            start: "2026-11-23T16:30:00+01:00",
            end: "2026-11-23T17:15:00+01:00",
          }),
        ],
        meals: [],
      }),
    });
    await home();
    const row = screen.getByTestId("editor-item");
    expect(row).toHaveAttribute("data-origin", "google");
    expect(within(row).getByTestId("google-note")).toHaveTextContent(
      en.editor.list.fromGoogle,
    );
    expect(within(row).queryByTestId("edit-entry")).toBeNull();
    await user.click(
      within(row).getByRole("button", { name: "Use Piano as template" }),
    );
    const newForm = form(en.editor.form.newTitle);
    expect(within(newForm).getByLabelText(en.editor.form.name)).toHaveValue(
      "Piano",
    );
    expect(within(newForm).getByLabelText(en.editor.form.start)).toHaveValue(
      "16:30",
    );
    expect(
      within(newForm).getByRole("checkbox", { name: "Ben" }),
    ).toBeChecked();
  });

  it("names unresolved entries with a fix and a delete path", async () => {
    let fakeConfig: PublicConfig = editorConfig({
      children: [
        MIA,
        BEN,
        { id: "lea", name: "Lea", color: "child-3", avatar: "🦉" },
      ],
    });
    const h = renderEditor({
      fakeConfig: () => fakeConfig,
      setup: (editor) => {
        editor.seed({ ...DENTIST, childIds: ["lea"], title: "Lea dentist" });
        fakeConfig = editorConfig();
      },
    });
    const section = await screen.findByTestId("unresolved");
    expect(section).toHaveTextContent(en.editor.list.unresolvedChild);
    await user.click(
      within(section).getByRole("button", { name: "Delete Lea dentist" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete “Lea dentist”?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: en.editor.action.delete }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("unresolved")).toBeNull();
    });
    expect(writes(h)).toEqual([
      "DELETE /api/parent/entries/:id?scope=series&revision=1",
    ]);
  });

  it("fixing an unresolved entry opens the form with the unknown child removable", async () => {
    let fakeConfig: PublicConfig = editorConfig({
      children: [
        MIA,
        BEN,
        { id: "lea", name: "Lea", color: "child-3", avatar: "🦉" },
      ],
    });
    renderEditor({
      fakeConfig: () => fakeConfig,
      setup: (editor) => {
        editor.seed({ ...DENTIST, childIds: ["lea"], title: "Lea dentist" });
        fakeConfig = editorConfig();
      },
    });
    const section = await screen.findByTestId("unresolved");
    await user.click(
      within(section).getByRole("button", { name: "Change Lea dentist" }),
    );
    const edit = form(en.editor.form.editTitle);
    const unknown = within(edit).getByRole("checkbox", {
      name: "No longer set up (lea)",
    });
    await save();
    expect(
      within(edit).getByRole("group", { name: en.editor.form.who }),
    ).toHaveAccessibleDescription(en.editor.problem.children);
    await user.click(unknown);
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
  });

  it("shows a calm notice when the worker has no storage", async () => {
    renderEditor({
      setup: (editor) => {
        editor.setStorageUnavailable(true);
      },
    });
    const notice = await screen.findByTestId("storage-unavailable");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("KB-503");
  });

  it("renders XSS-looking titles as plain text", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    renderEditor({
      setup: (editor) => {
        editor.seed({ ...DENTIST, title: evil });
      },
    });
    await home();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(
      0,
    );
    expect(document.querySelector("img[src='x']")).toBeNull();
    await user.click(screen.getByRole("button", { name: `Change ${evil}` }));
    expect(screen.getByLabelText(en.editor.form.name)).toHaveValue(evil);
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("Editor: new entries", () => {
  it("weekly swimming for Mia: quick pick, one tap, save – board refreshed", async () => {
    const h = renderEditor();
    const invalidate = vi.spyOn(h.queryClient, "invalidateQueries");
    await home();
    await user.click(
      screen.getByRole("button", {
        name: en.editor.templates.quick.swimmingWeekly,
      }),
    );
    const newForm = form(en.editor.form.newTitle);
    expect(within(newForm).getByLabelText(en.editor.form.name)).toHaveValue(
      "Swimming",
    );
    expect(
      within(newForm).getByRole("radio", { name: en.editor.form.weekly }),
    ).toBeChecked();
    await user.click(within(newForm).getByRole("checkbox", { name: "Mia" }));
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(h.editor.entries().map((e) => e.data)).toEqual([
      expect.objectContaining({
        kind: "event",
        childIds: ["mia"],
        icon: "🏊",
        title: "Swimming",
        date: TODAY,
        startTime: "15:00",
        endTime: "16:00",
        repeat: { weekly: { weekdays: [7], interval: 1 } },
      }),
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["kidboard", "agenda"],
    });
    // Back home, the list was read again and shows the series.
    await waitFor(() => {
      expect(screen.getAllByTestId("series-mark").length).toBeGreaterThan(0);
    });
  });

  it("asks for a picture first and keeps a typed name when the picture changes", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await save();
    expect(
      screen.getByRole("group", { name: en.editor.form.what }),
    ).toHaveAccessibleDescription(en.editor.problem.icon);
    expect(h.editor.writes).toEqual([]);
    await user.click(
      screen.getByRole("radio", { name: en.editor.group.appointments }),
    );
    await user.click(screen.getByRole("radio", { name: /Dentist/u }));
    const name = screen.getByLabelText(en.editor.form.name);
    expect(name).toHaveValue("Dentist");
    await user.click(screen.getByRole("radio", { name: /Doctor/u }));
    expect(name).toHaveValue("Doctor");
    await user.clear(name);
    await user.type(name, "Dr. Brown");
    await user.click(screen.getByRole("radio", { name: /Dentist/u }));
    expect(name).toHaveValue("Dr. Brown");
    expect(screen.getByTestId("entry-preview")).toHaveTextContent("Dr. Brown");
  });

  it("a countdown picture switches the countdown on for good", async () => {
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.birthday }),
    );
    const toggle = screen.getByRole("checkbox", {
      name: en.editor.form.countdownToggle,
    });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(
      screen.getByRole("group", { name: en.editor.form.countdown }),
    ).toHaveAccessibleDescription(en.editor.form.countdownForced);
  });

  it("keeps the form when offline and saves once the network is back", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    const name = screen.getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "Check-up");
    h.network.offline = true;
    await save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.editor.error.offline);
    expect(alert).toHaveTextContent("KB-NET");
    expect(screen.getByLabelText(en.editor.form.name)).toHaveValue("Check-up");
    h.network.offline = false;
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(h.editor.entries()[0]?.data.title).toBe("Check-up");
  });

  it("a full editor (limit_reached) is a calm notice, nothing is lost", async () => {
    const h = renderEditor({ maxEntries: 0 });
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("KB-LIMIT");
    expect(form(en.editor.form.newTitle)).toBeInTheDocument();
    expect(h.editor.entries()).toEqual([]);
  });

  it("a locked session opens the PIN pad above the form; after the PIN the form saves with the new session", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    const name = screen.getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "Check-up");
    // The session ran out on the worker (403 parent_locked, never 401).
    h.sessions.delete(SESSION);
    await save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.editor.error.locked);
    await user.click(
      within(alert).getByRole("button", {
        name: en.editor.action.unlockAgain,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: en.parent.pin.title }),
    ).toBeInTheDocument();
    expect(form(en.editor.form.newTitle)).toBeInTheDocument();
    // A 403 is never the board's 401: the gate was not locked by the editor.
    expect(h.gate.lock).not.toHaveBeenCalled();

    const renewed = "v1.0.TESTONLY-second-session";
    h.sessions.add(renewed);
    act(() => {
      h.unlockAs(renewed);
    });
    expect(screen.queryByRole("dialog", { name: en.parent.pin.title })).toBe(
      null,
    );
    expect(screen.getByLabelText(en.editor.form.name)).toHaveValue("Check-up");
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    const posts = h.requests
      .map((request, index) => ({ request, headers: h.headers[index] }))
      .filter(({ request }) => request === "POST /api/parent/entries");
    expect(posts.map(({ headers }) => headers?.session)).toEqual([
      SESSION,
      renewed,
    ]);
    expect(h.editor.entries().map((entry) => entry.data.title)).toEqual([
      "Check-up",
    ]);
  });

  it("a 401 from an editor call is a calm notice and keeps the board's access token", async () => {
    const h = renderEditor();
    await home();
    await waitFor(() => {
      expect(h.queryClient.getQueryData(["kidboard", "config"])).toBeDefined();
    });
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    h.editor.failNext("POST", {
      status: 401,
      json: { error: "unauthorized", message: "" },
    });
    await save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.editor.error.unauthorized);
    expect(alert).toHaveTextContent("KB-401");
    expect(h.onUnauthorized).not.toHaveBeenCalled();
    expect(h.queryClient.getQueryData(["kidboard", "config"])).toBeDefined();
    expect(form(en.editor.form.newTitle)).toBeInTheDocument();
    await save();
    await screen.findByRole("status");
    expect(h.headers.at(-1)?.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(h.onUnauthorized).not.toHaveBeenCalled();
  });

  it("Cancel returns home without writing", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    expect(await screen.findByTestId("editor-home")).toBeInTheDocument();
    expect(h.editor.writes).toEqual([]);
  });
});

describe("Editor: templates", () => {
  it("the 'Again' row offers stored entries and pre-fills a new one from them", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM);
      },
    });
    await home();
    const row = screen.getByTestId("templates-row");
    const [suggestion] = within(row).getAllByTestId("template");
    expect(suggestion).toHaveTextContent("Swimming");
    await user.click(suggestion as HTMLElement);
    const newForm = form(en.editor.form.newTitle);
    expect(within(newForm).getByLabelText(en.editor.form.name)).toHaveValue(
      "Swimming",
    );
    expect(
      within(newForm).getByRole("checkbox", { name: "Mia" }),
    ).toBeChecked();
    expect(
      within(newForm).getByRole("checkbox", { name: /Swimsuit/u }),
    ).toBeChecked();
    // A suggestion is a new single entry, not an edit of the old one.
    expect(
      within(newForm).getByRole("radio", { name: en.editor.form.once }),
    ).toBeChecked();
    expect(h.editor.writes).toEqual([]);
  });

  it("the meal form switches slot and day and takes an own dish", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    const mealForm = form(en.editor.meal.newTitle);
    await user.click(
      within(mealForm).getByRole("radio", { name: en.editor.meal.slots.lunch }),
    );
    await user.click(within(mealForm).getByRole("radio", { name: "Tomorrow" }));
    await user.type(
      within(mealForm).getByRole("textbox", { name: en.editor.form.ownEmoji }),
      "🫕",
    );
    await user.type(
      within(mealForm).getByLabelText(en.editor.form.name),
      "Fondue",
    );
    expect(screen.getByTestId("meal-preview")).toHaveTextContent("Fondue");
    await save();
    await screen.findByRole("status");
    expect(h.editor.entries()[0]?.data).toMatchObject({
      icon: "🫕",
      title: "Fondue",
      slot: "lunch",
      date: "2026-11-23",
    });
  });
});

describe("Editor: change and delete", () => {
  it("a series asks 'only on <date>' or 'every week' and sends scope, date and revision", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM);
      },
    });
    await home();
    const [today] = screen.getAllByRole("button", { name: "Change Swimming" });
    if (today === undefined) throw new Error("no row");
    await user.click(today);
    const edit = form(en.editor.form.editTitle);
    await user.click(within(edit).getByRole("radio", { name: "45 min" }));
    await save();
    const dialog = screen.getByRole("alertdialog", {
      name: "Change “Swimming”",
    });
    expect(dialog).toHaveAccessibleDescription(en.editor.scope.text);
    await user.click(
      within(dialog).getByRole("button", { name: "Only on Sun, Nov 22" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(writes(h)).toEqual([
      "PATCH /api/parent/entries/:id?scope=one&date=2026-11-22",
    ]);
    expect(h.editor.writes[0]?.body).toMatchObject({
      revision: 1,
      entry: { startTime: "15:00", endTime: "15:45", repeat: "none" },
    });
    const stored = h.editor.entries()[0];
    expect(stored?.data.endTime).toBe("16:00");
    expect(Object.keys(stored?.overrides ?? {})).toEqual([TODAY]);
  });

  it("'every week' keeps the series start when another day was opened", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM);
      },
    });
    await home();
    const rows = screen.getAllByRole("button", { name: "Change Swimming" });
    await user.click(rows[1] as HTMLElement);
    const edit = form(en.editor.form.editTitle);
    expect(within(edit).getByLabelText(en.editor.form.otherDay)).toHaveValue(
      "2026-11-29",
    );
    await user.click(within(edit).getByRole("checkbox", { name: "Ben" }));
    await save();
    await user.click(
      screen.getByRole("button", { name: en.editor.scope.series }),
    );
    await screen.findByRole("status");
    expect(writes(h)).toEqual(["PATCH /api/parent/entries/:id?scope=series"]);
    expect(h.editor.entries()[0]?.data).toMatchObject({
      date: TODAY,
      childIds: ["mia", "ben"],
      repeat: { weekly: { weekdays: [7], interval: 1 } },
    });
  });

  it("a single entry saves without asking; a conflict keeps the form and overwrites on purpose", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Dentist" }));
    const name = screen.getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "Dentist Ben");
    h.editor.failNext("PATCH", {
      status: 409,
      json: { error: "conflict", message: "", revision: 4 },
    });
    await save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("KB-409");
    expect(screen.getByLabelText(en.editor.form.name)).toHaveValue(
      "Dentist Ben",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await save();
    await screen.findByRole("status");
    const bodies = h.editor.writes.map(
      (w) => (w.body as { revision: number }).revision,
    );
    expect(bodies).toEqual([1, 4]);
  });

  it("a delete that meets a newer version says so and deletes on the second try", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Dentist" }));
    // Someone else changes the entry meanwhile (revision 1 → 2).
    const id = h.editor.entries()[0]?.id ?? "";
    h.editor.handle({
      method: "PATCH",
      path: `/api/parent/entries/${id}`,
      search: "scope=series",
      body: JSON.stringify({
        revision: 1,
        entry: { ...DENTIST, title: "Dentist 2" },
      }),
      session: SESSION,
    });
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    await user.click(screen.getByTestId("confirm-delete"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.editor.error.conflictDelete);
    expect(alert).toHaveTextContent("KB-409");
    expect(alert).not.toHaveTextContent(en.editor.error.conflict);
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    await user.click(screen.getByTestId("confirm-delete"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.deleted,
    );
    expect(h.editor.entries()).toEqual([]);
  });

  it("delete asks once and names the entry; a series offers one day or all", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM);
      },
    });
    await home();
    const [first] = screen.getAllByRole("button", { name: "Change Swimming" });
    await user.click(first as HTMLElement);
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete “Swimming”?",
    });
    expect(dialog).toHaveAccessibleDescription(en.editor.delete.seriesText);
    // Keep closes the question, nothing is deleted.
    await user.click(
      within(dialog).getByRole("button", { name: en.editor.delete.keep }),
    );
    expect(h.editor.writes).toEqual([]);
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    await user.click(
      screen.getByRole("button", { name: "Only on Sun, Nov 22" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.deleted,
    );
    expect(writes(h)).toEqual([
      "DELETE /api/parent/entries/:id?scope=one&date=2026-11-22&revision=1",
    ]);
    expect(h.editor.entries()[0]?.exdates).toEqual([TODAY]);
    await waitFor(() => {
      expect(
        screen.getAllByTestId("editor-day").map((day) => day.dataset["date"]),
      ).toEqual(["2026-11-29"]);
    });
  });
});

describe("Editor: series days changed on their own", () => {
  const MOVED = { ...SWIM, date: "2026-12-01", repeat: "none" as const };
  const LATER = {
    ...SWIM,
    date: "2026-11-29",
    startTime: "16:00",
    endTime: "17:00",
    repeat: "none" as const,
  };

  it("'every week' from a moved day keeps the rule's weekdays and updates that day", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM, { overrides: { "2026-11-29": MOVED } });
      },
    });
    await home();
    expect(
      screen.getAllByTestId("editor-day").map((day) => day.dataset["date"]),
    ).toEqual([TODAY, "2026-12-01"]);
    const rows = screen.getAllByRole("button", { name: "Change Swimming" });
    await user.click(rows[1] as HTMLElement);
    const edit = form(en.editor.form.editTitle);
    expect(within(edit).getByLabelText(en.editor.form.otherDay)).toHaveValue(
      "2026-12-01",
    );
    // The rule stays "every Sunday": the moved day's Tuesday is not added.
    const days = within(edit).getByRole("group", {
      name: en.editor.form.weekdays,
    });
    expect(
      within(days).getByRole("checkbox", { name: "Sunday" }),
    ).toBeChecked();
    expect(
      within(days).getByRole("checkbox", { name: "Sunday" }),
    ).toBeDisabled();
    expect(
      within(days).getByRole("checkbox", { name: "Tuesday" }),
    ).not.toBeChecked();
    const name = within(edit).getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "Swim club");
    await save();
    const dialog = screen.getByRole("alertdialog", {
      name: "Change “Swim club”",
    });
    expect(dialog).toHaveAccessibleDescription(
      `${en.editor.scope.text} ${en.editor.scope.overrideText}`,
    );
    await user.click(
      within(dialog).getByRole("button", { name: en.editor.scope.series }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(writes(h)).toEqual([
      "PATCH /api/parent/entries/:id?scope=series",
      "PATCH /api/parent/entries/:id?scope=one&date=2026-11-29",
    ]);
    const stored = h.editor.entries()[0];
    expect(stored?.data).toMatchObject({
      date: TODAY,
      title: "Swim club",
      repeat: { weekly: { weekdays: [7], interval: 1 } },
    });
    expect(stored?.revision).toBe(3);
    expect(stored?.overrides["2026-11-29"]).toMatchObject({
      date: "2026-12-01",
      title: "Swim club",
    });
    // Still once a week: today and the moved day, no new Tuesday.
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("editor-item")
          .map((row) => row.textContent.includes("Swim club")),
      ).toEqual([true, true]);
    });
    expect(
      screen.getAllByTestId("editor-day").map((day) => day.dataset["date"]),
    ).toEqual([TODAY, "2026-12-01"]);
  });

  it("'every week' from a day with other times gives that day the saved entry too", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM, { overrides: { "2026-11-29": LATER } });
      },
    });
    await home();
    const rows = screen.getAllByRole("button", { name: "Change Swimming" });
    await user.click(rows[1] as HTMLElement);
    const edit = form(en.editor.form.editTitle);
    expect(within(edit).getByLabelText(en.editor.form.start)).toHaveValue(
      "16:00",
    );
    await user.click(within(edit).getByRole("checkbox", { name: "Ben" }));
    await save();
    await user.click(
      screen.getByRole("button", { name: en.editor.scope.series }),
    );
    await screen.findByRole("status");
    const stored = h.editor.entries()[0];
    expect(stored?.data).toMatchObject({
      date: TODAY,
      childIds: ["mia", "ben"],
      startTime: "16:00",
    });
    // The day no longer keeps its old version: it shows what was saved.
    expect(stored?.overrides["2026-11-29"]).toMatchObject({
      date: "2026-11-29",
      childIds: ["mia", "ben"],
      startTime: "16:00",
    });
  });

  it("'only on' a changed day replaces just that day's change", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(SWIM, { overrides: { "2026-11-29": MOVED } });
      },
    });
    await home();
    const rows = screen.getAllByRole("button", { name: "Change Swimming" });
    await user.click(rows[1] as HTMLElement);
    const name = screen.getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "Swim gala");
    await save();
    await user.click(
      screen.getByRole("button", { name: "Only on Sun, Nov 29" }),
    );
    await screen.findByRole("status");
    expect(writes(h)).toEqual([
      "PATCH /api/parent/entries/:id?scope=one&date=2026-11-29",
    ]);
    const stored = h.editor.entries()[0];
    expect(stored?.data.title).toBe("Swimming");
    expect(stored?.overrides["2026-11-29"]).toMatchObject({
      date: "2026-12-01",
      title: "Swim gala",
    });
  });
});

describe("Editor: meals", () => {
  it("saves a dish for tonight", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    const mealForm = form(en.editor.meal.newTitle);
    expect(
      within(mealForm).getByRole("radio", {
        name: en.editor.meal.slots.dinner,
      }),
    ).toBeChecked();
    await user.click(within(mealForm).getByRole("radio", { name: /Pizza/u }));
    expect(within(mealForm).getByLabelText(en.editor.form.name)).toHaveValue(
      "Pizza",
    );
    await save();
    await screen.findByRole("status");
    expect(h.editor.entries()[0]?.data).toMatchObject({
      kind: "meal",
      icon: "🍕",
      title: "Pizza",
      date: TODAY,
      slot: "dinner",
      repeat: "none",
    });
  });

  it("repeats last week's meals in one confirmed step", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed({ ...PIZZA, date: "2026-11-20" });
        editor.seed({
          ...PIZZA,
          icon: "🍝",
          title: "Spaghetti",
          date: "2026-11-18",
        });
      },
    });
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.copy.action }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Copy 2 meals?",
    });
    expect(dialog).toHaveAccessibleDescription(
      "They are added from Today to Sat, Nov 28.",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: en.editor.copy.confirmAction,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 meals copied.",
    );
    expect(
      h.editor
        .entries()
        .map((e) => `${e.data.date} ${e.data.title}`)
        .sort(),
    ).toEqual([
      "2026-11-18 Spaghetti",
      "2026-11-20 Pizza",
      "2026-11-25 Spaghetti",
      "2026-11-27 Pizza",
    ]);
  });

  it("names a partial copy calmly; nothing to copy says so", async () => {
    const h = renderEditor({
      maxEntries: 3,
      setup: (editor) => {
        editor.seed({ ...PIZZA, date: "2026-11-20" });
        editor.seed({
          ...PIZZA,
          icon: "🍝",
          title: "Spaghetti",
          date: "2026-11-18",
        });
      },
    });
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.copy.action }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: en.editor.copy.confirmAction,
      }),
    );
    const partial = await screen.findByTestId("copy-partial");
    expect(partial).toHaveTextContent("1 of 2 meals copied.");
    expect(within(partial).getByRole("alert")).toHaveTextContent("KB-LIMIT");
    expect(h.editor.entries()).toHaveLength(3);
    // The form stays open with the notice.
    expect(form(en.editor.meal.newTitle)).toBeInTheDocument();
  });

  it("says when there is nothing to copy", async () => {
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.copy.action }),
    );
    expect(await screen.findByText(en.editor.copy.nothing)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("Editor: no configured calendars (app entries only)", () => {
  it("lists, suggests and saves events and meals without any Google calendar", async () => {
    const h = renderEditor({ config: editorConfig({ calendars: [] }) });
    expect(await screen.findByTestId("entry-list-empty")).toBeInTheDocument();
    // Only the built-in quick picks: no Google entries to suggest.
    expect(
      within(screen.getByTestId("templates-row")).queryAllByTestId("template"),
    ).toEqual([]);
    expect(
      screen.getByRole("button", {
        name: en.editor.templates.quick.swimmingWeekly,
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    const mealForm = form(en.editor.meal.newTitle);
    await user.click(within(mealForm).getByRole("radio", { name: /Pizza/u }));
    await save();
    await screen.findByRole("status");

    await user.click(
      await screen.findByRole("button", {
        name: en.editor.templates.quick.dentist,
      }),
    );
    await save();
    await waitFor(() => {
      expect(h.editor.entries()).toHaveLength(2);
    });
    expect(
      h.editor
        .entries()
        .map((entry) => [entry.data.kind, entry.data.title])
        .sort(),
    ).toEqual([
      ["event", en.editor.templates.quick.dentist],
      ["meal", "Pizza"],
    ]);
  });
});

describe("Editor: backup", () => {
  it("downloads the export as a JSON file", async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:kidboard-test";
    });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe(`kidboard-entries-${TODAY}.json`);
        expect(this.href).toBe("blob:kidboard-test");
      });
    renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.data.export }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.exported,
    );
    expect(click).toHaveBeenCalledTimes(1);
    const text = await created[0]?.text();
    const doc = JSON.parse(text ?? "{}") as {
      format?: string;
      entries?: { data: { title: string } }[];
    };
    expect(doc.format).toBe("kidboard-entries");
    expect(doc.entries?.map((entry) => entry.data.title)).toEqual(["Dentist"]);
    vi.unstubAllGlobals();
  });

  it("imports a backup after a confirmation that names the mode", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    const backup = JSON.stringify({
      format: "kidboard-entries",
      version: 1,
      exportedAt: "2026-11-20T10:00:00.000Z",
      entries: [
        {
          id: "00000000-0000-4000-8000-0000000000aa",
          revision: 2,
          kind: "event",
          data: SWIM,
          exdates: [],
          overrides: {},
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    });
    const file = new File([backup], "backup.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText(en.editor.data.choose), file);
    expect(await screen.findByTestId("import-choice")).toHaveTextContent(
      "backup.json: 1 entry",
    );
    await user.click(
      screen.getByRole("radio", { name: en.editor.data.replace }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.data.import }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Replace everything with 1 entry?",
    });
    expect(dialog).toHaveAccessibleDescription(
      en.editor.data.confirm.replaceText,
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: en.editor.data.confirm.replaceAction,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 entry imported.",
    );
    expect(writes(h)).toEqual(["POST /api/parent/import?mode=replace"]);
    expect(h.editor.entries().map((e) => e.data.title)).toEqual(["Swimming"]);
    await waitFor(() => {
      expect(screen.queryByTestId("import-choice")).toBeNull();
    });
  });

  it("refuses a file that is no backup", async () => {
    const h = renderEditor();
    await home();
    await user.upload(
      screen.getByLabelText(en.editor.data.choose),
      new File(["{}"], "notes.json", { type: "application/json" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.editor.data.notBackup,
    );
    expect(
      screen.queryByRole("button", { name: en.editor.data.import }),
    ).toBeNull();
    expect(h.editor.writes).toEqual([]);
  });
});

describe("Editor: the list covers today and 13 more days", () => {
  it("does not show entries from day 15 on", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed({ ...DENTIST, date: addCalendarDays(TODAY, 13) });
        editor.seed({
          ...DENTIST,
          title: "Later",
          date: addCalendarDays(TODAY, 14),
        });
      },
    });
    const list = await home();
    expect(within(list).getAllByTestId("editor-item")).toHaveLength(1);
    expect(within(list).queryByText("Later")).toBeNull();
  });
});

describe("Editor: phone feed (T-46)", () => {
  const FEED = "/api/feed.ics?token=TESTONLY-not-a-secret-feed-0123456789";
  const ABSOLUTE = `${window.location.origin}${FEED}`;

  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows the absolute link in the Data section, requested with the session", async () => {
    const h = renderEditor({ feedUrl: FEED });
    await home();
    const block = await screen.findByTestId("phone-feed");
    expect(
      within(screen.getByTestId("data-section")).getByTestId("phone-feed"),
    ).toBe(block);
    expect(
      within(block).getByRole("heading", { name: en.editor.feed.title }),
    ).toBeInTheDocument();
    expect(within(block).getByText(en.editor.feed.hint)).toBeInTheDocument();
    expect(
      within(block).getByRole("textbox", { name: en.editor.feed.link }),
    ).toHaveValue(ABSOLUTE);
    const at = h.requests.indexOf("GET /api/parent/feed");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(h.headers[at]?.session).toBe(SESSION);
  });

  it("is hidden when the feed is off", async () => {
    const h = renderEditor();
    await home();
    await waitFor(() => {
      expect(h.requests).toContain("GET /api/parent/feed");
    });
    expect(screen.queryByTestId("phone-feed")).toBeNull();
    expect(
      screen.queryByRole("button", { name: en.editor.feed.copy }),
    ).toBeNull();
  });

  it("is hidden when the request fails", async () => {
    const h = renderEditor({
      feedUrl: FEED,
      setup: (editor) => {
        editor.failNext(
          "GET",
          { status: 500, json: { error: "x" } },
          "/api/parent/feed",
        );
      },
    });
    await home();
    await waitFor(() => {
      expect(h.requests).toContain("GET /api/parent/feed");
    });
    expect(screen.queryByTestId("phone-feed")).toBeNull();
  });

  it("copies the absolute URL and confirms it in a polite live region", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    stubClipboard(writeText);
    renderEditor({ feedUrl: FEED });
    await home();
    const status = await screen.findByTestId("feed-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();
    await user.click(
      await screen.findByRole("button", { name: en.editor.feed.copy }),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ABSOLUTE);
    expect(status).toHaveTextContent(en.editor.feed.copied);
  });

  it("selects the link when the Clipboard API is unavailable or refuses", async () => {
    stubClipboard(() =>
      Promise.reject(new DOMException("no", "NotAllowedError")),
    );
    renderEditor({ feedUrl: FEED });
    await home();
    await user.click(
      await screen.findByRole("button", { name: en.editor.feed.copy }),
    );
    const field = screen.getByRole("textbox", { name: en.editor.feed.link });
    expect(screen.getByTestId("feed-status")).toHaveTextContent(
      en.editor.feed.select,
    );
    expect(field).toHaveFocus();
    expect(window.getSelection()?.toString() ?? "").toBe("");
    expect((field as HTMLInputElement).selectionEnd).toBe(ABSOLUTE.length);
    // No clipboard at all: the same fallback.
    Reflect.deleteProperty(navigator, "clipboard");
    await user.click(screen.getByRole("button", { name: en.editor.feed.copy }));
    expect(screen.getByTestId("feed-status")).toHaveTextContent(
      en.editor.feed.select,
    );
  });

  it("never reaches the query cache (and so never the persisted cache)", async () => {
    const h = renderEditor({ feedUrl: FEED });
    await home();
    await screen.findByTestId("phone-feed");
    const cached = JSON.stringify(
      h.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain("token=");
    expect(
      JSON.stringify(
        h.queryClient
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ),
    ).not.toMatch(/feed/iu);
    expect(h.onUnauthorized).not.toHaveBeenCalled();
  });

  it("has a touch target of at least the parent size and no raw colours", async () => {
    renderEditor({ feedUrl: FEED });
    await home();
    const button = await screen.findByRole("button", {
      name: en.editor.feed.copy,
    });
    expect(button.className).toContain("min-h-touch-parent");
    expect(
      screen.getByRole("textbox", { name: en.editor.feed.link }).className,
    ).toContain("min-h-touch-parent");
    expect(screen.getByTestId("phone-feed").outerHTML).not.toMatch(
      /#[0-9a-f]{3,8}\b/iu,
    );
  });
});

describe("Editor: refused saves show where (M11 click test)", () => {
  let scrolled: Element[] = [];
  beforeEach(() => {
    scrolled = [];
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(
      this: HTMLElement,
    ): void {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("scrolls to the first invalid field and focuses it: picture, then name", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await save();
    const what = screen.getByRole("group", { name: en.editor.form.what });
    expect(what).toHaveAccessibleDescription(en.editor.problem.icon);
    expect(scrolled.at(-1)).toBe(what);
    // The first picture of the shown group, not the group chip.
    expect(screen.getByRole("radio", { name: "Swimming" })).toHaveFocus();

    await user.click(screen.getByRole("radio", { name: "Swimming" }));
    const name = screen.getByLabelText(en.editor.form.name);
    await user.clear(name);
    await user.type(name, "   ");
    await save();
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(scrolled.at(-1)).toBe(name.closest("[data-editor-field]"));
    expect(h.editor.writes).toEqual([]);
  });

  it("a meal without a dish focuses the dish choices", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    await save();
    const dish = screen.getByRole("group", { name: en.editor.meal.dish });
    expect(dish).toHaveAccessibleDescription(en.editor.problem.icon);
    expect(scrolled.at(-1)).toBe(dish);
    expect(screen.getByRole("radio", { name: "Spaghetti" })).toHaveFocus();
    expect(h.editor.writes).toEqual([]);
  });

  it("an own emoji that is none blocks the save instead of using another picture", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await user.click(screen.getByRole("radio", { name: "Swimming" }));
    const own = screen.getByRole("textbox", { name: en.editor.form.ownEmoji });
    await user.type(own, "abc");
    await save();
    expect(h.editor.writes).toEqual([]);
    const message = screen.getByText(en.editor.problem.ownEmoji);
    expect(
      screen
        .getByRole("group", { name: en.editor.form.what })
        .getAttribute("aria-describedby")
        ?.split(" "),
    ).toContain(message.id);
    expect(own).toHaveFocus();
    await user.clear(own);
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(h.editor.entries()[0]?.data.icon).toBe("🏊");
  });
});

describe("Editor: forms (M11 click test)", () => {
  it("Cancel with changes asks once; keep editing stays, discard leaves", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await user.click(screen.getByRole("radio", { name: "Swimming" }));
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    const ask = screen.getByRole("alertdialog", {
      name: en.editor.discard.title,
    });
    expect(ask).toHaveAccessibleDescription(en.editor.discard.text);
    // The safe choice has the focus.
    expect(
      within(ask).getByRole("button", { name: en.editor.discard.keep }),
    ).toHaveFocus();
    await user.click(
      within(ask).getByRole("button", { name: en.editor.discard.keep }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText(en.editor.form.name)).toHaveValue("Swimming");
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    const discard = within(screen.getByRole("alertdialog")).getByRole(
      "button",
      { name: en.editor.discard.action },
    );
    expect(discard).toHaveClass("bg-danger", "text-on-danger");
    await user.click(discard);
    expect(await screen.findByTestId("editor-home")).toBeInTheDocument();
    expect(h.editor.writes).toEqual([]);
  });

  it("text left in 'your own emoji' counts as a change", async () => {
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    await user.type(
      screen.getByRole("textbox", { name: en.editor.form.ownEmoji }),
      "x",
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    expect(
      screen.getByRole("alertdialog", { name: en.editor.discard.title }),
    ).toBeInTheDocument();
  });

  it("editing: the name follows a new picture while it is the old picture's name", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed({ ...DENTIST, icon: "⚽", title: "Football" });
        editor.seed({ ...DENTIST, icon: "🎾", title: "Tennis match" });
        editor.seed({ ...PIZZA, title: "Pizza" });
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Football" }));
    const name = (): HTMLElement => screen.getByLabelText(en.editor.form.name);
    await user.click(screen.getByRole("radio", { name: "Judo" }));
    expect(name()).toHaveValue("Judo");
    await user.click(screen.getByRole("radio", { name: "Tennis" }));
    expect(name()).toHaveValue("Tennis");
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.discard.action }),
    );

    // A name the parent typed stays.
    await user.click(
      await screen.findByRole("button", { name: "Change Tennis match" }),
    );
    await user.click(screen.getByRole("radio", { name: "Judo" }));
    expect(name()).toHaveValue("Tennis match");
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.discard.action }),
    );

    // Same for a meal's dish.
    await user.click(
      await screen.findByRole("button", { name: "Change Pizza" }),
    );
    await user.click(screen.getByRole("radio", { name: "Soup" }));
    expect(name()).toHaveValue("Soup");
  });

  it("a new entry starts at the next full hour once 15:00 has passed", async () => {
    vi.setSystemTime(Date.parse("2026-11-22T16:20:00+01:00"));
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    expect(screen.getByLabelText(en.editor.form.start)).toHaveValue("17:00");
    expect(screen.getByTestId("when-notice")).toBeEmptyDOMElement();
  });

  it("a new entry keeps 15:00 before then", async () => {
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    expect(screen.getByLabelText(en.editor.form.start)).toHaveValue("15:00");
  });

  it("a one-off start in the past gets a gentle hint and still saves", async () => {
    const h = renderEditor();
    await home();
    // Dentist at 09:00 today, it is 12:00.
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    const notice = screen.getByTestId("when-notice");
    expect(notice).toHaveTextContent(en.editor.form.pastHint);
    await user.click(screen.getByRole("radio", { name: "Tomorrow" }));
    expect(notice).toBeEmptyDOMElement();
    await user.click(screen.getByRole("radio", { name: "Today" }));
    expect(notice).toHaveTextContent(en.editor.form.pastHint);
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(h.editor.entries()).toHaveLength(1);
  });
});

describe("Editor: list and dialogs (M11 click test)", () => {
  const LATER = {
    ...SWIM,
    date: "2026-11-29",
    startTime: "16:00",
    endTime: "17:00",
    repeat: "none" as const,
  };

  it("rows say how they repeat and which day was changed on its own", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(SWIM, { overrides: { "2026-11-29": LATER } });
        editor.seed({
          ...DENTIST,
          icon: "🎨",
          title: "Painting",
          date: TODAY,
          repeat: { weekly: { weekdays: [7], interval: 2 } },
        });
        editor.seed(PIZZA);
      },
      google: () => ({
        events: [
          eventFixture({
            id: "g-piano",
            title: "Piano",
            icon: "🎹",
            start: "2026-11-22T16:30:00+01:00",
            end: "2026-11-22T17:15:00+01:00",
          }),
        ],
        meals: [],
      }),
    });
    await home();
    const row = (date: string, title: string): HTMLElement => {
      const day = screen
        .getAllByTestId("editor-day")
        .find((d) => d.dataset["date"] === date);
      const found = within(day as HTMLElement)
        .getAllByTestId("editor-item")
        .find((item) => item.textContent.includes(title));
      if (found === undefined) throw new Error(`no row ${title} on ${date}`);
      return found;
    };
    const swimToday = row(TODAY, "Swimming");
    expect(within(swimToday).getByTestId("series-mark")).toHaveTextContent(
      en.editor.form.everyWeek,
    );
    expect(within(swimToday).queryByTestId("changed-tag")).toBeNull();
    expect(
      within(row("2026-11-29", "Swimming")).getByTestId("changed-tag"),
    ).toHaveTextContent(en.editor.list.changed);
    expect(
      within(row(TODAY, "Painting")).getByTestId("series-mark"),
    ).toHaveTextContent(en.editor.form.everyOtherWeek);
    // Meal rows name the slot with the form's word.
    expect(row(TODAY, "Pizza")).toHaveTextContent(
      `${en.editor.meal.slots.dinner}Pizza`,
    );
    // App and Google rows put their action in one column of the same width.
    const actions = screen.getAllByTestId("row-action");
    expect(actions.length).toBeGreaterThanOrEqual(4);
    for (const action of actions)
      expect(action).toHaveClass("w-56", "shrink-0");
    expect(
      within(row(TODAY, "Piano")).getByTestId("row-action"),
    ).toContainElement(
      screen.getByRole("button", { name: "Use Piano as template" }),
    );
  });

  it("series questions speak of the whole series; deleting it is marked as destructive", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed({
          ...SWIM,
          repeat: { weekly: { weekdays: [7], interval: 2 } },
        });
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Swimming" }));
    await save();
    const change = screen.getByRole("alertdialog");
    expect(
      within(change).getByRole("button", { name: en.editor.scope.series }),
    ).toBeInTheDocument();
    expect(change).not.toHaveTextContent(/every week/iu);
    await user.click(
      within(change).getByRole("button", { name: en.editor.action.cancel }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    const ask = screen.getByRole("alertdialog");
    expect(ask).toHaveAccessibleDescription(en.editor.delete.seriesText);
    expect(
      within(ask).getByRole("button", { name: en.editor.delete.series }),
    ).toHaveClass("bg-danger", "text-on-danger");
    expect(
      within(ask).getByRole("button", { name: "Only on Sun, Nov 22" }),
    ).not.toHaveClass("bg-danger");
  });

  it("the jump bar moves the focus to the list and to the backup section", async () => {
    renderEditor();
    await home();
    const bar = screen.getByRole("navigation", { name: en.editor.jump.label });
    await user.click(
      within(bar).getByRole("button", { name: en.editor.jump.data }),
    );
    expect(
      screen.getByRole("heading", { name: en.editor.data.title }),
    ).toHaveFocus();
    await user.click(
      within(bar).getByRole("button", { name: en.editor.jump.list }),
    );
    expect(
      screen.getByRole("heading", { name: en.editor.list.title }),
    ).toHaveFocus();
  });

  it("the toast closes on request and hides while a question is open", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Dentist" }));
    await save();
    const toast = screen.getByTestId("editor-toast");
    await waitFor(() => {
      expect(toast).toHaveTextContent(en.editor.toast.saved);
    });
    await user.click(
      await screen.findByRole("button", { name: "Change Dentist" }),
    );
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(toast).toBeEmptyDOMElement();
    await user.click(
      screen.getByRole("button", { name: en.editor.delete.keep }),
    );
    expect(toast).toHaveTextContent(en.editor.toast.saved);
    await user.click(
      within(toast).getByRole("button", { name: en.editor.toast.close }),
    );
    expect(toast).toBeEmptyDOMElement();
  });
});

describe("Editor: meals (M11 click test)", () => {
  it("the 'Again' row offers events only", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(SWIM);
        editor.seed(PIZZA);
      },
    });
    await home();
    const suggestions = within(screen.getByTestId("templates-row"))
      .getAllByTestId("template")
      .map((card) => card.textContent);
    expect(suggestions).toEqual([expect.stringContaining("Swimming")]);
  });

  it("names a meal already planned in the chosen slot and saves anyway", async () => {
    const h = renderEditor({
      setup: (editor) => {
        editor.seed(PIZZA);
      },
    });
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newMeal }),
    );
    const hint = screen.getByTestId("meal-taken");
    // Tonight's dinner (the form's default) is Pizza already.
    expect(hint).toHaveTextContent(
      en.editor.meal.taken.replace("{{titles}}", "Pizza"),
    );
    await user.click(
      screen.getByRole("radio", { name: en.editor.meal.slots.lunch }),
    );
    expect(hint).toBeEmptyDOMElement();
    await user.click(
      screen.getByRole("radio", { name: en.editor.meal.slots.dinner }),
    );
    await user.click(screen.getByRole("radio", { name: "Soup" }));
    expect(hint).not.toBeEmptyDOMElement();
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.editor.toast.saved,
    );
    expect(h.editor.entries().map((e) => e.data.title)).toEqual([
      "Pizza",
      "Soup",
    ]);
  });

  it("does not name the edited meal itself", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(PIZZA);
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Pizza" }));
    expect(screen.getByTestId("meal-taken")).toBeEmptyDOMElement();
  });
});

describe("Editor: click test round 2", () => {
  it("deleting a day changed on its own names that day, not the series", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(SWIM, {
          overrides: {
            "2026-11-29": {
              ...SWIM,
              title: "Swim gala",
              repeat: "none" as const,
              date: "2026-11-29",
            },
          },
        });
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Swim gala" }));
    await user.click(
      screen.getByRole("button", { name: en.editor.action.delete }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Delete “Swim gala”?" }),
    ).toBeInTheDocument();
  });

  it("the toast also waits while a form's discard question is open", async () => {
    renderEditor({
      setup: (editor) => {
        editor.seed(DENTIST);
      },
    });
    await home();
    await user.click(screen.getByRole("button", { name: "Change Dentist" }));
    await save();
    const toast = screen.getByTestId("editor-toast");
    await waitFor(() => {
      expect(toast).toHaveTextContent(en.editor.toast.saved);
    });
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    await user.click(screen.getByRole("radio", { name: "Swimming" }));
    await user.click(
      screen.getByRole("button", { name: en.editor.action.cancel }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(toast).toBeEmptyDOMElement();
    await user.click(
      screen.getByRole("button", { name: en.editor.discard.keep }),
    );
    expect(toast).toHaveTextContent(en.editor.toast.saved);
  });

  it("the section heading is named like its jump link, and 'back to top' returns to the first action", async () => {
    renderEditor();
    await home();
    const bar = screen.getByRole("navigation", { name: en.editor.jump.label });
    const link = within(bar).getByRole("button", { name: en.editor.jump.data });
    expect(
      screen.getByRole("heading", { name: link.textContent }),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("back-to-top"));
    expect(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    ).toHaveFocus();
  });

  it("a fresh entry made seconds after 15:00 starts at 16:00 without the past hint", async () => {
    vi.setSystemTime(Date.parse("2026-11-22T15:00:30+01:00"));
    renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.home.newEntry }),
    );
    expect(screen.getByLabelText(en.editor.form.start)).toHaveValue("16:00");
    expect(screen.getByTestId("when-notice")).toBeEmptyDOMElement();
  });

  it("the re-lock notice has a full-width, child-size PIN button", async () => {
    const h = renderEditor();
    await home();
    await user.click(
      screen.getByRole("button", { name: en.editor.templates.quick.dentist }),
    );
    h.sessions.delete(SESSION);
    await save();
    const alert = await screen.findByRole("alert");
    const button = within(alert).getByRole("button", {
      name: en.editor.action.unlockAgain,
    });
    expect(button).toHaveClass("min-h-touch", "w-full");
    expect(button).not.toHaveClass("min-h-touch-parent");
  });
});
