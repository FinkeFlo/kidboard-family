import { useState } from "react";

import { useNow } from "../time";
import {
  type BurnInOffset,
  burnInOffset,
  burnInStepIndex,
  parseBurnInOverride,
} from "./burnIn";

/**
 * Current burn-in offset (T-22), advanced on the minute clock (`useNow`), so there is no
 * timer of its own. `?burnin=0..7` pins it for tests (read once, like `?night=`). The
 * returned object is one of the orbit constants: it only changes identity when the
 * position changes.
 */
export function useBurnInShift(): BurnInOffset {
  const now = useNow();
  const [override] = useState(() =>
    parseBurnInOverride(window.location.search),
  );
  return override ?? burnInOffset(burnInStepIndex(now));
}
