import type {
  DrawBoxModifier as CoreDrawBoxModifier,
  Molvis,
} from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawBoxModifierProps {
  modifier: CoreDrawBoxModifier;
  app: Molvis | null;
  onUpdate: () => void;
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

  // Sync from external changes (e.g. other panels or programmatic toggles)
  useEffect(() => {
    if (!app) return;
    const sync = () => {
      setShowBox(app.styleManager.getShowBox());
      setBoxColor(app.styleManager.getTheme().boxColor ?? "#ffffff");
    };
    sync();
    app.events.on("frame-change", sync);
    return () => {
      app.events.off("frame-change", sync);
    };
  }, [app]);

  const handleToggleShow = (show: boolean) => {
    if (!app) return;
    setShowBox(show);
    app.styleManager.setShowBox(show);
    void app.applyPipeline({ fullRebuild: true });
    onUpdate();
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
        // biome-ignore lint/suspicious/noExplicitAny: diffuseColor is a BabylonJS Color3, setter is type-safe at runtime
        const mat = (child as any).material;
        if (mat?.diffuseColor) mat.diffuseColor.set(r, g, b);
      }
    }
    onUpdate();
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] text-muted-foreground">Show Box</span>
        <Switch checked={showBox} onCheckedChange={handleToggleShow} />
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] text-muted-foreground">Color</span>
        <input
          type="color"
          value={boxColor}
          onChange={(e) => handleColorChange(e.target.value)}
          className="w-6 h-6 rounded cursor-pointer border-0 p-0"
          aria-label="Box color"
        />
      </div>

      <ScalarSliderRow
        label="Edge Thickness"
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
          void app?.applyPipeline();
          onUpdate();
        }}
      />
    </div>
  );
};
