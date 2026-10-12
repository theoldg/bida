"use client";
// Doc: docs/navigation.md#routing

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A `<Link>` loads its screen's code once it is in view; a `router.push` from
 * a menu or a callback loads it on the tap, a tenth of a second late on a
 * phone. So a screen names the ones it pushes to, and they are loaded first.
 */
export function usePrefetch(hrefs: readonly string[]): void {
  const router = useRouter();
  const key = hrefs.join(" ");
  useEffect(() => {
    for (const href of key.split(" ")) if (href) router.prefetch(href);
  }, [router, key]);
}
