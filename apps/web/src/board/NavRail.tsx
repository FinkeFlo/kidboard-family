import { useTranslation } from "react-i18next";

import type { FormatContext } from "../i18n/format";
import { ParentEntry } from "../parent/ParentEntry";
import { formatUpdatedTime } from "./updatedTime";
import { type BoardView, ViewToggle } from "./ViewToggle";

export interface NavRailProps {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  /** When the shown agenda was fetched (epoch ms, the query's `dataUpdatedAt`); 0: unknown. */
  updatedAt: number;
  format: FormatContext;
  /** Show the hidden parent entry (`config.editor`, ADR-0013); default `false`. */
  editor?: boolean;
  /** Show the weather data attribution (Open-Meteo, CC BY 4.0) while weather is shown. */
  weatherAttribution?: boolean;
}

/**
 * Navigation rail on the right: the two view buttons on top, "Stand 15:18" at the bottom
 * (below it the weather attribution while weather is shown) and, when the editor is available, the quiet press-and-hold parent entry below it.
 * The "Stand" line is plain text, not a live region (it changes with every refetch and
 * must not chatter). The rail's bottom slot below it belongs to the long-press
 * fullscreen control (merge rule 6), which is a fixed overlay in the reserved bottom
 * strip (see `FullscreenControl`), so the rail never covers it.
 */
export function NavRail({
  view,
  onViewChange,
  updatedAt,
  format,
  editor = false,
  weatherAttribution = false,
}: NavRailProps): React.JSX.Element {
  const { t } = useTranslation();
  const time = formatUpdatedTime(updatedAt, format);
  return (
    <nav
      aria-label={t("board.navLabel")}
      data-testid="nav-rail"
      className="w-nav flex shrink-0 flex-col items-center"
    >
      <ViewToggle view={view} onChange={onViewChange} />
      <div className="mt-auto flex flex-col items-center">
        {time !== undefined && (
          // The time never breaks inside ("12:00 PM"); a long label wraps before it, as a
          // balanced second line, instead of leaving "PM" alone.
          <p
            data-testid="updated-at"
            className="text-caption text-text-muted text-center text-balance"
          >
            {t("board.updated", { time })}
          </p>
        )}
        {weatherAttribution && (
          // Required attribution of the forecast data (ADR-0015); quiet, but readable
          // (13 px at 1280) and set apart from "Updated" and the parent entry. The
          // source name never breaks inside ("Open-" / "Meteo.com"); the label wraps
          // before it.
          <p
            data-testid="weather-attribution"
            className="text-caption text-text-muted my-2.5 text-center"
          >
            {t("weather.attribution")}{" "}
            <span className="text-[0.8125rem] tracking-tight whitespace-nowrap">
              {t("weather.source")}
            </span>
          </p>
        )}
        {editor && <ParentEntry />}
      </div>
    </nav>
  );
}
