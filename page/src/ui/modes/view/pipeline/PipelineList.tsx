import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  DrawBoxModifier,
  type DrawBoxSpec,
  MODIFIER_CATEGORIES,
  type Modifier,
  ModifierRegistry,
  type Molvis,
  nextModifierId,
  type PipelineEntry,
  StreamDataSource,
} from "@molcrafts/molvis-stage";
import {
  getAllAcceptExtensions,
  type LoadMode,
} from "@molcrafts/molvis-stage/io";
import {
  Atom,
  ChartColumn,
  Eye,
  FilePlus2,
  Filter,
  Palette,
  Plus,
  Radio,
  Shapes,
  Wand2,
} from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  FileLoadConfirmDialog,
  sceneHasLoadedData,
} from "@/components/file-load-confirm-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { SortableModifierItem } from "./SortableModifierItem";
import { buildTree, flattenTree } from "./tree_utils";

type RegistryEntry = ReturnType<
  typeof ModifierRegistry.getAvailableModifiers
>[number];
type AvailableEntry = { entry: RegistryEntry; applicable: boolean };

/** OVITO Add-menu groups (same order as OVITO; plus Other for plugins). */
const MODIFIER_MENU_GROUPS = [...MODIFIER_CATEGORIES, "Other"] as const;

type ModifierMenuGroup = (typeof MODIFIER_MENU_GROUPS)[number];

const GROUP_ICONS: Record<
  ModifierMenuGroup,
  ComponentType<{ className?: string }>
> = {
  Selection: Filter,
  Modification: Shapes,
  Coloring: Palette,
  "Structure identification": Atom,
  Visualization: Eye,
  Analysis: ChartColumn,
  Other: Wand2,
};

type DrawBoxForm = {
  lx: string;
  ly: string;
  lz: string;
  ox: string;
  oy: string;
  oz: string;
  px: boolean;
  py: boolean;
  pz: boolean;
};

const MENU_SCROLL_STYLE = {
  maxHeight: "min(420px, calc(100vh - 6rem))",
  overflowX: "hidden",
  overflowY: "auto",
} satisfies CSSProperties;

const DEFAULT_DRAW_BOX_FORM: DrawBoxForm = {
  lx: "30",
  ly: "30",
  lz: "30",
  ox: "0",
  oy: "0",
  oz: "0",
  px: true,
  py: true,
  pz: true,
};

const FILE_LOAD_COPY = {
  running: "Loading the data source…",
  success: "Data source loaded",
  error: "Could not load the data source",
};

const STREAM_CONNECT_COPY = {
  running: "Connecting to stream",
  success: "Stream connected",
  error: "Could not connect to stream",
};

function modifierMenuGroup(entry: RegistryEntry): ModifierMenuGroup {
  if (MODIFIER_MENU_GROUPS.includes(entry.category as ModifierMenuGroup)) {
    return entry.category as ModifierMenuGroup;
  }
  return "Other";
}

function parsePositive(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseFinite(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function drawBoxSpecFromForm(form: DrawBoxForm): DrawBoxSpec | null {
  const lx = parsePositive(form.lx);
  const ly = parsePositive(form.ly);
  const lz = parsePositive(form.lz);
  const ox = parseFinite(form.ox);
  const oy = parseFinite(form.oy);
  const oz = parseFinite(form.oz);
  if ([lx, ly, lz, ox, oy, oz].some((value) => value === null)) return null;
  return {
    lengths: [lx, ly, lz] as [number, number, number],
    origin: [ox, oy, oz] as [number, number, number],
    pbc: [form.px, form.py, form.pz],
  };
}

function drawBoxFormFromApp(app: Molvis | null): DrawBoxForm {
  // `frame.box` is a frame-owned getter handle — free only the WasmArray
  // views (lengths/origin), never the Box itself.
  const box = app?.frame?.box;
  if (!box) return DEFAULT_DRAW_BOX_FORM;
  const lengths = box.lengths();
  const origin = box.origin();
  try {
    const l = lengths.toCopy();
    const o = origin.toCopy();
    const pbc = box.pbc();
    return {
      lx: String(l[0] ?? 30),
      ly: String(l[1] ?? 30),
      lz: String(l[2] ?? 30),
      ox: String(o[0] ?? 0),
      oy: String(o[1] ?? 0),
      oz: String(o[2] ?? 0),
      px: pbc[0] !== 0,
      py: pbc[1] !== 0,
      pz: pbc[2] !== 0,
    };
  } finally {
    lengths.free();
    origin.free();
  }
}

interface PipelineListProps {
  app: Molvis | null;
  entries: PipelineEntry[];
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelectModifier: (id: string) => void;
  onToggleModifier: (entry: PipelineEntry) => void;
  onRemoveModifier: (id: string) => void;
  onAddModifier: (factory: () => Modifier) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onToggleExpand: (id: string) => void;
}

export function PipelineList({
  app,
  entries,
  selectedId,
  expandedIds,
  onSelectModifier,
  onToggleModifier,
  onRemoveModifier,
  onAddModifier,
  onDragEnd,
  onToggleExpand,
}: PipelineListProps) {
  const { run: runPipelineOperation, running: pipelineOperationRunning } =
    usePipelineOperation();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pickFormat = useFormatPicker();
  const pickBondMapping = useBondMappingPicker();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileLoad, setPendingFileLoad] = useState<File | null>(null);
  const [drawBoxDialogOpen, setDrawBoxDialogOpen] = useState(false);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamAddress, setStreamAddress] = useState("ws://localhost:8765");
  const [drawBoxForm, setDrawBoxForm] = useState<DrawBoxForm>(
    DEFAULT_DRAW_BOX_FORM,
  );

  const loadDataSourceFile = async (file: File, mode: LoadMode) => {
    if (!app) return;
    await runPipelineOperation(async () => {
      // Throws with molrs parse detail on failure — keep that message.
      const result = await loadFileSmart(
        app,
        file,
        pickFormat,
        mode,
        pickBondMapping,
      );
      if (result === "cancelled") {
        throw new DOMException("File loading cancelled", "AbortError");
      }
      return result;
    }, FILE_LOAD_COPY);
  };

  const handleDataSourceFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;
    try {
      if (sceneHasLoadedData(app)) {
        setPendingFileLoad(file);
      } else {
        await loadDataSourceFile(file, "replace");
      }
    } finally {
      e.target.value = "";
    }
  };

  const openFilePicker = () => {
    requestAnimationFrame(() => fileInputRef.current?.click());
  };

  const resolvePendingFileLoad = async (mode: LoadMode) => {
    const file = pendingFileLoad;
    setPendingFileLoad(null);
    if (!file) return;
    await loadDataSourceFile(file, mode);
  };

  const openDrawBoxDialog = () => {
    setDrawBoxForm(drawBoxFormFromApp(app));
    setDrawBoxDialogOpen(true);
  };

  const addManualDrawBox = () => {
    const spec = drawBoxSpecFromForm(drawBoxForm);
    if (!spec) return;
    onAddModifier(() => new DrawBoxModifier(nextModifierId("draw-box"), spec));
    setDrawBoxDialogOpen(false);
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const flatNodes = useMemo(
    () => flattenTree(tree, expandedIds),
    [tree, expandedIds],
  );

  // Bump on every frame-change so the manual-add picker re-evaluates
  // each entry's `isApplicable(currentFrame)`. Without this the picker
  // would freeze its applicability snapshot at first render.
  const [frameVersion, setFrameVersion] = useState(0);
  useEffect(() => {
    if (!app) return;
    const bump = () => setFrameVersion((v) => v + 1);
    bump();
    const unsub = app.events.on("frame-change", bump);
    return () => {
      app.events.off("frame-change", bump);
      unsub?.();
    };
  }, [app]);

  // Probe each registered modifier against the current frame to decide
  // whether the manual-add picker should render it as enabled. Done as
  // a memo because `isApplicable()` may scan column data (e.g. the
  // BackboneRibbon CA scan), which we don't want to re-run per render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frameVersion is the cache-busting signal — app.frame may keep the same reference while content changes underneath.
  const availableEntries = useMemo(() => {
    const frame = app?.frame ?? null;
    // Only user-addable entries (auto-attach visual elements like Draw
    // Atoms / Ribbon / Isosurface stay out of the menu — OVITO-style).
    return ModifierRegistry.getUserAddableModifiers().map((entry) => {
      // No frame loaded → don't gate. A user staging a pipeline before
      // loading data should still see every option.
      if (!frame || entry.name === DrawBoxModifier.NAME) {
        return { entry, applicable: true };
      }
      try {
        const probe = entry.factory();
        return { entry, applicable: probe.isApplicable(frame) };
      } catch {
        return { entry, applicable: true };
      }
    });
  }, [app, frameVersion]);

  const groupedEntries = useMemo(() => {
    const groups = Object.fromEntries(
      MODIFIER_MENU_GROUPS.map((g) => [g, [] as AvailableEntry[]]),
    ) as Record<ModifierMenuGroup, AvailableEntry[]>;
    for (const item of availableEntries) {
      groups[modifierMenuGroup(item.entry)].push(item);
    }
    return groups;
  }, [availableEntries]);

  /**
   * Attach a live producer as a source. It dials on `connect()`; a frame that
   * arrives lengthens the timeline through the same append path a Python
   * `append_frame` uses, so nothing downstream learns a second way to grow.
   */
  const addStreamSource = () => {
    if (!app) return;
    const source = new StreamDataSource(streamAddress.trim());
    setStreamDialogOpen(false);
    void runPipelineOperation(async () => {
      await app.addDataSource(source);
      source.connect(() => {
        void app.applyPipeline({ fullRebuild: false });
      });
    }, STREAM_CONNECT_COPY);
  };

  const renderModifierItem = ({ entry, applicable }: AvailableEntry) => (
    <DropdownMenuItem
      key={entry.name}
      className="text-xs"
      disabled={!applicable}
      onSelect={() => {
        if (entry.name === DrawBoxModifier.NAME) {
          openDrawBoxDialog();
          return;
        }
        onAddModifier(entry.factory);
      }}
      title={
        applicable
          ? undefined
          : `${entry.name} is not applicable to the current frame`
      }
    >
      {entry.name}
    </DropdownMenuItem>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* +Add lives in the scroll content, immediately under the last modifier. */}
      <ScrollArea className="min-h-0 min-w-0 flex-1 bg-background">
        <div className="flex min-w-0 flex-col">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={flatNodes.map((n) => n.entry.id)}
              strategy={verticalListSortingStrategy}
            >
              {flatNodes.map((node) => (
                <SortableModifierItem
                  key={node.entry.id}
                  modifier={node.entry}
                  selected={selectedId === node.entry.id}
                  depth={node.depth}
                  hasChildren={node.children.length > 0}
                  isExpanded={expandedIds.has(node.entry.id)}
                  onSelect={() => onSelectModifier(node.entry.id)}
                  onToggle={() => onToggleModifier(node.entry)}
                  onRemove={() => onRemoveModifier(node.entry.id)}
                  onToggleExpand={() => onToggleExpand(node.entry.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div className="border-t border-border p-1.5">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleDataSourceFile}
              accept={getAllAcceptExtensions()}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <ViewerAction
                  purpose="dismiss"
                  className="h-control-compact w-full min-w-0 justify-center border-dashed px-2 text-muted-foreground hover:text-foreground"
                  title="Add modifier"
                  aria-label="Add modifier"
                >
                  <Plus />
                  <span className="truncate">Add</span>
                </ViewerAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="min-w-pipeline-menu-min max-w-pipeline-menu-max"
              >
                <DropdownMenuItem
                  className="text-xs gap-2"
                  onSelect={openFilePicker}
                >
                  <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
                  File loader…
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs gap-2"
                  onSelect={() => setStreamDialogOpen(true)}
                >
                  <Radio className="h-3.5 w-3.5 shrink-0" />
                  Live stream…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {MODIFIER_MENU_GROUPS.map((group) => {
                  const entries = groupedEntries[group];
                  if (entries.length === 0) return null;
                  const GroupIcon = GROUP_ICONS[group];
                  return (
                    <DropdownMenuSub key={group}>
                      <DropdownMenuSubTrigger className="text-xs gap-2">
                        <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                        {group}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        className="min-w-pipeline-menu-min max-w-pipeline-menu-max"
                        style={MENU_SCROLL_STYLE}
                      >
                        {entries.map(renderModifierItem)}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ScrollArea>

      <DrawBoxDialog
        open={drawBoxDialogOpen}
        form={drawBoxForm}
        valid={drawBoxSpecFromForm(drawBoxForm) !== null}
        onOpenChange={setDrawBoxDialogOpen}
        onFormChange={setDrawBoxForm}
        onSubmit={addManualDrawBox}
      />
      <StreamSourceDialog
        open={streamDialogOpen}
        address={streamAddress}
        busy={pipelineOperationRunning}
        onOpenChange={setStreamDialogOpen}
        onAddressChange={setStreamAddress}
        onSubmit={addStreamSource}
      />
      <FileLoadConfirmDialog
        open={pendingFileLoad !== null}
        filename={pendingFileLoad?.name ?? ""}
        busy={pipelineOperationRunning}
        onCancel={() => setPendingFileLoad(null)}
        onAddSource={() => void resolvePendingFileLoad("augment")}
        onReplace={() => void resolvePendingFileLoad("replace")}
        onExtend={() => void resolvePendingFileLoad("extend")}
      />
    </div>
  );
}

interface StreamSourceDialogProps {
  open: boolean;
  address: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onAddressChange: (address: string) => void;
  onSubmit: () => void;
}

/**
 * Ask for the producer's address.
 *
 * The producer binds and MolVis dials, so what goes here is the socket a
 * `molrs::stream::FrameServer` is already listening on — not a port for MolVis
 * to open. A page cannot bind one.
 */
function StreamSourceDialog({
  open,
  address,
  busy,
  onOpenChange,
  onAddressChange,
  onSubmit,
}: StreamSourceDialogProps) {
  const valid = /^wss?:\/\/.+/.test(address.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Live stream</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          <Input
            className="h-control-compact font-mono text-xs"
            aria-label="Producer WebSocket address"
            placeholder="ws://host:8765"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !busy) onSubmit();
            }}
          />
          <p className="text-micro text-muted-foreground">
            The address a producer is publishing frames on.
          </p>
        </div>
        <DialogFooter>
          <ViewerAction
            purpose="dismiss"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </ViewerAction>
          <ViewerAction onClick={onSubmit} disabled={!valid || busy}>
            Connect
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DrawBoxDialogProps {
  open: boolean;
  form: DrawBoxForm;
  valid: boolean;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: DrawBoxForm) => void;
  onSubmit: () => void;
}

function DrawBoxDialog({
  open,
  form,
  valid,
  onOpenChange,
  onFormChange,
  onSubmit,
}: DrawBoxDialogProps) {
  const setField =
    (key: keyof DrawBoxForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
      onFormChange({ ...form, [key]: event.target.value });
  const setPbc = (key: "px" | "py" | "pz") => (checked: boolean) =>
    onFormChange({ ...form, [key]: checked });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Simulation cell</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <BoxVectorInputs
            label="Lengths"
            values={[form.lx, form.ly, form.lz]}
            min="0"
            onChange={[setField("lx"), setField("ly"), setField("lz")]}
          />
          <BoxVectorInputs
            label="Origin"
            values={[form.ox, form.oy, form.oz]}
            onChange={[setField("ox"), setField("oy"), setField("oz")]}
          />
          <div className="space-y-1">
            <Label className="text-xs font-semibold">PBC</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["px", "X"],
                  ["py", "Y"],
                  ["pz", "Z"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  htmlFor={`pbc-${key}`}
                  className="flex h-control-compact items-center gap-2 rounded-control border px-2 text-xs"
                >
                  <Checkbox
                    id={`pbc-${key}`}
                    checked={form[key]}
                    onCheckedChange={(checked) => setPbc(key)(checked === true)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <ViewerAction
            type="button"
            purpose="dismiss"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </ViewerAction>
          <ViewerAction type="button" disabled={!valid} onClick={onSubmit}>
            Add
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BoxVectorInputsProps {
  label: string;
  values: [string, string, string];
  min?: string;
  onChange: [
    (event: React.ChangeEvent<HTMLInputElement>) => void,
    (event: React.ChangeEvent<HTMLInputElement>) => void,
    (event: React.ChangeEvent<HTMLInputElement>) => void,
  ];
}

function BoxVectorInputs({
  label,
  values,
  min,
  onChange,
}: BoxVectorInputsProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <Input
            key={axis}
            type="number"
            min={min}
            step="0.1"
            value={values[index]}
            onChange={onChange[index]}
            aria-label={`${label} ${axis}`}
            className="h-control-compact px-2 text-xs"
          />
        ))}
      </div>
    </div>
  );
}
