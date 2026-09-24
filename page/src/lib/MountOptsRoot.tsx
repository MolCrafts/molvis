import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { MountOptsProvider } from "@/lib/mount-opts";
import type { MountOptsStore } from "@/lib/mount-opts-store";

/**
 * Broadcasts a {@link MountOptsStore}'s current options to the React tree.
 *
 * Nothing else: surface ownership lives with the host (`setOpts`), not here,
 * so this stays a subscription adapter that knows nothing about surfaces.
 */
export function MountOptsRoot({
  store,
  children,
}: {
  store: MountOptsStore;
  children: ReactNode;
}) {
  const opts = useSyncExternalStore(store.subscribe, store.get);
  return <MountOptsProvider value={opts}>{children}</MountOptsProvider>;
}
