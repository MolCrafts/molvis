import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import type { Molvis } from "@molvis/core";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface RenderTabProps {
  app: Molvis | null;
}

interface RenderState {
  boxVisible: boolean;
  boxColor: string;
  boxThicknessScale: number;
  gridEnabled: boolean;
  gridOpacity: number;
  gridSize: number;
}

/** Compact number input that applies on blur or Enter. */
function NumberField({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    let v = Number(draft);
    if (Number.isNaN(v)) v = value;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (step !== undefined) v = Math.round(v / step) * step;
    onChange(v);
    setDraft(String(v));
  };

  return (
    <Input
      type="number"
      className="h-6 w-16 px-1.5 text-xs tabular-nums shrink-0"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

const Row = ({
  label,
  children,
}: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-1.5">
    <Label className="text-[10px] text-muted-foreground truncate min-w-0">
      {label}
    </Label>
    <div className="shrink-0">{children}</div>
  </div>
);

export const RenderTab: React.FC<RenderTabProps> = ({ app }) => {
  const [state, setState] = useState<RenderState | null>(null);

  useEffect(() => {
    if (!app) return;
    const grid = app.settings.getGrid();
    setState({
      boxVisible: !!app.scene.getMeshByName("sim_box")?.isEnabled(),
      boxColor: app.styleManager.getTheme().boxColor ?? "#ffffff",
      boxThicknessScale: 1.0,
      gridEnabled: grid.enabled ?? false,
      gridOpacity: grid.opacity ?? 0.3,
      gridSize: grid.size ?? 100,
    });
  }, [app]);

  const set = useCallback(
    <K extends keyof RenderState>(key: K, value: RenderState[K]) => {
      setState((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  if (!state || !app) return null;

  const onBoxVisible = (c: boolean) => {
    const m = app.scene.getMeshByName("sim_box");
    if (m) m.setEnabled(c);
    set("boxVisible", c);
  };

  const onBoxColor = (hex: string) => {
    const m = app.scene.getMeshByName("sim_box");
    if (m) {
      const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
      const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
      const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
      for (const child of m.getChildren()) {
        // biome-ignore lint/suspicious/noExplicitAny: BabylonJS child nodes don't expose .material in the Node base type
        const mat = (child as any).material;
        if (mat?.diffuseColor) mat.diffuseColor.set(r, g, b);
      }
    }
    set("boxColor", hex);
  };

  const onBoxThickness = (v: number) => {
    const m = app.scene.getMeshByName("sim_box");
    // biome-ignore lint/suspicious/noExplicitAny: _userThicknessScale is an internal BabylonJS mesh property
    if (m) (m as any)._userThicknessScale = v;
    set("boxThicknessScale", v);
  };

  const onGridEnabled = (c: boolean) => {
    set("gridEnabled", c);
    app.settings.setGrid({ ...app.settings.getGrid(), enabled: c });
  };

  const onGridOpacity = (v: number) => {
    set("gridOpacity", v);
    app.settings.setGrid({ ...app.settings.getGrid(), opacity: v });
  };

  const onGridSize = (v: number) => {
    set("gridSize", v);
    app.settings.setGrid({ ...app.settings.getGrid(), size: v });
  };

  return (
    <div className="flex flex-col">
      <SidebarSection title="Simulation Box">
        <Row label="Show">
          <Switch checked={state.boxVisible} onCheckedChange={onBoxVisible} />
        </Row>
        {state.boxVisible && (
          <>
            <Row label="Color">
              <input
                type="color"
                value={state.boxColor}
                onChange={(e) => onBoxColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                aria-label="Box color"
              />
            </Row>
            <Row label="Width">
              <NumberField
                value={state.boxThicknessScale}
                min={0.5}
                max={5}
                step={0.1}
                onChange={onBoxThickness}
              />
            </Row>
          </>
        )}
      </SidebarSection>

      <SidebarSection title="Grid" defaultOpen={false}>
        <Row label="Show">
          <Switch checked={state.gridEnabled} onCheckedChange={onGridEnabled} />
        </Row>
        {state.gridEnabled && (
          <>
            <Row label="Opacity">
              <NumberField
                value={state.gridOpacity}
                min={0}
                max={1}
                step={0.1}
                onChange={onGridOpacity}
              />
            </Row>
            <Row label="Size">
              <NumberField
                value={state.gridSize}
                min={10}
                max={500}
                step={10}
                onChange={onGridSize}
              />
            </Row>
          </>
        )}
      </SidebarSection>
    </div>
  );
};
