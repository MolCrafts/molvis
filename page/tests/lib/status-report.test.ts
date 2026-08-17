import { describe, expect, it } from "@rstest/core";
import {
  formatProgressSuffix,
  formatStatusLine,
  reportStatus,
  type StatusReport,
  statusTypeFromPhase,
  subscribeStatus,
} from "../../src/lib/status-report";

describe("status-report", () => {
  it("maps operation phases to status bar tones", () => {
    expect(statusTypeFromPhase("running")).toBe("info");
    expect(statusTypeFromPhase("success")).toBe("success");
    expect(statusTypeFromPhase("error")).toBe("error");
  });

  it("formats a single status line with optional detail", () => {
    expect(formatStatusLine("Loaded")).toBe("Loaded");
    expect(formatStatusLine("3D structure ready", "Click the canvas.")).toBe(
      "3D structure ready — Click the canvas.",
    );
  });

  it("formats progress as a compact percent suffix", () => {
    expect(formatProgressSuffix(undefined)).toBe("");
    expect(formatProgressSuffix(42.2)).toBe(" 42%");
    expect(formatProgressSuffix(0)).toBe(" 0%");
    expect(formatProgressSuffix(100)).toBe(" 100%");
  });

  it("notifies subscribers and unsubscribes cleanly", () => {
    const received: StatusReport[] = [];
    const unsub = subscribeStatus((report) => {
      received.push(report);
    });
    reportStatus("Hello", "success");
    expect(received).toEqual([{ text: "Hello", type: "success" }]);
    unsub();
    reportStatus("Again", "info");
    expect(received).toHaveLength(1);
  });

  it("forwards optional progress on reports", () => {
    const received: StatusReport[] = [];
    const unsub = subscribeStatus((report) => {
      received.push(report);
    });
    reportStatus("Analyzing…", "info", 33);
    expect(received).toEqual([
      { text: "Analyzing…", type: "info", progress: 33 },
    ]);
    unsub();
  });
});
