import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import de from "../i18n/locales/de.json";
import en from "../i18n/locales/en.json";
import { ConnectedStatusBanner, StatusBanner } from "./StatusBanner";

const hooks = vi.hoisted(() => ({
  status: vi.fn(),
  kind: vi.fn(),
}));
vi.mock("../data", () => ({
  useConnectionStatus: hooks.status,
  useApiErrorKind: hooks.kind,
}));

describe("StatusBanner", () => {
  it.each(["loading", "ready"] as const)("is silent while %s", (status) => {
    const { container } = render(<StatusBanner status={status} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces offline politely with the time of the shown data", () => {
    render(<StatusBanner status="offline" time="2:02 PM" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Offline · as of 2:02 PM");
    expect(pill).toHaveAttribute("data-status", "offline");
    // Crossed-out cloud, decorative.
    expect(screen.getByTestId("cloud-off-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("says just 'Offline' when the time of the data is unknown", () => {
    render(<StatusBanner status="offline" />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Offline$/u);
  });

  it("announces stale politely, with and without a time", () => {
    const view = render(<StatusBanner status="stale" time="2:02 PM" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Maybe not current · as of 2:02 PM",
    );
    expect(screen.getByTestId("cloud-icon")).toBeInTheDocument();
    view.rerender(<StatusBanner status="stale" />);
    expect(screen.getByRole("status")).toHaveTextContent(en.status.staleNoTime);
  });

  it.each(["network", "server", "timeout"] as const)(
    "says it can't update when the last refresh failed (%s), with the last good time",
    (errorKind) => {
      const view = render(
        <StatusBanner status="stale" errorKind={errorKind} time="2:02 PM" />,
      );
      const pill = screen.getByRole("status");
      expect(pill).toHaveTextContent(/^Can't update · as of 2:02 PM$/u);
      expect(pill).toHaveAttribute("data-status", "stale");
      view.rerender(<StatusBanner status="stale" errorKind={errorKind} />);
      expect(screen.getByRole("status")).toHaveTextContent(/^Can't update$/u);
    },
  );

  it("has the can't-update pill in German too", () => {
    expect(de.status.cantUpdate.replace("{{time}}", "14:02")).toBe(
      "Aktualisieren klappt nicht · Stand von 14:02",
    );
  });

  it("has the German pill of the hand-off", () => {
    expect(de.status.offline.replace("{{time}}", "14:02")).toBe(
      "Offline · Stand von 14:02",
    );
  });

  it.each([
    ["offline", undefined],
    ["stale", undefined],
    ["error", "server"],
    ["offline", "unauthorized"],
  ] as const)(
    "stays calm (notice colours, never the danger red): %s/%s",
    (status, errorKind) => {
      const { container } = render(
        <StatusBanner status={status} errorKind={errorKind} time="1:00 PM" />,
      );
      const pill = container.querySelector("p");
      expect(pill).toHaveClass("bg-notice", "text-on-notice");
      expect(pill?.className).not.toMatch(/danger/u);
    },
  );

  it("raises an alert for a generic error", () => {
    render(<StatusBanner status="error" errorKind="server" />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.status.error);
  });

  it.each(["error", "stale", "offline"] as const)(
    "tells an access link that is no longer valid apart (%s)",
    (status) => {
      render(<StatusBanner status={status} errorKind="unauthorized" />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        /^This tablet needs a new access link\.$/u,
      );
      expect(alert).toHaveAttribute("data-status", "unauthorized");
    },
  );

  it("words the unauthorized pill without technical details, in both languages", () => {
    expect(de.status.unauthorized).toBe(
      "Dieses Tablet braucht einen neuen Zugangslink.",
    );
    for (const text of [en.status.unauthorized, de.status.unauthorized]) {
      expect(text).not.toMatch(/\?key|key=|token|401/iu);
    }
  });
});

describe("ConnectedStatusBanner", () => {
  beforeEach(() => {
    hooks.status.mockReset();
    hooks.kind.mockReset();
  });

  it("reads status and error kind from the data layer", () => {
    hooks.status.mockReturnValue("error");
    hooks.kind.mockReturnValue("unauthorized");
    render(<ConnectedStatusBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.status.unauthorized);
  });

  it("passes the time on", () => {
    hooks.status.mockReturnValue("offline");
    hooks.kind.mockReturnValue(undefined);
    render(<ConnectedStatusBanner time="9:15 AM" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Offline · as of 9:15 AM",
    );
  });
});
