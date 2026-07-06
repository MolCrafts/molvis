import type { Molvis } from "@molvis/core";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

interface TimelineControlProps {
  app: Molvis | null;
  totalFrames?: number;
  /**
   * Narrow layout: drop the speed selector and the first/last jump buttons so
   * the scrubber slider keeps a usable width. Play + step controls remain.
   */
  compact?: boolean;
}

const BASE_FPS = 30;
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;

export const TimelineControl: React.FC<TimelineControlProps> = ({
  app,
  totalFrames = 1,
  compact = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  const requestRef = useRef<number | null>(null);
  const currentFrameRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const speedRef = useRef(1);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!app) return;

    setCurrentFrame(app.system.trajectory.currentIndex);

    const handleFrameChange = (index: number) => {
      setCurrentFrame((prev) => (prev === index ? prev : index));
    };

    const handleTrajectoryChange = () => {
      setCurrentFrame(app.system.trajectory.currentIndex);
    };

    app.events.on("frame-change", handleFrameChange);
    app.events.on("trajectory-change", handleTrajectoryChange);
    return () => {
      app.events.off("frame-change", handleFrameChange);
      app.events.off("trajectory-change", handleTrajectoryChange);
    };
  }, [app]);

  const updateFrame = useCallback(
    (newFrame: number) => {
      if (!app || totalFrames <= 0) return;
      const frame = Math.max(0, Math.min(newFrame, totalFrames - 1));
      app.seekFrame(frame);
    },
    [app, totalFrames],
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
        updateFrame(next);
        lastTimeRef.current = time;
      }
      requestRef.current = requestAnimationFrame(animate);
    },
    [totalFrames, updateFrame],
  );

  useEffect(() => {
    if (isPlaying && totalFrames > 1) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      lastTimeRef.current = null;
    }
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, totalFrames, animate]);

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
    updateFrame(currentFrame + 1);
  };
  const stepBack = () => {
    setIsPlaying(false);
    updateFrame(currentFrame - 1);
  };
  const goToStart = () => {
    setIsPlaying(false);
    updateFrame(0);
  };
  const goToEnd = () => {
    setIsPlaying(false);
    updateFrame(totalFrames - 1);
  };

  const handleSliderChange = (vals: number[]) => {
    const [value] = vals;
    if (value === undefined) return;
    setIsPlaying(false);
    updateFrame(value);
  };

  return (
    <div className="flex items-center w-full h-full bg-background border-t px-1.5 gap-2">
      {/* Progress Bar Area (Left) */}
      <div className="flex-1 px-1">
        <Slider
          value={[currentFrame]}
          max={totalFrames - 1}
          step={1}
          onValueChange={handleSliderChange}
          className="cursor-pointer"
        />
      </div>

      {/* Counter (Middle) */}
      <div className="font-mono text-[10px] text-muted-foreground shrink-0 w-16 text-right tabular-nums">
        {currentFrame}/{totalFrames}
      </div>

      {/* Speed selector */}
      {!compact && (
        <Select
          value={String(speed)}
          onValueChange={(v) => setSpeed(Number(v))}
        >
          <SelectTrigger className="h-6 w-14 text-[9px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEED_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)} className="text-xs">
                {s}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Controls Area (Right) */}
      <div className="flex items-center gap-1 shrink-0">
        {!compact && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goToStart}
            title="First Frame"
          >
            <SkipBack className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={stepBack}
          title="Prev Frame"
        >
          <StepBack className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={togglePlay}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={stepForward}
          title="Next Frame"
        >
          <StepForward className="h-3 w-3" />
        </Button>
        {!compact && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goToEnd}
            title="Last Frame"
          >
            <SkipForward className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};
