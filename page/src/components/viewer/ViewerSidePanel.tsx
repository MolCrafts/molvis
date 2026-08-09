import * as React from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ViewerSidePanelProps {
  children: React.ReactNode;
  drawer: boolean;
  /**
   * Committed inline width (e.g. `"18%"`). Applied imperatively so live
   * resize can update `style.width` via `panelRef` without React re-render
   * clobbering the drag position.
   */
  inlineWidth: string;
  label: string;
  onClose: () => void;
  open: boolean;
  panelRef: React.RefObject<HTMLElement | null>;
  side: "left" | "right";
}

/**
 * One persistent side-panel state owner that changes presentation without
 * remounting its contents. Wide layouts align it over a resizable shell slot;
 * narrow layouts turn the same DOM subtree into a modal edge drawer.
 */
export const ViewerSidePanel: React.FC<ViewerSidePanelProps> = ({
  children,
  drawer,
  inlineWidth,
  label,
  onClose,
  open,
  panelRef,
  side,
}) => {
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const wasModalOpenRef = React.useRef(false);
  const modalOpen = drawer && open;

  // Committed width only — never put width in JSX `style`, or every React
  // commit overwrites the live value written during drag by App.
  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || drawer) return;
    panel.style.width = inlineWidth;
  }, [drawer, inlineWidth, panelRef]);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (modalOpen) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
    }
  }, [modalOpen, panelRef]);

  React.useEffect(() => {
    if (modalOpen && !wasModalOpenRef.current) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // Focus the drawer itself; neither panel carries a close affordance, and
      // without focus inside, Tab escapes to the inert content behind it.
      const frame = requestAnimationFrame(() => panelRef.current?.focus());
      wasModalOpenRef.current = true;
      return () => cancelAnimationFrame(frame);
    }

    if (!modalOpen && wasModalOpenRef.current) {
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected && restoreTarget.offsetParent !== null) {
        restoreTarget.focus();
      }
      restoreFocusRef.current = null;
      wasModalOpenRef.current = false;
    }
  }, [modalOpen, panelRef]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!modalOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <aside
      ref={panelRef}
      aria-hidden={!open}
      aria-label={label}
      inert={!open ? true : undefined}
      tabIndex={modalOpen ? -1 : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        // Flat VS Code-style workbench panel: no card elevation / outer frame.
        // min-w-0 + overflow-hidden keep tab strips scrolling inside the band
        // instead of stretching the drawer past its overlay width.
        "absolute inset-y-0 z-10 flex min-w-0 flex-col overflow-hidden bg-background",
        // Drawer receives programmatic focus for the modal trap — never paint a
        // full-panel ring (reads as a broken frame on narrow screens).
        "outline-none focus:outline-none focus-visible:outline-none",
        side === "left" ? "left-0" : "right-0",
        drawer &&
          "z-30 w-inspector-overlay shadow-overlay motion-reduce:transform-none",
        drawer && open && side === "left" && "motion-enter-left",
        drawer && open && side === "right" && "motion-enter-right",
        !open && "invisible pointer-events-none",
      )}
    >
      <React.Activity mode={open ? "visible" : "hidden"}>
        {children}
      </React.Activity>
    </aside>
  );
};
