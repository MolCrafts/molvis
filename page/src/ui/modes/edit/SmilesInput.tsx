import { parseSMILES } from "@molcrafts/molvis-stage";
import { AlertCircle, Wand2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";

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
      const ir = parseSMILES(trimmed);
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
          className="h-control-compact flex-1 min-w-0 text-xs font-mono"
          aria-label="SMILES string"
          disabled={disabled}
        />
        <ViewerIconAction
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
