import {
  analysisAvailability,
  frameHasStructure,
  listAnalysisCategoriesWithEntries,
  type Molvis,
  structureProbeKey,
} from "@molvis/core";
import { useEffect, useRef, useState } from "react";
import type { PickerGroup } from "./AnalysisPicker";

export interface AnalysisCatalogState {
  /** Picker groups with blocked reasons derived from the current frame. */
  groups: PickerGroup[];
  /** True while a probe pass is scheduled or running. */
  probing: boolean;
  /** Non-empty atoms block present on the current frame. */
  hasData: boolean;
  /** Last structure key that produced `groups` (for debug / tests). */
  probeKey: string;
}

const EMPTY: AnalysisCatalogState = {
  groups: [],
  probing: false,
  hasData: false,
  probeKey: "empty|sel=0",
};

function buildGroups(
  app: Molvis,
  hasSelection: boolean,
): { groups: PickerGroup[]; hasData: boolean; probeKey: string } {
  const frame = app.system.frame;
  const context = { hasSelection };
  const hasData = frameHasStructure(frame);
  const probeKey = structureProbeKey(frame, context);
  const groups: PickerGroup[] = listAnalysisCategoriesWithEntries().map(
    ({ category, analyses }) => ({
      category,
      entries: analyses.map((analysis) => {
        const availability = analysisAvailability(frame, analysis, context);
        return {
          analysis,
          blockedReason: availability.runnable
            ? undefined
            : (availability.reason ?? "unavailable"),
        };
      }),
    }),
  );
  return { groups, hasData, probeKey };
}

/**
 * Live analysis catalog: re-probes requirements whenever loaded data changes.
 *
 * Probing is **async** (yields to the event loop) so a large molrs catalog
 * does not block paint after a trajectory load. Events that only move the
 * camera / scrub to a topologically identical frame are coalesced via
 * {@link structureProbeKey}.
 */
export function useAnalysisCatalog(
  app: Molvis | null,
  hasSelection: boolean,
): AnalysisCatalogState {
  const [state, setState] = useState<AnalysisCatalogState>(EMPTY);
  const lastKeyRef = useRef<string>("");
  const generationRef = useRef(0);

  useEffect(() => {
    if (!app) {
      lastKeyRef.current = "";
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleProbe = () => {
      // Coalesce bursts (trajectory-change + frame-change + frame-load-end).
      if (timer !== null) clearTimeout(timer);
      setState((prev) => (prev.probing ? prev : { ...prev, probing: true }));

      timer = setTimeout(() => {
        timer = null;
        const generation = ++generationRef.current;
        // Yield once more so React can paint the "probing" state first.
        void Promise.resolve().then(() => {
          if (cancelled || generation !== generationRef.current) return;

          const context = { hasSelection };
          const key = structureProbeKey(app.system.frame, context);
          if (key === lastKeyRef.current) {
            setState((prev) =>
              prev.probing ? { ...prev, probing: false } : prev,
            );
            return;
          }

          const next = buildGroups(app, hasSelection);
          if (cancelled || generation !== generationRef.current) return;
          lastKeyRef.current = next.probeKey;
          setState({
            groups: next.groups,
            hasData: next.hasData,
            probeKey: next.probeKey,
            probing: false,
          });
        });
      }, 0);
    };

    // Initial probe + re-run when the loaded structure / labels / selection
    // change. Playback with the same columns is a no-op thanks to the key.
    scheduleProbe();
    const unsubs = [
      app.events.on("trajectory-change", scheduleProbe),
      app.events.on("frame-change", scheduleProbe),
      app.events.on("frame-load-end", scheduleProbe),
      app.events.on("frame-labels-change", scheduleProbe),
    ];
    // Bonds from ComputeBonds / pipeline rebuilds update the frame in place.
    const offComputed = app.modifierPipeline.on("computed", scheduleProbe);
    const offAdded = app.modifierPipeline.on("modifier-added", scheduleProbe);
    const offRemoved = app.modifierPipeline.on(
      "modifier-removed",
      scheduleProbe,
    );

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      for (const off of unsubs) off();
      offComputed();
      offAdded();
      offRemoved();
    };
  }, [app, hasSelection]);

  return state;
}
