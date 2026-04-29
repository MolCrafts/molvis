import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Molvis, REPRESENTATIONS } from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";

interface RepresentationSelectRowProps {
  app: Molvis | null;
}

/**
 * Style dropdown bound to the global StyleManager representation.
 * Mounted inside DrawAtom / DrawBond modifier panels — both write
 * through `app.setRepresentation(name)` and subscribe to
 * `representation-change` so any panel (or RPC caller) flips the
 * current style and the others see it on their next render.
 *
 * The list shows the three preset names plus a synthetic "Custom"
 * option whenever someone has nudged a per-axis scale away from a
 * known preset (StyleManager renames the representation to "Custom"
 * in that case).
 */
export const RepresentationSelectRow: React.FC<
  RepresentationSelectRowProps
> = ({ app }) => {
  const [name, setName] = useState<string>(
    () => app?.styleManager.getRepresentation().name ?? "Ball and Stick",
  );

  useEffect(() => {
    if (!app) return;
    setName(app.styleManager.getRepresentation().name);
    const onChange = (repr: { name: string }) => setName(repr.name);
    app.events.on("representation-change", onChange);
    return () => {
      app.events.off("representation-change", onChange);
    };
  }, [app]);

  if (!app) return null;

  const isCustom = !REPRESENTATIONS.some((r) => r.name === name);

  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
        Style
      </Label>
      <Select
        value={name}
        onValueChange={(v) => {
          app.setRepresentation(v);
          setName(v);
        }}
      >
        <SelectTrigger
          className="h-7 text-xs flex-1 min-w-0"
          aria-label="Style"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REPRESENTATIONS.map((r) => (
            <SelectItem key={r.name} value={r.name} className="text-xs">
              {r.name}
            </SelectItem>
          ))}
          {isCustom && (
            <SelectItem value={name} disabled className="text-xs">
              {name}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};
