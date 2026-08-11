import {
  type AtomRow,
  type BondRow,
  type ColumnDescriptor,
  discoverAtomColumns,
  extractAtomRows,
  extractBondRows,
  type Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  resolveInspectorRowHeight,
  rowIndexFromContentY,
} from "@/lib/data-inspector-rows";

interface DataInspectorPanelProps {
  app: Molvis | null;
  filterAtomIds?: Set<number>;
  /** Bump to force re-filter when filterAtomIds content changes */
  filterRevision?: number;
  compact?: boolean;
}

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
  // One height drives CSS row style and virtualizer math.
  const rowHeight = useMemo(() => resolveInspectorRowHeight(), []);

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

  const handleAtomRowClick = (atomIndex: number) => {
    if (!app) return;
    app.world.selectionManager.apply({ type: "replace", atoms: [atomIndex] });
  };

  /**
   * Prefer data-row mapping; fall back to geometry so coarse hit targets and
   * the virtualizer stay consistent under scroll.
   */
  const atomIndexFromPointer = (
    e: React.MouseEvent<HTMLElement>,
    container: HTMLDivElement | null,
  ): number => {
    if (!container) return -1;
    const rect = container.getBoundingClientRect();
    const contentY = container.scrollTop + (e.clientY - rect.top);
    const visualIndex = rowIndexFromContentY(
      contentY,
      rowHeight,
      filteredAtomRows.length,
    );
    if (visualIndex < 0) return -1;
    return filteredAtomRows[visualIndex]?.index ?? -1;
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

  const atomEmptyTitle =
    atomRows.length === 0
      ? "No atoms"
      : filterAtomIds
        ? "No matching atoms"
        : "No atoms";
  const bondEmptyTitle =
    bondRows.length === 0
      ? "No bonds"
      : filterAtomIds
        ? "No matching bonds"
        : "No bonds";

  // Virtual scrolling
  const totalHeight = filteredAtomRows.length * rowHeight;
  const visibleCount = containerRef.current
    ? Math.ceil(containerRef.current.clientHeight / rowHeight)
    : 30;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIdx = Math.min(
    filteredAtomRows.length,
    startIdx + visibleCount + OVERSCAN * 2,
  );
  const visibleAtomRows = filteredAtomRows.slice(startIdx, endIdx);
  const offsetY = startIdx * rowHeight;

  const bondTotalHeight = filteredBondRows.length * rowHeight;
  const bondVisibleCount = bondContainerRef.current
    ? Math.ceil(bondContainerRef.current.clientHeight / rowHeight)
    : 30;
  const bondStartIdx = Math.max(
    0,
    Math.floor(bondScrollTop / rowHeight) - OVERSCAN,
  );
  const bondEndIdx = Math.min(
    filteredBondRows.length,
    bondStartIdx + bondVisibleCount + OVERSCAN * 2,
  );
  const visibleBondRows = filteredBondRows.slice(bondStartIdx, bondEndIdx);
  const bondOffsetY = bondStartIdx * rowHeight;

  return (
    <Tabs defaultValue="atoms" className="h-full flex flex-col gap-0">
      <TabsList
        variant="line"
        className={`w-full shrink-0 gap-0 rounded-none border-b border-border/70 p-0 ${compact ? "h-5" : "h-6"}`}
      >
        <TabsTrigger
          value="atoms"
          className={`rounded-none text-micro after:bottom-0 ${compact ? "h-5" : "h-6"}`}
        >
          Atoms ({filteredAtomRows.length})
        </TabsTrigger>
        <TabsTrigger
          value="bonds"
          className={`rounded-none text-micro after:bottom-0 ${compact ? "h-5" : "h-6"}`}
        >
          Bonds ({filteredBondRows.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="atoms" className="flex-1 min-h-0 mt-0">
        <div className="h-full flex flex-col">
          <div className="flex bg-muted/30 border-b text-micro font-semibold text-muted-foreground shrink-0">
            <div className="w-8 px-1 py-1 text-right shrink-0">#</div>
            {columns.map((col) => (
              <div
                key={col.name}
                className="flex-1 min-w-0 px-1 py-1 truncate"
                title={`${col.name} (${col.dtype})`}
              >
                {col.name}
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleScroll}
          >
            {filteredAtomRows.length === 0 ? (
              <EmptyState
                title={atomEmptyTitle}
                density="inline"
                className="px-2 py-3"
              />
            ) : (
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
                    <button
                      type="button"
                      key={row.index}
                      className={`flex w-full cursor-pointer appearance-none border-b border-border/50 bg-transparent text-left font-mono text-micro hover:bg-muted/40 ${
                        selectedAtomIds.has(row.index)
                          ? "bg-accent/15 text-foreground"
                          : ""
                      }`}
                      style={{ height: rowHeight }}
                      onClick={(e) => {
                        const fromGeom = atomIndexFromPointer(
                          e,
                          containerRef.current,
                        );
                        handleAtomRowClick(
                          fromGeom >= 0 ? fromGeom : row.index,
                        );
                      }}
                    >
                      <span className="flex w-8 shrink-0 items-center justify-end px-1 text-muted-foreground">
                        {row.index}
                      </span>
                      {columns.map((col) => (
                        <span
                          key={col.name}
                          className="flex min-w-0 flex-1 items-center truncate px-1"
                        >
                          {row.values.get(col.name) ?? "—"}
                        </span>
                      ))}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="bonds" className="flex-1 min-h-0 mt-0">
        <div className="h-full flex flex-col">
          <div className="flex bg-muted/30 border-b text-micro font-semibold text-muted-foreground shrink-0">
            <div className="w-8 px-1 py-1 text-right shrink-0">#</div>
            <div className="flex-1 min-w-0 px-1 py-1 truncate">i</div>
            <div className="flex-1 min-w-0 px-1 py-1 truncate">j</div>
            <div className="flex-1 min-w-0 px-1 py-1 truncate">ord</div>
          </div>

          <div
            ref={bondContainerRef}
            className="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleBondScroll}
          >
            {filteredBondRows.length === 0 ? (
              <EmptyState
                title={bondEmptyTitle}
                density="inline"
                className="px-2 py-3"
              />
            ) : (
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
                      className="flex text-micro font-mono border-b border-muted/5"
                      style={{ height: rowHeight }}
                    >
                      <div className="w-8 px-1 flex items-center justify-end text-muted-foreground shrink-0">
                        {row.index}
                      </div>
                      <div className="flex-1 min-w-0 px-1 flex items-center truncate">
                        {row.i}
                      </div>
                      <div className="flex-1 min-w-0 px-1 flex items-center truncate">
                        {row.j}
                      </div>
                      <div className="flex-1 min-w-0 px-1 flex items-center truncate">
                        {row.order}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
};
