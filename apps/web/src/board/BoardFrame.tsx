import type { Child } from "@kidboard/shared";

import { useBurnInShift } from "../burnin";
import { ChildLegend } from "../components/ChildLegend";
import { DiscreetStatusBanner } from "../day/DiscreetStatusBanner";
import {
  type FormatContext,
  formatDayMonth,
  formatWeekday,
} from "../i18n/format";
import { NavRail } from "./NavRail";
import { formatUpdatedTime } from "./updatedTime";
import type { BoardView } from "./ViewToggle";

export interface BoardFrameProps {
  /** Today, `YYYY-MM-DD` in the config zone. */
  today: string;
  childList: readonly Child[];
  format: FormatContext;
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  /** When the shown agenda was fetched (epoch ms; 0: unknown), for "Stand HH:MM". */
  updatedAt: number;
  /** Show the hidden parent entry in the rail (`config.editor`, ADR-0013). */
  editor?: boolean;
  /** Weather is shown: the rail carries the Open-Meteo attribution (T-49). */
  weatherAttribution?: boolean;
  /** The "How many sleeps?" countdown for the header (T-19), if there is one. */
  countdown?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared frame of overview and week view: the header (weekday + date, countdown, child
 * legend) above the view, the navigation rail on the right, the status banner and the
 * fullscreen control in the reserved bottom strip.
 */
export function BoardFrame({
  today,
  childList,
  format,
  view,
  onViewChange,
  updatedAt,
  editor = false,
  weatherAttribution = false,
  countdown,
  children,
}: BoardFrameProps): React.JSX.Element {
  const { x, y } = useBurnInShift();
  return (
    <main
      data-testid="board-ready"
      // The gutter gives `burn-in` back to the inner wrapper as padding, so the shifted
      // wrapper (at most `burn-in` either way) stays inside the original gutter. The bottom
      // strip (`touch`, reserved for the fullscreen control under the rail and the status
      // banner) gets `burn-in` on top, so even shifted down the wrapper ends above it.
      className="bg-surface text-text h-full p-[calc(var(--spacing-gutter)-var(--spacing-burn-in))] pb-[calc(var(--spacing-touch)+var(--spacing-burn-in))]"
    >
      <div
        data-testid="burn-in-shift"
        data-burn-in-x={x}
        data-burn-in-y={y}
        // Burn-in protection (T-22): `<main>` stays put, only this wrapper drifts.
        style={{
          transform: `translate(calc(var(--spacing-burn-in) * ${String(x)}), calc(var(--spacing-burn-in) * ${String(y)}))`,
        }}
        className="gap-gutter px-burn-in pt-burn-in flex h-full transition-transform duration-(--duration-slow) ease-in-out motion-reduce:transition-none"
      >
        <div className="gap-gutter flex min-w-0 flex-1 flex-col">
          <header className="gap-gutter flex shrink-0 items-center justify-between">
            {/* Date below the weekday: the header keeps room for 14 moons and three
                children on one row. */}
            <div className="shrink-0">
              <h1 className="text-display">{formatWeekday(today, format)}</h1>
              <p className="text-title text-text-muted leading-snug">
                {formatDayMonth(today, format)}
              </p>
            </div>
            <div className="gap-gutter flex min-w-0 items-center justify-end">
              {countdown}
              <ChildLegend childList={childList} />
            </div>
          </header>
          {children}
        </div>
        <NavRail
          view={view}
          onViewChange={onViewChange}
          updatedAt={updatedAt}
          format={format}
          editor={editor}
          weatherAttribution={weatherAttribution}
        />
      </div>
      {/* The banner has a fixed slot of its own in the reserved bottom strip, left of the
          rail's bottom slot (fullscreen control): it appears and disappears without moving
          anything, and it is not shifted (it is transient). */}
      <div className="h-touch left-touch pointer-events-none fixed right-[calc(var(--spacing-nav)+var(--spacing-gutter))] bottom-0 flex items-center justify-center">
        <DiscreetStatusBanner time={formatUpdatedTime(updatedAt, format)} />
      </div>
    </main>
  );
}
