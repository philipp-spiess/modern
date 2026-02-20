import type { Settings } from "@moderndev/server/src/settings";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { orpc } from "./rpc";

type Selector<T> = (settings: Settings) => T;

export function useSettings<T>(selector: Selector<T>): T {
  "use-no-memo";
  const { data } = useSuspenseQuery(
    orpc.settings.watch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  // Precompute the selector and only update the reference if the value changes
  const value = selector(data);
  // oxlint-disable-next-line exhaustive-deps
  return useMemo(() => value, [JSON.stringify(value)]);
}
