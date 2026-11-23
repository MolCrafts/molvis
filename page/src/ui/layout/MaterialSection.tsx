import {
  MATERIAL_PRESETS,
  type MaterialInput,
  type MaterialStyle,
  type MaterialTarget,
  type Molvis,
} from "@molcrafts/molvis-stage";
import {
  NumberField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
} from "@molcrafts/ui";
import { useEffect, useState } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";

function SurfaceControl({
  target,
  value,
  disabled,
  update,
}: {
  target: MaterialTarget;
  value: MaterialStyle;
  disabled: boolean;
  update: (input: MaterialInput) => void;
}) {
  const selected =
    Object.entries(MATERIAL_PRESETS).find(
      ([, preset]) =>
        preset.shading === value.shading &&
        preset.specular === value.specular &&
        preset.specularPower === value.specularPower,
    )?.[0] ?? "custom";
  const label = target === "atom" ? "Atoms" : "Bonds";
  return (
    <fieldset
      disabled={disabled}
      className="m-0 min-w-0 space-y-3 border-0 p-0"
    >
      <legend className="mb-3 text-label font-medium">{label}</legend>
      <SettingsRow
        className="flex-col items-stretch sm:flex-row sm:items-center"
        label="Material"
      >
        <Select
          value={selected}
          onValueChange={(id) => {
            if (Object.hasOwn(MATERIAL_PRESETS, id))
              update({ preset: id as keyof typeof MATERIAL_PRESETS });
          }}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label={`${label} material`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(MATERIAL_PRESETS).map((id) => (
              <SelectItem key={id} value={id}>
                {id === "unlit"
                  ? "Unlit"
                  : id.charAt(0).toUpperCase() + id.slice(1)}
              </SelectItem>
            ))}
            {selected === "custom" && (
              <SelectItem value="custom" disabled>
                Custom
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>
      {value.shading === "lit" && (
        <>
          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Highlight strength"
          >
            <NumberField
              aria-label={`${label} highlight strength`}
              value={value.specular}
              min={0}
              step={0.05}
              onChange={(specular) => update({ ...value, specular })}
            />
          </SettingsRow>
          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Highlight sharpness"
            tooltip="Higher values produce a smaller, sharper highlight."
          >
            <NumberField
              aria-label={`${label} highlight sharpness`}
              value={value.specularPower}
              min={0}
              step={1}
              onChange={(specularPower) => update({ ...value, specularPower })}
            />
          </SettingsRow>
        </>
      )}
    </fieldset>
  );
}

export function MaterialSection({
  app,
  sectionId,
}: {
  app: Molvis | null;
  sectionId?: string;
}) {
  const { run, running } = usePipelineOperation();
  const [state, setState] = useState<{
    atom: MaterialStyle;
    bond: MaterialStyle;
  } | null>(null);
  useEffect(() => {
    if (!app) {
      setState(null);
      return;
    }
    const sync = () =>
      setState({
        atom: app.styleManager.getMaterial("atom"),
        bond: app.styleManager.getMaterial("bond"),
      });
    sync();
    app.events.on("material-change", sync);
    return () => app.events.off("material-change", sync);
  }, [app]);
  return (
    <SettingsSection id={sectionId} title="Material">
      {!app || !state ? (
        <p className="text-micro text-muted-foreground">Viewer not ready.</p>
      ) : (
        <div className="space-y-6">
          {(["atom", "bond"] as const).map((target) => (
            <SurfaceControl
              key={target}
              target={target}
              value={state[target]}
              disabled={running}
              update={(input) => {
                void run(() => app.setMaterial(target, input), {
                  running: "Updating material…",
                  success: "Material updated",
                  error: "Could not update material",
                });
              }}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
