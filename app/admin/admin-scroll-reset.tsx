"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * The ported Forge mobile sheet locks `body` at the offset it was opened from
 * and restores that offset when the sheet closes. Choosing a nav item pushes
 * the next route and closes the sheet in the same turn, so the restore can run
 * after the new page has rendered and leave a phone halfway down the page —
 * with the sticky top bar sitting on top of the content it just loaded.
 *
 * Resetting in the next frame, after every layout effect (including the
 * sheet's restore), guarantees each admin route opens at its top. It also
 * cancels the browser's reload scroll restoration, which is how the same
 * symptom appears after a refresh.
 */
export function AdminScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
