import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createApiClient } from "./data/apiClient";
import { ApiClientContext } from "./data/apiContext";
import { createFakeFetch } from "./data/testing.test-utils";
import en from "./i18n/locales/en.json";
import { useParentGate } from "./parent";

vi.mock("./board/Board", () => ({
  Board: function BoardMock(): React.JSX.Element {
    const { openPin } = useParentGate();
    return (
      <main>
        board
        <button type="button" onClick={openPin}>
          open gate
        </button>
      </main>
    );
  },
}));

function renderApp(): void {
  render(
    <ApiClientContext
      value={createApiClient({ fetch: createFakeFetch().fetch })}
    >
      <App />
    </ApiClientContext>,
  );
}

describe("App", () => {
  it("renders the board", () => {
    renderApp();
    expect(screen.getByRole("main")).toHaveTextContent("board");
    expect(screen.getByTestId("board-layer")).not.toHaveAttribute("inert");
  });

  it("shows the PIN pad above an inert board while the gate is open", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "open gate" }));
    expect(
      screen.getByRole("dialog", { name: en.parent.pin.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("board-layer")).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: en.parent.pin.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("board-layer")).not.toHaveAttribute("inert");
  });
});
