import { createContext, useContext } from "react";

/**
 * Where Radix primitives should portal their content.
 *
 * Radix portals into `document.body` by default. Under a Shadow DOM mount
 * that puts dialogs, menus, selects, popovers and tooltips *outside* the
 * shadow root — where the shadow-scoped stylesheet cannot reach them. The
 * content then renders as unstyled `position: static` blocks below the page,
 * effectively invisible, while the primitive's modal behaviour still applies
 * and sets `pointer-events: none` across the app. The symptom is not "the
 * dialog looks wrong" but "every button stopped working", with nothing
 * on screen to close.
 *
 * `null` means "use the Radix default" — correct for the standalone page,
 * whose styles live in `document.head`.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalContainerContext.Provider;

/**
 * The element Radix `Portal`s should render into.
 *
 * Pass straight through to a primitive's `container` prop; Radix falls back
 * to `document.body` when this is `null`.
 */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
