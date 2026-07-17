import { type Molvis, REPRESENTATIONS } from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RepresentationSelectRowProps {
  app: Molvis | null;
}

/**
 * Style dropdown bound to the global StyleManager representation.
 * Mounted inside DrawAtom / DrawBond modifier panels — both write
 * through `app.setRepresentation(id)` and subscribe to
 * `representation-change` so any panel (or RPC caller) flips the
 * current style and the others see it on their next render.
 *
 * Labels are presentation-only; the public API always uses stable slugs.
 */
export const RepresentationSelectRow: React.FC<
  RepresentationSelectRowProps
> = ({ app }) => {
  const [id, setId] = useState(
    () => app?.styleManager.getRepresentation().id ?? "ball-and-stick",
  );
  const [outlineEnabled, setOutlineEnabled] = useState(
    () => app?.styleManager.getRepresentation().outlineEnabled ?? false,
  );

  useEffect(() => {
    if (!app) return;
    const current = app.styleManager.getRepresentation();
    setId(current.id);
    setOutlineEnabled(current.outlineEnabled);
    const onChange = (repr: (typeof REPRESENTATIONS)[number]) => {
      setId(repr.id);
      setOutlineEnabled(repr.outlineEnabled);
    };
    app.events.on("representation-change", onChange);
    return () => {
      app.events.off("representation-change", onChange);
    };
  }, [app]);

  if (!app) return null;
  const representation = REPRESENTATIONS.find((item) => item.id === id);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
          Style
        </Label>
        <Select
          value={id}
          onValueChange={(v) => {
            const next = REPRESENTATIONS.find((r) => r.id === v);
            if (!next) return;
            void app.setRepresentation(next.id);
            setId(next.id);
            setOutlineEnabled(next.outlineEnabled);
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
              <SelectItem key={r.id} value={r.id} className="text-xs">
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {representation?.outlineConfigurable && (
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
            Outline
          </Label>
          <Checkbox
            checked={outlineEnabled}
            onCheckedChange={(checked) => {
              const enabled = checked === true;
              setOutlineEnabled(enabled);
              void app.setRepresentationOutline(enabled);
            }}
            aria-label="Heavy outline"
          />
          <span className="text-[10px] text-muted-foreground">Heavy</span>
        </div>
      )}
    </div>
  );
};
