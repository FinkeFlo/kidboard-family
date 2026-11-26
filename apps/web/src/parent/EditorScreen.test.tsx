import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n";
import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { EditorScreen } from "./EditorScreen";
import { fakeGate, renderWithGate } from "./gate.test-utils";

afterEach(() => {
  applyLocale("en");
});

describe("EditorScreen", () => {
  it("is a labelled modal surface with the placeholder and focus inside", () => {
    renderWithGate(<EditorScreen />, fakeGate({ stage: "editor" }));
    const dialog = screen.getByRole("dialog", { name: en.parent.editor.title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(screen.getByTestId("editor-content")).toHaveTextContent(
      en.parent.editor.placeholder,
    );
  });

  it("renders the editor content instead of the placeholder", () => {
    renderWithGate(
      <EditorScreen>
        <p>{"content"}</p>
      </EditorScreen>,
      fakeGate({ stage: "editor" }),
    );
    expect(screen.getByTestId("editor-content")).toHaveTextContent("content");
    expect(
      screen.queryByText(en.parent.editor.placeholder),
    ).not.toBeInTheDocument();
  });

  it("locks on Done with a 64 px button, in both locales", () => {
    const gate = fakeGate({ stage: "editor" });
    renderWithGate(<EditorScreen />, gate);
    act(() => {
      applyLocale("de");
    });
    const done = screen.getByRole("button", { name: de.parent.editor.done });
    expect(done).toHaveClass("min-h-touch");
    fireEvent.click(done);
    expect(gate.close).toHaveBeenCalledTimes(1);
  });
});
