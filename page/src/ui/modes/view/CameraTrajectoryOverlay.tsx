import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import {
  type ViewerOperationPhase,
  ViewerOperationState,
} from "@/components/viewer/ViewerOperationState";
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
import { canEncodeVideo, recordTurntableVideo } from "./gif-encode";

interface CameraTrajectoryOverlayProps {
  app: Molvis | null;
}

interface ExportFeedback {
  phase: Extract<ViewerOperationPhase, "running" | "success" | "error">;
  message: string;
  detail?: string;
}

/** Compact labeled control row, matching the sidebar's dense layout. */
const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-2">
    <Label className="text-micro text-muted-foreground">{label}</Label>
    <div className="shrink-0">{children}</div>
  </div>
);

/**
 * Camera-trajectory editor + preview, shown as a floating panel in the
 * fullscreen (canvas-only) view. Fullscreen is the "compose a shot" mode, so
 * the turntable controls live here rather than in the sidebar.
 *
 * Preview drives the dedicated animation camera; the panel stops any running
 * preview on unmount, so leaving fullscreen always restores the user's
 * interactive view.
 */
export const CameraTrajectoryOverlay: React.FC<
  CameraTrajectoryOverlayProps
> = ({ app }) => {
  const [duration, setDuration] = useState(8);
  const [revolutions, setRevolutions] = useState(1);
  const [fps, setFps] = useState(30);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<ExportFeedback | null>(null);

  // Stop any running preview when the panel unmounts (i.e. on leaving
  // fullscreen), so the animation camera never lingers as the active view.
  useEffect(() => {
    return () => {
      app?.world.cameraAnimator.stop();
    };
  }, [app]);

  const onPreviewToggle = useCallback(() => {
    if (!app) return;
    const animator = app.world.cameraAnimator;
    if (previewing) {
      animator.stop();
      setPreviewing(false);
      setFeedback(null);
      return;
    }
    setFeedback(null);
    animator.play(animator.buildTurntable({ duration, revolutions }));
    setPreviewing(true);
  }, [app, previewing, duration, revolutions]);

  const onExport = useCallback(async () => {
    if (!app || exporting) return;
    // Recording drives its own play/stop; stop any manual preview first.
    if (previewing) {
      app.world.cameraAnimator.stop();
      setPreviewing(false);
    }
    setExporting(true);
    setFeedback({
      phase: "running",
      message: "Recording turntable video…",
      detail: `${duration}s · ${revolutions} revolution${revolutions === 1 ? "" : "s"} · ${fps} FPS`,
    });
    try {
      await recordTurntableVideo(app, { duration, revolutions, fps });
      setFeedback({
        phase: "success",
        message: "Video download started",
        detail: "molvis-turntable.webm",
      });
    } catch (error) {
      setFeedback({
        phase: "error",
        message: "Video export failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(false);
    }
  }, [app, exporting, previewing, duration, fps, revolutions]);

  if (!app) {
    return (
      <div className="motion-enter-left absolute top-2 left-2 z-20 w-44 rounded-md border bg-background/70 p-2 backdrop-blur-sm">
        <ViewerOperationState
          phase="loading"
          message="Loading camera controls…"
        />
      </div>
    );
  }

  const videoAvailable = canEncodeVideo();

  return (
    <div
      aria-busy={exporting}
      className="motion-enter-left absolute top-2 left-2 z-20 w-44 rounded-md border bg-background/70 backdrop-blur-sm p-2 flex flex-col gap-2"
    >
      <div className="text-micro font-semibold text-foreground">
        Camera Trajectory
      </div>
      <Row label="Duration (s)">
        <NumberField
          aria-label="Camera trajectory duration in seconds"
          value={duration}
          min={1}
          max={60}
          step={1}
          onChange={setDuration}
        />
      </Row>
      <Row label="Revolutions">
        <NumberField
          aria-label="Camera trajectory revolutions"
          value={revolutions}
          min={1}
          max={10}
          step={1}
          onChange={setRevolutions}
        />
      </Row>
      <Row label="Export FPS">
        <NumberField
          aria-label="Camera trajectory export frames per second"
          value={fps}
          min={5}
          max={60}
          step={1}
          onChange={setFps}
        />
      </Row>
      <div className="flex items-center gap-2 pt-1">
        <ViewerToggleAction
          selected={previewing}
          className="flex-1"
          onClick={onPreviewToggle}
          disabled={exporting}
        >
          {previewing ? "Stop" : "Preview"}
        </ViewerToggleAction>
        <ViewerAction
          purpose="dismiss"
          className="flex-1"
          onClick={onExport}
          disabled={exporting || !videoAvailable}
          aria-busy={exporting}
        >
          {exporting
            ? "Exporting…"
            : feedback?.phase === "error"
              ? "Retry"
              : "Export"}
        </ViewerAction>
      </div>
      {feedback ? (
        <ViewerOperationState {...feedback} />
      ) : previewing ? (
        <ViewerOperationState
          phase="running"
          message="Previewing camera path…"
        />
      ) : (
        !videoAvailable && (
          <ViewerOperationState
            phase="disabled"
            message="Video export unavailable"
            detail="This browser cannot record the molecular canvas."
          />
        )
      )}
    </div>
  );
};
