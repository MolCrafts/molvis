import {
  COORDINATE_POLICIES,
  COORDINATE_POLICY_LABELS,
  type CoordinatePolicy,
  isCoordinatePolicy,
  type Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsRow, SettingsSection } from "./SettingsSection";

interface CoordinatePolicySectionProps {
  app: Molvis | null;
  sectionId?: string;
}

/**
 * System-level post-compose coordinate policy (Settings → Coordinates).
 * Default is As deposited — never silently wraps loaded structures.
 */
export const CoordinatePolicySection: React.FC<
  CoordinatePolicySectionProps
> = ({ app, sectionId = "coordinates" }) => {
  const [policy, setPolicy] = useState<CoordinatePolicy>("as-deposited");

  useEffect(() => {
    if (!app) {
      setPolicy("as-deposited");
      return;
    }
    setPolicy(app.coordinatePolicy);
  }, [app]);

  const onChange = useCallback(
    (value: string) => {
      if (!isCoordinatePolicy(value) || !app) return;
      setPolicy(value);
      app.setCoordinatePolicy(value);
      void app.applyPipeline({ fullRebuild: true });
    },
    [app],
  );

  return (
    <SettingsSection id={sectionId} title="Coordinates">
      <SettingsRow
        label="Policy"
        htmlFor="coordinate-policy"
        tooltip="Post-compose frame coordinates (before modifiers)."
      >
        <Select value={policy} onValueChange={onChange} disabled={!app}>
          <SelectTrigger id="coordinate-policy" className="h-8 w-[11.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COORDINATE_POLICIES.map((id) => (
              <SelectItem key={id} value={id}>
                {COORDINATE_POLICY_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  );
};
