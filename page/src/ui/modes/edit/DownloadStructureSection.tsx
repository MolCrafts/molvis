import { type Frame, SDFReader } from "@molcrafts/molvis-stage";
import { Download, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { useReportOperationStatus } from "@/hooks/useReportOperationStatus";
import { useViewerOperation } from "@/hooks/useViewerOperation";
import { SidebarSection } from "../../layout/SidebarSection";

type Source =
  | "pubchem"
  | "pdb"
  | "pdb-ihm"
  | "swiss-model"
  | "alphafold"
  | "model-archive"
  | "url";

interface SourceOption {
  value: Source;
  label: string;
  /** Placeholder shown in the identifier input. */
  placeholder: string;
  /** Human label for the identifier (shown left of input). */
  idLabel: string;
  enabled: boolean;
}

const SOURCES: SourceOption[] = [
  {
    value: "pubchem",
    label: "PubChem",
    placeholder: "aspirin or 2244",
    idLabel: "Name/CID",
    enabled: true,
  },
  {
    value: "pdb",
    label: "PDB",
    placeholder: "1tqn",
    idLabel: "PDB Id",
    enabled: false,
  },
  {
    value: "pdb-ihm",
    label: "PDB-IHM",
    placeholder: "",
    idLabel: "PDB-IHM Id",
    enabled: false,
  },
  {
    value: "swiss-model",
    label: "SWISS-MODEL",
    placeholder: "",
    idLabel: "UniProt Id",
    enabled: false,
  },
  {
    value: "alphafold",
    label: "AlphaFold DB",
    placeholder: "",
    idLabel: "UniProt Id",
    enabled: false,
  },
  {
    value: "model-archive",
    label: "Model Archive",
    placeholder: "",
    idLabel: "Ma Id",
    enabled: false,
  },
  {
    value: "url",
    label: "URL",
    placeholder: "https://…",
    idLabel: "URL",
    enabled: false,
  },
];

/**
 * Fetch the experimentally/PubChem-computed 3D SDF for a compound and
 * parse it into a {@link Frame}. Coordinates come from PubChem — no
 * additional 3D generation or optimization is performed.
 *
 * Accepts a CID (all-digits) or a compound name/synonym. Throws with a
 * distinct message when PubChem has no 3D record for the compound, so
 * callers can choose to fall back to SMILES + `generate3D`.
 */
async function fetchPubChem3DFrame(query: string): Promise<Frame> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Enter a PubChem name or CID");

  const ns = /^\d+$/.test(trimmed) ? "cid" : "name";
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${ns}/${encodeURIComponent(
    trimmed,
  )}/record/SDF?record_type=3d`;

  const res = await fetch(url, {
    headers: { Accept: "chemical/x-mdl-sdfile" },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`PubChem: "${trimmed}" not found`);
    throw new Error(`PubChem error ${res.status}`);
  }
  const sdf = await res.text();
  if (!sdf.trim()) throw new Error("PubChem returned empty SDF");

  const reader = new SDFReader(sdf);
  const frame = reader.read(0);
  if (!frame) throw new Error("PubChem SDF contained no records");
  return frame;
}

interface DownloadStructureSectionProps {
  /** Called with a 3D {@link Frame} when the source already provides
   * coordinates (e.g. PubChem 3D SDF). The parent places it as-is
   * without running any 3D generator. Takes ownership of the frame. */
  onFrameFetched: (frame: Frame) => void;
  /** Disable controls while the parent is placing. */
  disabled?: boolean;
  /** Let the builder lock sibling tools while the request is active. */
  onBusyChange?: (busy: boolean) => void;
  /** Controlled accordion open state (Edit panel exclusive sections). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const DOWNLOAD_COPY = {
  running: "Fetching the structure…",
  success: "3D structure ready",
  successDetail: "Click the 3D canvas to place copies (Esc to cancel).",
  error: "Could not download the structure",
};

export const DownloadStructureSection: React.FC<
  DownloadStructureSectionProps
> = ({
  onFrameFetched,
  onBusyChange,
  disabled = false,
  open,
  onOpenChange,
  className,
}) => {
  const [source, setSource] = useState<Source>("pubchem");
  const [query, setQuery] = useState<string>("");
  const {
    feedback,
    running: fetching,
    run: runDownload,
    reset: resetDownload,
  } = useViewerOperation();
  useReportOperationStatus(feedback);

  const current = SOURCES.find((s) => s.value === source) ?? SOURCES[0];
  const busy = disabled || fetching;

  useEffect(() => {
    onBusyChange?.(fetching);
    return () => onBusyChange?.(false);
  }, [fetching, onBusyChange]);

  useEffect(() => {
    if (disabled) resetDownload();
  }, [disabled, resetDownload]);

  const handleDownload = async () => {
    await runDownload(
      async () => {
        if (!query.trim()) {
          throw new Error(`Enter a ${current.idLabel}`);
        }
        if (source === "pubchem") {
          const frame = await fetchPubChem3DFrame(query);
          onFrameFetched(frame);
        } else {
          throw new Error(`${current.label} is not implemented yet`);
        }
      },
      DOWNLOAD_COPY,
      { successDurationMs: 2400 },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy) handleDownload();
  };

  return (
    <SidebarSection
      title="Download"
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={false}
      className={className}
    >
      <Select
        value={source}
        onValueChange={(v) => {
          setSource(v as Source);
          resetDownload();
        }}
        disabled={busy}
      >
        <SelectTrigger
          className="h-control-compact w-full px-2 text-xs"
          aria-label="Structure source"
          title="Structure source"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCES.map((s) => (
            <SelectItem key={s.value} value={s.value} disabled={!s.enabled}>
              <span className="text-xs">
                {s.label}
                {!s.enabled && (
                  <span className="ml-1 text-muted-foreground">(soon)</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={current.placeholder}
          className="h-control-compact flex-1 min-w-0 text-xs font-mono"
          aria-label={current.idLabel}
          title={current.idLabel}
          disabled={busy}
        />
        <ViewerAction
          purpose="dismiss"
          className="shrink-0"
          onClick={handleDownload}
          disabled={busy || !query.trim()}
          title={`Fetch from ${current.label}`}
          aria-label={`Fetch from ${current.label}`}
        >
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </ViewerAction>
      </div>
    </SidebarSection>
  );
};
