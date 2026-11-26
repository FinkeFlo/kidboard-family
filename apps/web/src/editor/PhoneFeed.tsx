import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ApiClient } from "../data";
import { TID } from "./testIds";
import { EditorButton, FOCUS_RING } from "./ui";

type CopyState = "idle" | "copied" | "select";

/** How long the "copied" confirmation stays in the live region. */
const CONFIRMATION_MS = 4000;

/**
 * "Calendar on your phone" (T-46): the secret subscribe link of the phone feed for the
 * unlocked parent, with a copy button. The link is requested with the parent session
 * on every mount (a plain {@link ApiClient} call: no TanStack query, so it is never
 * persisted, and `cache: "no-store"`), kept in component state only and never logged.
 * Mount it with `key={token}`: a new session starts clean. Without a feed (`feedUrl`
 * absent) or when the request fails, nothing is shown.
 */
export function PhoneFeed({
  api,
  token,
}: {
  api: ApiClient;
  token: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    const controller = new AbortController();
    api.getParentFeed(token, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        // The origin is the page's own: the worker answers a relative URL.
        setUrl(
          response.feedUrl === undefined
            ? null
            : new URL(response.feedUrl, window.location.origin).href,
        );
      },
      () => {
        // The link is optional: a failed request just hides the block.
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, token]);

  // The confirmation is momentary; the live region is emptied again.
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = setTimeout(() => {
      setCopy("idle");
    }, CONFIRMATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copy]);

  const copyUrl = async (): Promise<void> => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // No Clipboard API (insecure origin, old WebView) or permission denied: select
      // the text so the parent can copy it with the system menu.
      input.current?.focus();
      input.current?.select();
      setCopy("select");
    }
  };

  return (
    <>
      {url !== null && (
        <div
          role="group"
          aria-labelledby={headingId}
          className="flex flex-col gap-3"
          data-testid={TID.phoneFeed}
        >
          <h4 id={headingId} className="text-body font-extrabold">
            {t("editor.feed.title")}
          </h4>
          <p className="text-meta text-text-muted">{t("editor.feed.hint")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="text"
              readOnly
              value={url}
              dir="ltr"
              aria-label={t("editor.feed.link")}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className={`min-h-touch-parent rounded-pill bg-surface text-text inset-ring-border text-meta min-w-0 flex-1 px-4 inset-ring-2 ${FOCUS_RING}`}
              data-testid={TID.feedUrl}
            />
            <EditorButton
              onClick={() => {
                void copyUrl();
              }}
              data-testid={TID.feedCopy}
            >
              {t("editor.feed.copy")}
            </EditorButton>
          </div>
        </div>
      )}
      <p
        aria-live="polite"
        className="text-meta text-text-muted empty:hidden"
        data-testid={TID.feedStatus}
      >
        {url === null || copy === "idle" ? "" : t(`editor.feed.${copy}`)}
      </p>
    </>
  );
}
