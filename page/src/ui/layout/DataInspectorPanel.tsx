import {
  type AtomRow,
  type BondRow,
  type ColumnDescriptor,
  discoverAtomColumns,
  extractAtomRows,
  extractBondRows,
  type Molvis,
} from "@molvis/core";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DataInspectorPanelProps {
  app: Molvis | null;
  filterAtomIds?: Set<number>;
  /** Bump to force re-filter when filterAtomIds content changes */
  filterRevision?: number;
  compact?: boolean;
}

const ROW_HEIGHT = 20;
const OVERSCAN = 5;

export const DataInspectorPanel: React.FC<DataInspectorPanelProps> = ({
  app,
  filterAtomIds,
  filterRevision = 0,
  compact = false,
}) => {
  const [columns, setColumns] = useState<ColumnDescriptor[]>([]);
  const [atomRows, setAtomRows] = useState<AtomRow[]>([]);
  const [bondRows, setBondRows] = useState<BondRow[]>([]);
  const [selectedAtomIds, setSelectedAtomIds] = useState<Set<number>>(
    new Set(),
  );
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bondScrollTop, setBondScrollTop] = useState(0);
  const bondContainerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    if (!app) return;
    const frame = app.system.frame;
    if (!frame) return;

    const atoms = frame.getBlock("atoms");
    if (atoms && atoms.nrows() > 0) {
      const cols = discoverAtomColumns(atoms);
      setColumns(cols);
      setAtomRows(extractAtomRows(atoms, cols));
    } else {
      setColumns([]);
      setAtomRows([]);
    }

    setBondRows(extractBondRows(frame));
  }, [app]);

  useEffect(() => {
    if (!app) return;
    refresh();

    const handleFrameChange = () => refresh();
    const handleSelectionChange = () => {
      const ids = app.world.selectionManager.getSelectedAtomIds();
      setSelectedAtomIds(ids);
    };

    app.events.on("frame-change", handleFrameChange);
    app.events.on("frame-rendered", handleFrameChange);
    app.world.selectionManager.on("selection-change", handleSelectionChange);

    return () => {
      app.events.off("frame-change", handleFrameChange);
      app.events.off("frame-rendered", handleFrameChange);
      app.world.selectionManager.off("selection-change", handleSelectionChange);
    };
  }, [app, refresh]);

  const handleAtomRowClick = (index: number) => {
    if (!app) return;
    app.world.selectionManager.apply({ type: "replace", atoms: [index] });
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const handleBondScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setBondScrollTop(e.currentTarget.scrollTop);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: filterRevision is an intentional cache-buster for Set identity changes
  const filteredAtomRows = useMemo(
    () =>
      filterAtomIds
        ? atomRows.filter((r) => filterAtomIds.has(r.index))
        : atomRows,
    [atomRows, filterAtomIds, filterRevision],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: filterRevision is an intentional cache-buster for Set identity changes
  const filteredBondRows = useMemo(
    () =>
      filterAtomIds
        ? bondRows.filter(
            (b) => filterAtomIds.has(b.i) && filterAtomIds.has(b.j),
          )
        : bondRows,
    [bondRows, filterAtomIds, filterRevision],
  );

  // Virtual scrolling
  const totalHeight = filteredAtomRows.length * ROW_HEIGHT;
  const visibleCount = containerRef.current
    ? Math.ceil(containerRef.current.clientHeight / ROW_HEIGHT)
    : 30;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    filteredAtomRows.length,
    startIdx + visibleCount + OVERSCAN * 2,
  );
  const visibleAtomRows = filteredAtomRows.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  // Virtual scrolling — bonds (mirrors the atoms window above). Without this,
  // a 23k-bond system mounts ~115k DOM nodes and freezes the UI on tab open.
  const bondTotalHeight = filteredBondRows.length * ROW_HEIGHT;
  const bondVisibleCount = bondContainerRef.current
    ? Math.ceil(bondContainerRef.current.clientHeight / ROW_HEIGHT)
    : 30;
  const bondStartIdx = Math.max(
    0,
    Math.floor(bondScrollTop / ROW_HEIGHT) - OVERSCAN,
  );
  const bondEndIdx = Math.min(
    filteredBondRows.length,
    bondStartIdx + bondVisibleCount + OVERSCAN * 2,
  );
  const visibleBondRows = filteredBondRows.slice(bondStartIdx, bondEndIdx);
  const bondOffsetY = bondStartIdx * ROW_HEIGHT;

  return (
    <Tabs defaultValue="atoms" className="h-full flex flex-col">
      <TabsList
        className={`shrink-0 w-full rounded-none border-b ${compact ? "h-5" : "h-6"}`}
      >
        <TabsTrigger
          value="atoms"
          className={`text-[10px] ${compact ? "h-4" : "h-5"}`}
        >
          Atoms ({filteredAtomRows.length})
        </TabsTrigger>
        <TabsTrigger
          value="bonds"
          className={`text-[10px] ${compact ? "h-4" : "h-5"}`}
        >
          Bonds ({filteredBondRows.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="atoms" className="flex-1 min-h-0 mt-0">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex bg-muted/30 border-b text-[9px] font-semibold text-muted-foreground shrink-0">
            <div className="w-8 px-0.5 py-0.5 text-right shrink-0">#</div>
            {columns.map((col) => (
              <div
                key={col.name}
                className="flex-1 min-w-0 px-0.5 py-0.5 truncate"
                title={`${col.name} (${col.dtype})`}
              >
                {col.name}
              </div>
            ))}
          </div>

          {/* Virtual scrolled body */}
          <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleScroll}
          >
            <div style={{ height: totalHeight, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: offsetY,
                  left: 0,
                  right: 0,
                }}
              >
                {visibleAtomRows.map((row) => (
                  <div
                    key={row.index}
                    className={`flex text-[10px] font-mono cursor-pointer hover:bg-muted/40 border-b border-border/50 ${
                      selectedAtomIds.has(row.index)
                        ? "bg-accent text-accent-foreground"
                        : ""
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => handleAtomRowClick(row.index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        handleAtomRowClick(row.index);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="w-8 px-0.5 flex items-center justify-end text-muted-foreground shrink-0">
                      {row.index}
                    </div>
                    {columns.map((col) => (
                      <div
                        key={col.name}
                        className="flex-1 min-w-0 px-0.5 flex items-center truncate"
                      >
                        {row.values.get(col.name) ?? "—"}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="bonds" className="flex-1 min-h-0 mt-0">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex bg-muted/30 border-b text-[9px] font-semibold text-muted-foreground shrink-0">
            <div className="w-8 px-0.5 py-0.5 text-right shrink-0">#</div>
            <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">i</div>
            <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">j</div>
            <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">ord</div>
          </div>

          {/* Virtual scrolled body */}
          <div
            ref={bondContainerRef}
            className="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleBondScroll}
          >
            <div style={{ height: bondTotalHeight, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: bondOffsetY,
                  left: 0,
                  right: 0,
                }}
              >
                {visibleBondRows.map((row) => (
                  <div
                    key={row.index}
                    className="flex text-[9px] font-mono border-b border-muted/5"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div className="w-8 px-0.5 flex items-center justify-end text-muted-foreground shrink-0">
                      {row.index}
                    </div>
                    <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                      {row.i}
                    </div>
                    <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                      {row.j}
                    </div>
                    <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                      {row.order}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {filteredBondRows.length === 0 && (
              <div className="p-1.5 text-[9px] text-muted-foreground">
                No bonds.
              </div>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
};
