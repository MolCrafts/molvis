import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Molvis } from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";

interface GraphicsSectionProps {
  app: Molvis | null;
}

interface GraphicsState {
  fxaa: boolean;
  hardwareScaling: number;
  backgroundColor: string;
}

const BG_PRESETS = [
  { label: "Black", value: "#000000" },
  { label: "Dark Gray", value: "#1a1a2e" },
  { label: "Gray", value: "#808080" },
  { label: "White", value: "#ffffff" },
] as const;

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

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
      className="h-7 w-20 px-1.5 text-xs tabular-nums shrink-0"
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

export const GraphicsSection: React.FC<GraphicsSectionProps> = ({ app }) => {
  const [state, setState] = useState<GraphicsState | null>(null);

  useEffect(() => {
    if (!app) {
      setState(null);
      return;
    }
    const gfx = app.settings.getGraphics();
    const cc = app.scene.clearColor;
    setState({
      fxaa: gfx.fxaa ?? true,
      hardwareScaling: gfx.hardwareScaling ?? 1.0,
      backgroundColor: rgbToHex(cc.r, cc.g, cc.b),
    });
  }, [app]);

  const onFxaa = (c: boolean) => {
    if (!app) return;
    setState((prev) => (prev ? { ...prev, fxaa: c } : prev));
    app.settings.setGraphics({ ...app.settings.getGraphics(), fxaa: c });
  };

  const onHwScaling = (v: number) => {
    if (!app) return;
    setState((prev) => (prev ? { ...prev, hardwareScaling: v } : prev));
    app.settings.setGraphics({
      ...app.settings.getGraphics(),
      hardwareScaling: v,
    });
  };

  const onBgColor = (hex: string) => {
    if (!app) return;
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
    app.scene.clearColor.set(r, g, b, 1);
    setState((prev) => (prev ? { ...prev, backgroundColor: hex } : prev));
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide">
        Graphics
      </div>

      {!app || !state ? (
        <p className="text-[10px] text-muted-foreground">
          Graphics settings will appear once the viewer initializes.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] text-muted-foreground">FXAA</Label>
              <Switch checked={state.fxaa} onCheckedChange={onFxaa} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] text-muted-foreground">
                Render Scale
              </Label>
              <NumberField
                value={state.hardwareScaling}
                min={0.5}
                max={2}
                step={0.1}
                onChange={onHwScaling}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] text-muted-foreground">
                Background
              </Label>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {BG_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`w-5 h-5 rounded border-2 shrink-0 ${
                      state.backgroundColor === p.value
                        ? "border-blue-500"
                        : "border-muted"
                    }`}
                    style={{ backgroundColor: p.value }}
                    title={p.label}
                    aria-label={`Background ${p.label}`}
                    onClick={() => onBgColor(p.value)}
                  />
                ))}
                <input
                  type="color"
                  value={state.backgroundColor}
                  onChange={(e) => onBgColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 p-0 shrink-0"
                  aria-label="Custom background color"
                />
              </div>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground leading-snug">
            FXAA is a post-process anti-alias pass. Render Scale multiplies the
            device pixel ratio (1.0 = native, 2.0 = supersampling).
          </p>
        </>
      )}
    </div>
  );
};
