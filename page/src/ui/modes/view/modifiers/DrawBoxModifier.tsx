import {
  type DrawBoxModifier as CoreDrawBoxModifier,
  type DrawBoxSpec,
  lammpsCellFromBox,
  type Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawBoxModifierProps {
  modifier: CoreDrawBoxModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating the simulation box…",
  success: "Simulation box updated",
  error: "Could not update the simulation box",
};

/** Read LAMMPS-style lx/ly/lz + xy/xz/yz (+ origin, PBC) from the live frame. */
function defaultManualBox(app: Molvis | null): DrawBoxSpec {
  const box = app?.system?.frame?.box;
  if (box) {
    return lammpsCellFromBox(box);
  }
  return {
    lengths: [10, 10, 10],
    tilts: [0, 0, 0],
    origin: [0, 0, 0],
    pbc: [true, true, true],
  };
}

function normalizeSpec(spec: DrawBoxSpec): DrawBoxSpec {
  return {
    lengths: [...spec.lengths] as [number, number, number],
    tilts: [...(spec.tilts ?? [0, 0, 0])] as [number, number, number],
    origin: [...spec.origin] as [number, number, number],
    pbc: [...spec.pbc] as [boolean, boolean, boolean],
  };
}

export const DrawBoxModifier: React.FC<DrawBoxModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const [showBox, setShowBox] = useState(
    () => app?.styleManager.getShowBox() ?? true,
  );
  const [boxColor, setBoxColor] = useState(
    () => app?.styleManager.getTheme().boxColor ?? "#ffffff",
  );
  const [manual, setManual] = useState<DrawBoxSpec>(() =>
    normalizeSpec(modifier.manualBox ?? defaultManualBox(app)),
  );
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  // Lattice is always on: seed a user cell from the frame box when the
  // modifier has none yet (draw-only install), then keep UI in sync.
  useEffect(() => {
    if (!app) return;

    let seeded = false;
    if (modifier.manualBox === null) {
      const spec = defaultManualBox(app);
      modifier.manualBox = spec;
      setManual(normalizeSpec(spec));
      seeded = true;
    }

    const sync = () => {
      setShowBox(app.styleManager.getShowBox());
      setBoxColor(app.styleManager.getTheme().boxColor ?? "#ffffff");
      const next = modifier.manualBox;
      if (next) setManual(normalizeSpec(next));
    };
    sync();
    if (seeded) {
      void applyPipeline({ fullRebuild: true });
    }
    app.events.on("frame-change", sync);
    return () => {
      app.events.off("frame-change", sync);
    };
  }, [app, modifier, applyPipeline]);

  const handleToggleShow = (show: boolean) => {
    if (!app) return;
    setShowBox(show);
    app.styleManager.setShowBox(show);
    applyPipeline({ fullRebuild: true });
  };

  const handleColorChange = (hex: string) => {
    if (!app) return;
    setBoxColor(hex);
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
    const m = app.scene.getMeshByName("sim_box");
    if (m) {
      for (const child of m.getChildren()) {
        // biome-ignore lint/suspicious/noExplicitAny: Babylon material color
        const mat = (child as any).material;
        if (mat?.diffuseColor) mat.diffuseColor.set(r, g, b);
      }
    }
    onUpdate();
  };

  const commitLattice = (next: DrawBoxSpec) => {
    const spec = normalizeSpec(next);
    modifier.manualBox = spec;
    setManual(spec);
    applyPipeline({ fullRebuild: true });
  };

  const patchLattice = (patch: Partial<DrawBoxSpec>) => {
    commitLattice({
      lengths: patch.lengths ?? manual.lengths,
      tilts: patch.tilts ?? manual.tilts,
      origin: patch.origin ?? manual.origin,
      pbc: patch.pbc ?? manual.pbc,
    });
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-micro text-muted-foreground">Show box</span>
        <Switch
          aria-label="Show periodic box"
          checked={showBox}
          onCheckedChange={handleToggleShow}
        />
      </div>

      {/* Appearance + lattice knobs only matter while the box is drawn. */}
      {showBox && (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-micro text-muted-foreground">Color</span>
            <input
              type="color"
              value={boxColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="h-6 w-6 cursor-pointer rounded-control border-0 p-0"
              aria-label="Box color"
            />
          </div>

          <ScalarSliderRow
            label="Edge thickness"
            value={modifier.thicknessScale}
            min={0.25}
            max={4.0}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onPreview={(v) => {
              modifier.thicknessScale = v;
              onUpdate();
            }}
            onCommit={(v) => {
              modifier.thicknessScale = v;
              applyPipeline();
            }}
          />

          <div className="space-y-2 border-t border-border/50 px-1 pt-2">
            <div className="text-micro font-medium text-muted-foreground">
              Lattice
              <span className="ml-1 font-normal text-subtle-foreground">
                (LAMMPS lx ly lz xy xz yz)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["lx", "ly", "lz"] as const).map((label, i) => (
                <div key={label} className="space-y-1">
                  <Label className="text-micro">{label} (Å)</Label>
                  <Input
                    type="number"
                    step={0.1}
                    min={0.1}
                    className="h-8 text-xs"
                    value={manual.lengths[i]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v <= 0) return;
                      const lengths: [number, number, number] = [
                        ...manual.lengths,
                      ];
                      lengths[i] = v;
                      patchLattice({ lengths });
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["xy", "xz", "yz"] as const).map((label, i) => (
                <div key={label} className="space-y-1">
                  <Label className="text-micro">{label} (Å)</Label>
                  <Input
                    type="number"
                    step={0.1}
                    className="h-8 text-xs"
                    value={manual.tilts[i]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const tilts: [number, number, number] = [...manual.tilts];
                      tilts[i] = v;
                      patchLattice({ tilts });
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-micro">PBC</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["X", "Y", "Z"] as const).map((axis, i) => {
                  const id = `draw-box-pbc-${axis.toLowerCase()}`;
                  return (
                    <label
                      key={axis}
                      htmlFor={id}
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-border px-2 text-xs transition-colors hover:bg-interactive"
                    >
                      <Checkbox
                        id={id}
                        checked={manual.pbc[i]}
                        onCheckedChange={(checked) => {
                          const pbc: [boolean, boolean, boolean] = [
                            ...manual.pbc,
                          ];
                          pbc[i] = checked === true;
                          patchLattice({ pbc });
                        }}
                      />
                      <span className="text-foreground">{axis}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
};
