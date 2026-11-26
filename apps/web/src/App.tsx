import { Board } from "./board/Board";
import { FullscreenControl } from "./kiosk/FullscreenControl";
import { BoardLayer, ParentGateProvider, ParentLayer } from "./parent";

/**
 * The board UI with the parent gate (ADR-0013) above it. Crash-proof kiosk effects
 * (wake lock) live in `AppShell`, outside the error boundary.
 */
export function App(): React.JSX.Element {
  return (
    <ParentGateProvider>
      <BoardLayer>
        <Board />
        <FullscreenControl />
      </BoardLayer>
      <ParentLayer />
    </ParentGateProvider>
  );
}
