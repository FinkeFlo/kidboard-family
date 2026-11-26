// Test harness for the whole editor (not part of the app bundle): the real ApiClient
// against the in-memory fake editor API of the demo server, inside the data layer and a
// fake parent gate. All data is synthetic.
import { PARENT_SESSION_HEADER, type PublicConfig } from "@kidboard/shared";
import type { QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { type Mock, vi } from "vitest";

import {
  createFakeEditor,
  type FakeEditor,
  type FakeEditorOptions,
} from "../../demo/fakeEditorApi";
import { createApiClient } from "../data/apiClient";
import { createQueryClient } from "../data/queryClient";
import {
  agendaFixture,
  dataWrapper,
  TEST_TOKEN,
} from "../data/testing.test-utils";
import { fakeGate } from "../parent/gate.test-utils";
import { type ParentGate, ParentGateContext } from "../parent/parentGate";
import { Editor } from "./Editor";
import { editorConfig, SESSION } from "./fixtures.test-utils";

export interface EditorHarness {
  editor: FakeEditor;
  gate: ParentGate;
  queryClient: QueryClient;
  /** Every request as `METHOD path?query`. */
  requests: string[];
  /** Per request (same order): the parent session and access token headers sent. */
  headers: { session: string | null; authorization: string | null }[];
  /** Parent sessions the fake API accepts (initially {@link SESSION}). */
  sessions: Set<string>;
  /** The data layer's 401 hook (the app forgets its access token there). */
  onUnauthorized: Mock<() => void>;
  /** Renders again with a new unlocked session, as after the PIN was entered again. */
  unlockAs: (token: string) => void;
  /** While true, every API request fails like a lost connection. */
  network: { offline: boolean };
  view: RenderResult;
}

function urlOf(input: RequestInfo | URL): URL {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://kidboard.test");
}

/** Renders the editor with session {@link SESSION} against a fresh fake API. */
export function renderEditor(
  options: {
    config?: PublicConfig;
    /** The config the fake API validates with (default: `config`). */
    fakeConfig?: () => PublicConfig;
    google?: FakeEditorOptions["google"];
    maxEntries?: number;
    /** Relative phone-feed URL of the fake API (default: the feed is off). */
    feedUrl?: string;
    setup?: (editor: FakeEditor) => void;
    gate?: Partial<ParentGate>;
  } = {},
): EditorHarness {
  const config = options.config ?? editorConfig();
  const sessions = new Set([SESSION]);
  const editor = createFakeEditor({
    config: options.fakeConfig ?? (() => config),
    isSession: (token) => token !== null && sessions.has(token),
    ...(options.google === undefined ? {} : { google: options.google }),
    ...(options.feedUrl === undefined ? {} : { feedUrl: options.feedUrl }),
    ...(options.maxEntries === undefined
      ? {}
      : { maxEntries: options.maxEntries }),
  });
  options.setup?.(editor);
  const requests: string[] = [];
  const headers: EditorHarness["headers"] = [];
  const network = { offline: false };
  const respond = (url: URL, method: string, init?: RequestInit): Response => {
    if (url.pathname === "/api/config") return Response.json(config);
    if (url.pathname === "/api/agenda") return Response.json(agendaFixture());
    const answer = editor.handle({
      method,
      path: url.pathname,
      search: url.search,
      body: typeof init?.body === "string" ? init.body : null,
      session: new Headers(init?.headers).get(PARENT_SESSION_HEADER),
    });
    if (answer === null) return new Response("not found", { status: 404 });
    return Response.json(answer.json, {
      status: answer.status,
      ...(answer.headers === undefined ? {} : { headers: answer.headers }),
    });
  };
  const fetchImpl = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}${url.search}`);
    const sent = new Headers(init?.headers);
    headers.push({
      session: sent.get(PARENT_SESSION_HEADER),
      authorization: sent.get("Authorization"),
    });
    if (network.offline) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve(respond(url, method, init));
  };
  const onUnauthorized = vi.fn<() => void>();
  const queryClient = createQueryClient({ retry: false, onUnauthorized });
  const gate = fakeGate({
    stage: "editor",
    session: { token: SESSION, lockAt: Number.MAX_SAFE_INTEGER },
    ...options.gate,
  });
  const Wrapper = dataWrapper(
    createApiClient({ fetch: fetchImpl, token: TEST_TOKEN }),
    queryClient,
    undefined,
  );
  const ui = (current: ParentGate): React.JSX.Element => (
    <Wrapper>
      <ParentGateContext value={current}>
        <Editor />
      </ParentGateContext>
    </Wrapper>
  );
  const view = render(ui(gate));
  const unlockAs = (token: string): void => {
    view.rerender(
      ui({ ...gate, session: { token, lockAt: Number.MAX_SAFE_INTEGER } }),
    );
  };
  return {
    editor,
    gate,
    queryClient,
    requests,
    headers,
    sessions,
    onUnauthorized,
    unlockAs,
    network,
    view,
  };
}
