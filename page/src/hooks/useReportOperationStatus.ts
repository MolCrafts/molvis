import { useEffect, useRef } from "react";
import type { ViewerOperationFeedback } from "@/hooks/useViewerOperation";
import {
  formatStatusLine,
  reportStatus,
  statusTypeFromPhase,
} from "@/lib/status-report";

/**
 * Mirrors local {@link useViewerOperation} feedback into the bottom status bar
 * and never renders a toast/card. Skips re-emits for identical consecutive
 * feedback so React Strict Mode double-mount does not double-flash.
 */
export function useReportOperationStatus(
  feedback: ViewerOperationFeedback | null,
): void {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!feedback) {
      lastKey.current = null;
      return;
    }
    const text = formatStatusLine(feedback.message, feedback.detail);
    const key = `${feedback.phase}|${text}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    reportStatus(text, statusTypeFromPhase(feedback.phase));
  }, [feedback]);
}
