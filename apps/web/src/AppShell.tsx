import type { ReactNode } from "react";

import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { KioskEffects } from "./kiosk/KioskEffects";

/**
 * Root of the tree: the kiosk effects live outside the error boundary, so a crash and
 * its fallback never release the wake lock; everything else sits inside it.
 */
export function AppShell({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <KioskEffects />
      <AppErrorBoundary>{children}</AppErrorBoundary>
    </>
  );
}
