import type { AnalysisParamSpec, AnalysisParamValues } from "@molvis/core";
import type React from "react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * Renders an analysis's parameters straight from the molrs catalog schema.
 *
 * There is no per-analysis form: adding an analysis in Rust makes its knobs
 * appear here. Scope (frame range, tracked atoms) is deliberately absent — it
 * lives in the shared scope region.
 */

interface AnalysisParamsFormProps {
  params: AnalysisParamSpec[];
  values: AnalysisParamValues;
  onChange: (next: AnalysisParamValues) => void;
  disabled?: boolean;
}

const LIST_PLACEHOLDER: Record<string, string> = {
  intList: "comma-separated integers",
  floatList: "comma-separated numbers",
  textList: "comma-separated names",
};

export const AnalysisParamsForm: React.FC<AnalysisParamsFormProps> = ({
  params,
  values,
  onChange,
  disabled,
}) => {
  if (params.length === 0) {
    return (
      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
        This analysis takes no parameters.
      </p>
    );
  }

  const set = (key: string, value: number | boolean | string) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="flex flex-col gap-2">
      {params.map((spec) => (
        <ParamField
          key={spec.key}
          spec={spec}
          value={values[spec.key] ?? spec.default}
          onChange={(value) => set(spec.key, value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};

function ParamField({
  spec,
  value,
  onChange,
  disabled,
}: {
  spec: AnalysisParamSpec;
  value: number | boolean | string;
  onChange: (next: number | boolean | string) => void;
  disabled?: boolean;
}) {
  // Switch and Select render buttons, not native inputs, so bind the label by
  // id instead of wrapping the control in it.
  const controlId = useId();
  const label = (
    <label
      htmlFor={controlId}
      className="flex min-w-0 cursor-default items-baseline gap-1"
    >
      <span className="truncate text-[11px]">{spec.label}</span>
      {spec.unit && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {spec.unit}
        </span>
      )}
      {spec.optional && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          (optional)
        </span>
      )}
    </label>
  );

  if (spec.kind === "bool") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <Switch
          id={controlId}
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  if (spec.kind === "select") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <Select
          value={String(value)}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={controlId} className="h-7 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(spec.options ?? []).map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const numeric = spec.kind === "int" || spec.kind === "float";
  return (
    <div className="flex flex-col gap-1">
      {label}
      <Input
        id={controlId}
        className="h-7 min-w-0 font-mono text-xs"
        inputMode={numeric ? "decimal" : "text"}
        value={String(value)}
        placeholder={LIST_PLACEHOLDER[spec.kind] ?? String(spec.default)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (!numeric) return onChange(raw);
          const parsed = Number(raw);
          onChange(
            raw.trim() === "" || !Number.isFinite(parsed) ? raw : parsed,
          );
        }}
      />
    </div>
  );
}
