import {
  PLAYBACK_SPEED_STEPS,
  PlaybackControls,
  type PlaybackControlsProps,
} from "@molcrafts/ui";

export const TRAJECTORY_SPEED_STEPS = PLAYBACK_SPEED_STEPS;

type PlaybackProps = Omit<PlaybackControlsProps, "playLabel" | "pauseLabel">;

/** Trajectory transport. Labels stay specific to frame playback. */
export function TrajectoryPlaybackControls(props: PlaybackProps) {
  return (
    <PlaybackControls
      {...props}
      playLabel="Play trajectory"
      pauseLabel="Pause trajectory"
    />
  );
}
