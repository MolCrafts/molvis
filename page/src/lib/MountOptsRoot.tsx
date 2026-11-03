import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { MountOptsProvider } from "@/lib/mount-opts";
import type { MountOptsStore } from "@/lib/mount-opts-store";

/**
 * Broadcasts a {@link MountOptsStore}'s current options to the React tree.
 *
 * Nothing else: the decision of who owns the surface when the host supplies no
 * `onSurfaceChange` is composed in `mountMolvisApp`, not here, so this stays a
 * subscription adapter that knows nothing about surfaces.
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
