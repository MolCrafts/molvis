import type {
  AnalysisParamSpec,
  AnalysisParamValues,
} from "@molcrafts/molvis-stage";
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
 * Renders a compute's parameters straight from the molrs catalog schema.
 *
 * There is no per-compute form: adding a compute in Rust makes its knobs
 * appear here. Scope (frame range, tracked atoms) is deliberately absent — it
 * lives in the shared scope region.
 */

interface AnalysisParamsFormProps {
  params: AnalysisParamSpec[];
  values: AnalysisParamValues;
  onChange: (next: AnalysisParamValues) => void;
  disabled?: boolean;
}

/**
 * List fields take a short example, not a sentence: a narrow rail clips long
 * placeholders inside a mono input. The rule goes on the caption line below.
 */
const LIST_PLACEHOLDER: Record<string, string> = {
  intList: "1, 2, 3",
  floatList: "1.0, 2.5",
  textList: "C, H, O",
};

const LIST_CAPTION: Record<string, string> = {
  intList: "Comma-separated integers",
  floatList: "Comma-separated numbers",
  textList: "Comma-separated names",
};

export const AnalysisParamsForm: React.FC<AnalysisParamsFormProps> = ({
  params,
  values,
  onChange,
  disabled,
}) => {
  if (params.length === 0) {
    return null;
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
      <span className="truncate text-micro">{spec.label}</span>
      {spec.unit && (
        <span className="shrink-0 text-micro text-muted-foreground">
          {spec.unit}
        </span>
      )}
      {spec.optional && (
        <span className="shrink-0 text-micro text-muted-foreground">
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
          <SelectTrigger
            id={controlId}
            className="h-control-compact px-2 text-xs"
          >
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
  const caption = LIST_CAPTION[spec.kind];
  return (
    <div className="flex flex-col gap-1">
      {label}
      <Input
        id={controlId}
        className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
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
      {/* Caption line under the control, as ParamStack does for estimates —
          the label row keeps its htmlFor binding, which ParamStack's span
          cannot provide. */}
      {caption ? (
        <span className="text-micro text-subtle-foreground">{caption}</span>
      ) : null}
    </div>
  );
}
