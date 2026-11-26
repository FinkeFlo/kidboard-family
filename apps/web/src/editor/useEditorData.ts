import type { EditorListResponse, EditorTemplate } from "@kidboard/shared";
import { useCallback, useEffect, useState } from "react";

import type { ApiClient } from "../data";
import { type EditorFailure, toFailure } from "./failure";

/** Days the editor list covers: today and the next 13 days. */
export const EDITOR_LIST_DAYS = 14;

export interface EditorData {
  /** The last list that loaded (kept while a reload runs or fails). */
  list: EditorListResponse | null;
  /** The last list request failed (the previous list, if any, stays). */
  failure: EditorFailure | null;
  /** A request for the current day, session and version is running. */
  loading: boolean;
  templates: EditorTemplate[];
  /** Loads list and templates again (after every write). */
  reload: () => void;
}

interface Result {
  key: string;
  list: EditorListResponse | null;
  failure: EditorFailure | null;
}

/**
 * The editor's list (`/api/parent/entries`, 14 days from `today`) and the "Again"
 * suggestions (`/api/parent/templates`). Plain requests through the {@link ApiClient},
 * no TanStack queries: nothing of it is persisted, and no editor answer can run the
 * board's 401 handling. A new session (after the PIN was entered again) or a new day
 * loads again; a failed template request only leaves the built-in quick picks.
 */
export function useEditorData(
  api: ApiClient,
  token: string,
  today: string,
): EditorData {
  const [version, setVersion] = useState(0);
  const key = `${today}|${token}|${String(version)}`;
  const [result, setResult] = useState<Result>({
    key: "",
    list: null,
    failure: null,
  });
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api
      .listEntries(token, { from: today, days: EDITOR_LIST_DAYS }, signal)
      .then(
        (list) => {
          if (!signal.aborted) setResult({ key, list, failure: null });
        },
        (error: unknown) => {
          if (signal.aborted) return;
          setResult((previous) => ({
            key,
            list: previous.list,
            failure: toFailure(error),
          }));
        },
      );
    api.getTemplates(token, signal).then(
      (response) => {
        if (!signal.aborted) setTemplates(response.templates);
      },
      () => {
        // Suggestions are optional: the quick picks stay.
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, token, today, key]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  return {
    list: result.list,
    failure: result.key === key ? result.failure : null,
    loading: result.key !== key,
    templates,
    reload,
  };
}
