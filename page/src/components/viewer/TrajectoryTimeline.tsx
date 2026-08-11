import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TrajectoryPlaybackControls } from "./TrajectoryPlaybackControls";
import { TrajectoryScrub } from "./TrajectoryScrub";

interface TrajectoryTimelineProps {
  app: Molvis | null;
  totalFrames?: number;
  /**
   * Narrow layout: drop speed + first/last so the scrub keeps usable width.
   * Play + step remain.
   */
  compact?: boolean;
}

/**
 * Nominal frames per second at 1×. Kept low so structures stay readable;
 * use speed steps above 1× when scrubbing a long traj quickly.
 */
const BASE_FPS = 10;

/**
 * Coalesced seek: at most one `seekFrame` in flight; always drains to the
 * latest requested index so scrub never queues a backlog of seeks.
 */
function useCoalescedSeek(app: Molvis | null) {
  const inFlight = useRef(false);
  const pending = useRef<number | null>(null);

  return useCallback(
    async (frame: number) => {
      if (!app) return;
      pending.current = frame;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        while (pending.current !== null) {
          const target = pending.current;
          pending.current = null;
          try {
            await app.seekFrame(target);
          } catch {
            // Drop failed seeks; loop continues if a newer index was queued.
          }
        }
      } finally {
        inFlight.current = false;
      }
    },
    [app],
  );
}

function frameReadoutWidth(totalFrames: number): string {
  const digits = Math.max(1, String(Math.max(totalFrames, 1)).length);
  const ch = 2 * digits + 3;
  return `${Math.min(12, Math.max(5, ch))}ch`;
}

export const TrajectoryTimeline: React.FC<TrajectoryTimelineProps> = ({
  app,
  totalFrames = 1,
  compact = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [scrubbing, setScrubbing] = useState(false);

  const requestRef = useRef<number | null>(null);
  const currentFrameRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const scrubbingRef = useRef(false);

  const seekFrame = useCoalescedSeek(app);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  useEffect(() => {
    if (!app) return;

    setCurrentFrame(app.system.trajectory.currentIndex);

    const handleFrameChange = (index: number) => {
      // User owns the scrubber — ignore stale engine echoes mid-drag.
      if (scrubbingRef.current) return;
      setCurrentFrame((prev) => (prev === index ? prev : index));
    };

    const handleTrajectoryChange = () => {
      if (scrubbingRef.current) return;
      setCurrentFrame(app.system.trajectory.currentIndex);
    };

    app.events.on("frame-change", handleFrameChange);
    app.events.on("trajectory-change", handleTrajectoryChange);
    return () => {
      app.events.off("frame-change", handleFrameChange);
      app.events.off("trajectory-change", handleTrajectoryChange);
    };
  }, [app]);

  const goToFrame = useCallback(
    (newFrame: number) => {
      if (!app || totalFrames <= 0) return;
      const frame = Math.max(0, Math.min(newFrame, totalFrames - 1));
      setCurrentFrame(frame);
      currentFrameRef.current = frame;
      void seekFrame(frame);
    },
    [app, totalFrames, seekFrame],
  );

  const animate = useCallback(
    (time: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = time;
      }
      const deltaTime = time - lastTimeRef.current;
      const interval = 1000 / BASE_FPS / speedRef.current;

      if (deltaTime >= interval) {
        const next =
          currentFrameRef.current + 1 >= totalFrames
            ? 0
            : currentFrameRef.current + 1;
        setCurrentFrame(next);
        currentFrameRef.current = next;
        void seekFrame(next);
        lastTimeRef.current = time;
      }
      requestRef.current = requestAnimationFrame(animate);
    },
    [totalFrames, seekFrame],
  );

  useEffect(() => {
    if (isPlaying && totalFrames > 1 && !scrubbing) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      lastTimeRef.current = null;
    }
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, totalFrames, animate, scrubbing]);

  useEffect(() => {
    if (totalFrames <= 0) {
      setCurrentFrame(0);
      setIsPlaying(false);
      return;
    }
    setCurrentFrame((prev) => Math.max(0, Math.min(prev, totalFrames - 1)));
  }, [totalFrames]);

  const togglePlay = () => {
    if (totalFrames <= 1) return;
    setIsPlaying((prev) => !prev);
  };
  const stepForward = () => {
    setIsPlaying(false);
    goToFrame(currentFrame + 1);
  };
  const stepBack = () => {
    setIsPlaying(false);
    goToFrame(currentFrame - 1);
  };
  const goToStart = () => {
    setIsPlaying(false);
    goToFrame(0);
  };
  const goToEnd = () => {
    setIsPlaying(false);
    goToFrame(totalFrames - 1);
  };

  const handleScrubChange = (frame: number) => {
    setIsPlaying(false);
    if (!scrubbingRef.current) {
      scrubbingRef.current = true;
      setScrubbing(true);
    }
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
    void seekFrame(frame);
  };

  const handleScrubCommit = (frame: number) => {
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
    void seekFrame(frame).finally(() => {
      scrubbingRef.current = false;
      setScrubbing(false);
    });
  };

  const displayFrame = totalFrames > 0 ? currentFrame + 1 : 0;

  return (
    <div className="relative flex h-full w-full min-w-0 items-center gap-2.5 px-2.5 text-foreground">
      <div className="min-w-0 flex-1">
        <TrajectoryScrub
          value={currentFrame}
          max={Math.max(0, totalFrames - 1)}
          disabled={!app || totalFrames <= 1}
          onValueChange={handleScrubChange}
          onValueCommit={handleScrubCommit}
        />
      </div>

      <div
        className={cn(
          "shrink-0 rounded-md bg-muted px-1.5 py-0.5",
          "text-right font-mono text-[11px] tabular-nums leading-none",
        )}
        style={{ width: frameReadoutWidth(totalFrames) }}
        title={`Frame ${displayFrame} of ${totalFrames}`}
        aria-live="off"
      >
        <span className="font-semibold text-foreground">{displayFrame}</span>
        <span className="text-muted-foreground">/{totalFrames}</span>
      </div>

      <TrajectoryPlaybackControls
        compact={compact}
        isPlaying={isPlaying}
        disabled={!app}
        speed={speed}
        onSpeedChange={setSpeed}
        onFirstFrame={goToStart}
        onPreviousFrame={stepBack}
        onTogglePlayback={togglePlay}
        onNextFrame={stepForward}
        onLastFrame={goToEnd}
      />
    </div>
  );
};
