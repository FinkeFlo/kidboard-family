import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../i18n/locales/en.json";
import {
  DiscreetStatusBanner,
  STALE_BANNER_DELAY_MS,
} from "./DiscreetStatusBanner";

const hooks = vi.hoisted(() => ({ status: vi.fn(), kind: vi.fn() }));
vi.mock("../data", () => ({
  useConnectionStatus: hooks.status,
  useApiErrorKind: hooks.kind,
}));

beforeEach(() => {
  vi.useFakeTimers();
  hooks.kind.mockReturnValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DiscreetStatusBanner", () => {
  it("does not flash a brief stale state, e.g. at midnight", () => {
    hooks.status.mockReturnValue("stale");
    const view = render(<DiscreetStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(STALE_BANNER_DELAY_MS - 1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The fetch lands before the delay: it never appeared.
    hooks.status.mockReturnValue("ready");
    view.rerender(<DiscreetStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(STALE_BANNER_DELAY_MS * 2);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a persistent stale state after the delay and hides it at once", () => {
    hooks.status.mockReturnValue("stale");
    const view = render(<DiscreetStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(STALE_BANNER_DELAY_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent(en.status.staleNoTime);
    hooks.status.mockReturnValue("ready");
    view.rerender(<DiscreetStatusBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("restarts the delay when stale comes back", () => {
    hooks.status.mockReturnValue("stale");
    const view = render(<DiscreetStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(STALE_BANNER_DELAY_MS - 1000);
    });
    hooks.status.mockReturnValue("ready");
    view.rerender(<DiscreetStatusBanner />);
    hooks.status.mockReturnValue("stale");
    view.rerender(<DiscreetStatusBanner />);
    act(() => {
      vi.advanceTimersByTime(STALE_BANNER_DELAY_MS - 1000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the time of the shown data in the pill", () => {
    hooks.status.mockReturnValue("offline");
    render(<DiscreetStatusBanner time="2:02 PM" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Offline · as of 2:02 PM",
    );
  });

  it("shows offline, error and unauthorized immediately", () => {
    hooks.status.mockReturnValue("offline");
    const view = render(<DiscreetStatusBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      en.status.offlineNoTime,
    );
    hooks.status.mockReturnValue("error");
    view.rerender(<DiscreetStatusBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.status.error);
    hooks.status.mockReturnValue("stale");
    hooks.kind.mockReturnValue("unauthorized");
    view.rerender(<DiscreetStatusBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.status.unauthorized);
  });
});
