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
  type Modifier,
  ModifierRegistry,
  type Molvis,
  nextModifierId,
} from "@molvis/core";
import { getAllAcceptExtensions, type LoadMode } from "@molvis/core/io";
import { Plus } from "lucide-react";
import {
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
import { Button } from "@/components/ui/button";
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
import { SortableModifierItem } from "./SortableModifierItem";
import { buildTree, flattenTree } from "./tree_utils";

type RegistryEntry = ReturnType<
  typeof ModifierRegistry.getAvailableModifiers
>[number];
type AvailableEntry = { entry: RegistryEntry; applicable: boolean };

const MODIFIER_MENU_GROUPS = [
  "Draw",
  "Selection",
  "Geometry",
  "Structure",
  "Color",
  "Other",
] as const;

type ModifierMenuGroup = (typeof MODIFIER_MENU_GROUPS)[number];

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
  const box = app?.frame?.simbox;
  if (!box) return DEFAULT_DRAW_BOX_FORM;
  try {
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
  } finally {
    box.free();
  }
}

interface PipelineListProps {
  app: Molvis | null;
  modifiers: Modifier[];
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelectModifier: (id: string) => void;
  onToggleModifier: (modifier: Modifier) => void;
  onRemoveModifier: (id: string) => void;
  onAddModifier: (factory: () => Modifier) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onToggleExpand: (id: string) => void;
}

export function PipelineList({
  app,
  modifiers,
  selectedId,
  expandedIds,
  onSelectModifier,
  onToggleModifier,
  onRemoveModifier,
  onAddModifier,
  onDragEnd,
  onToggleExpand,
}: PipelineListProps) {
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
  const [drawBoxForm, setDrawBoxForm] = useState<DrawBoxForm>(
    DEFAULT_DRAW_BOX_FORM,
  );

  const loadDataSourceFile = async (file: File, mode: LoadMode) => {
    if (!app) return;
    await loadFileSmart(app, file, pickFormat, mode, pickBondMapping);
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

  const tree = useMemo(() => buildTree(modifiers), [modifiers]);
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
    return ModifierRegistry.getAvailableModifiers().map((entry) => {
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
    const groups: Record<ModifierMenuGroup, AvailableEntry[]> = {
      Draw: [],
      Selection: [],
      Geometry: [],
      Structure: [],
      Color: [],
      Other: [],
    };
    for (const item of availableEntries) {
      groups[modifierMenuGroup(item.entry)].push(item);
    }
    return groups;
  }, [availableEntries]);

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
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <ScrollArea className="flex-1 min-h-0 bg-background">
        <div className="flex flex-col">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={flatNodes.map((n) => n.modifier.id)}
              strategy={verticalListSortingStrategy}
            >
              {flatNodes.map((node) => (
                <SortableModifierItem
                  key={node.modifier.id}
                  modifier={node.modifier}
                  selected={selectedId === node.modifier.id}
                  depth={node.depth}
                  hasChildren={node.children.length > 0}
                  isExpanded={expandedIds.has(node.modifier.id)}
                  onSelect={() => onSelectModifier(node.modifier.id)}
                  onToggle={() => onToggleModifier(node.modifier)}
                  onRemove={() => onRemoveModifier(node.modifier.id)}
                  onToggleExpand={() => onToggleExpand(node.modifier.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div className="p-1.5 border-t">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleDataSourceFile}
              accept={getAllAcceptExtensions()}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full min-w-0 border border-dashed text-muted-foreground px-2 sm:px-3 overflow-hidden"
                  title="Add"
                  aria-label="Add"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="min-w-[180px] max-w-[240px]"
              >
                <DropdownMenuItem className="text-xs" onSelect={openFilePicker}>
                  File loader…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {MODIFIER_MENU_GROUPS.map((group) => {
                  const entries = groupedEntries[group];
                  if (entries.length === 0) return null;
                  return (
                    <DropdownMenuSub key={group}>
                      <DropdownMenuSubTrigger className="text-xs">
                        {group}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        className="min-w-[180px] max-w-[240px]"
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
      <FileLoadConfirmDialog
        open={pendingFileLoad !== null}
        filename={pendingFileLoad?.name ?? ""}
        onCancel={() => setPendingFileLoad(null)}
        onAddSource={() => void resolvePendingFileLoad("augment")}
        onReplace={() => void resolvePendingFileLoad("replace")}
        onExtend={() => void resolvePendingFileLoad("extend")}
      />
    </div>
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
      <DialogContent className="max-w-[360px] gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Draw Box</DialogTitle>
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
                  className="flex h-7 items-center gap-2 rounded border px-2 text-xs"
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!valid} onClick={onSubmit}>
            Add
          </Button>
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
            className="h-7 px-2 text-xs"
          />
        ))}
      </div>
    </div>
  );
}
