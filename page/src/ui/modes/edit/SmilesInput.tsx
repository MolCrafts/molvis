import {
  ErrorCircleRegular as AlertCircle,
  WandRegular as Wand2,
} from "@fluentui/react-icons";
import { SmilesIr } from "@molcrafts/molvis-stage";
import { IconAction, Input } from "@molcrafts/ui";
import type React from "react";
import { useState } from "react";

interface SmilesInputProps {
  onParsed: (smiles: string) => void;
  disabled?: boolean;
}

export const SmilesInput: React.FC<SmilesInputProps> = ({
  onParsed,
  disabled,
}) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleParse = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    try {
      const ir = SmilesIr.parse(trimmed);
      ir.free();
      setError(null);
      onParsed(trimmed);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleParse();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="CCO"
          className="h-control-compact flex-1 min-w-0 text-label font-mono"
          aria-label="SMILES string"
          disabled={disabled}
        />
        <IconAction
          icon={<Wand2 />}
          label="Parse SMILES and place"
          className="shrink-0"
          onClick={handleParse}
          disabled={disabled || !value.trim()}
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-1 text-micro text-status-failed-foreground leading-tight"
        >
          <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
          <span className="truncate">{error}</span>
        </p>
      )}
    </div>
  );
};
