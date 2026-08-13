import {
  type AtomRow,
  type BondColumns,
  type ColumnDescriptor,
  type ColumnSortKeys,
  discoverAtomColumns,
  extractAtomRowsAt,
  extractAtomSortKeys,
  extractBondColumns,
  type Molvis,
} from "@molcrafts/molvis-stage";
import { Loader2 } from "lucide-react";
import type React from "react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePointerDrag } from "@/hooks/usePointerDrag";
import {
  filterIndices,
  resolveInspectorRowHeight,
  rowIndexFromContentY,
  type SortSpec,
  sortIndices,
  toggleSort,
} from "@/lib/data-inspector-rows";

interface DataInspectorPanelProps {
  app: Molvis | null;
  filterAtomIds?: Set<number>;
  /** Bump to force re-filter when filterAtomIds content changes */
  filterRevision?: number;
  compact?: boolean;
}

const OVERSCAN = 5;
const INDEX_COL_WIDTH = 36;
const DEFAULT_COL_WIDTH = 72;
const MIN_COL_WIDTH = 40;

/** Virtual index column key — sorts by row index, never a data column name. */
const INDEX_KEY = "#";

interface HeaderColumn {
  key: string;
  label: string;
  title?: string;
}

function widthOf(widths: Record<string, number>, key: string): number {
  return (
    widths[key] ?? (key === INDEX_KEY ? INDEX_COL_WIDTH : DEFAULT_COL_WIDTH)
  );
}

/**
 * One sortable, resizable header cell. The label toggles the sort
 * (asc → desc → off); the grab zone is an invisible overlay on the right
 * edge that only tints on hover/drag, so the header reads as plain text
 * with hairline separators.
 */
function HeaderCell({
  column,
  width,
  sort,
  onSort,
  onResize,
}: {
  column: HeaderColumn;
  width: number;
  sort: SortSpec | null;
  onSort: () => void;
  onResize: (width: number) => void;
}) {
  const startWidthRef = useRef(0);
  const { onPointerDown } = usePointerDrag({
    onMove: (event, origin) => {
      onResize(
        Math.max(
          MIN_COL_WIDTH,
          startWidthRef.current + event.clientX - origin.x,
        ),
      );
    },
  });
  const active = sort?.key === column.key;

  return (
    <div
      className="relative flex shrink-0 items-center border-r border-border/40"
      style={{ width }}
    >
      <button
        type="button"
        className={`min-w-0 flex-1 cursor-pointer truncate px-1 py-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          active ? "text-foreground" : ""
        }`}
        title={column.title ?? column.label}
        onClick={onSort}
      >
        {column.label}
        {active && (
          <span className="text-accent">{sort.dir === 1 ? " ↑" : " ↓"}</span>
        )}
      </button>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.label} column`}
        aria-valuenow={width}
        tabIndex={0}
        className="absolute inset-y-0 right-0 z-10 w-[5px] translate-x-[2px] cursor-col-resize touch-none bg-transparent outline-none hover:bg-accent/60 focus-visible:bg-accent"
        onPointerDown={(event) => {
          startWidthRef.current = width;
          onPointerDown(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResize(Math.max(MIN_COL_WIDTH, width - 8));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResize(width + 8);
          }
        }}
      />
    </div>
  );
}

/**
 * Virtualized atoms/bonds table over LAZY data: only row *indices* are ever
 * held in memory (typed arrays); the visible window is materialized from the
 * frame Block on demand. Filtering and sorting run on deferred values so the
 * canvas selection highlight always paints before the table catches up.
 */
export const DataInspectorPanel: React.FC<DataInspectorPanelProps> = ({
  app,
  filterAtomIds,
  filterRevision = 0,
  compact = false,
}) => {
  const [columns, setColumns] = useState<ColumnDescriptor[]>([]);
  const [atomCount, setAtomCount] = useState(0);
  const [bondCols, setBondCols] = useState<BondColumns | null>(null);
  /** Bumped on every frame refresh — invalidates window/sort-key caches. */
  const [dataRev, setDataRev] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedAtomIds, setSelectedAtomIds] = useState<Set<number>>(
    new Set(),
  );
  const [tab, setTab] = useState("atoms");
  const [atomSort, setAtomSort] = useState<SortSpec | null>(null);
  const [bondSort, setBondSort] = useState<SortSpec | null>(null);
  const [atomWidths, setAtomWidths] = useState<Record<string, number>>({});
  const [bondWidths, setBondWidths] = useState<Record<string, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedAtom, setFocusedAtom] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const atomRowsWrapRef = useRef<HTMLDivElement>(null);
  const [bondScrollTop, setBondScrollTop] = useState(0);
  const bondContainerRef = useRef<HTMLDivElement>(null);
  // One height drives CSS row style and virtualizer math.
  const rowHeight = useMemo(() => resolveInspectorRowHeight(), []);

  // Selection-driven work renders at deferred priority: the canvas highlight
  // and toolbar chip commit first, the table refilters afterwards.
  const deferredFilterIds = useDeferredValue(filterAtomIds);
  const deferredRevision = useDeferredValue(filterRevision);
  const deferredSelectedIds = useDeferredValue(selectedAtomIds);

  const refresh = useCallback(() => {
    if (!app) return;
    setLoading(true);
    // Double-RAF: the first rAF fires *before* paint, so scheduling the
    // extraction inside a nested rAF lets the spinner actually reach the
    // screen for one frame before the synchronous WASM copies run.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const frame = app.system.frame;
        if (!frame) {
          setColumns([]);
          setAtomCount(0);
          setBondCols(null);
          setLoading(false);
          return;
        }
        const atoms = frame.getBlock("atoms");
        if (atoms && atoms.nrows() > 0) {
          setColumns(discoverAtomColumns(atoms));
          setAtomCount(atoms.nrows());
        } else {
          setColumns([]);
          setAtomCount(0);
        }
        setBondCols(extractBondColumns(frame));
        setDataRev((rev) => rev + 1);
        setLoading(false);
      });
    });
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
    app.world.selectionManager.on("selection-change", handleSelectionChange);

    return () => {
      app.events.off("frame-change", handleFrameChange);
      app.world.selectionManager.off("selection-change", handleSelectionChange);
    };
  }, [app, refresh]);

  const handleAtomRowClick = (atomIndex: number) => {
    setFocusedAtom(atomIndex);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const handleBondScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setBondScrollTop(e.currentTarget.scrollTop);
  };

  // ── Atom index pipeline: filter → sort → window ─────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: deferredRevision is an intentional cache-buster for Set identity changes
  const atomFilteredIdx = useMemo<Uint32Array | null>(() => {
    if (!deferredFilterIds) return null; // identity — never materialized
    return filterIndices(atomCount, (i) => deferredFilterIds.has(i));
  }, [deferredFilterIds, deferredRevision, atomCount]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataRev invalidates the WASM-side column cache
  const atomSortKeys = useMemo<ColumnSortKeys | null>(() => {
    if (!app || !atomSort || atomSort.key === INDEX_KEY) return null;
    const col = columns.find((c) => c.name === atomSort.key);
    const block = app.system.frame?.getBlock("atoms");
    if (!col || !block) return null;
    return extractAtomSortKeys(block, col);
  }, [app, atomSort, columns, dataRev]);

  const atomDisplayIdx = useMemo<Uint32Array | null>(() => {
    if (!atomSort) return atomFilteredIdx;
    const { key, dir } = atomSort;
    if (key === INDEX_KEY) {
      return sortIndices(atomFilteredIdx, atomCount, (a, b) => dir * (a - b));
    }
    if (!atomSortKeys) return atomFilteredIdx;
    const compare =
      atomSortKeys.kind === "numeric"
        ? (a: number, b: number) =>
            dir * (atomSortKeys.values[a] - atomSortKeys.values[b]) || a - b
        : (a: number, b: number) =>
            dir *
              atomSortKeys.values[a].localeCompare(atomSortKeys.values[b]) ||
            a - b;
    return sortIndices(atomFilteredIdx, atomCount, compare);
  }, [atomFilteredIdx, atomSort, atomSortKeys, atomCount]);

  const atomDisplayCount = atomDisplayIdx?.length ?? atomCount;
  const atomRowIndexAt = useCallback(
    (visual: number): number => atomDisplayIdx?.[visual] ?? visual,
    [atomDisplayIdx],
  );

  // ── Bond index pipeline (fully columnar) ────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: deferredRevision is an intentional cache-buster for Set identity changes
  const bondFilteredIdx = useMemo<Uint32Array | null>(() => {
    if (!bondCols || !deferredFilterIds) return null;
    return filterIndices(
      bondCols.count,
      (b) =>
        deferredFilterIds.has(bondCols.i[b]) &&
        deferredFilterIds.has(bondCols.j[b]),
    );
  }, [bondCols, deferredFilterIds, deferredRevision]);

  const bondDisplayIdx = useMemo<Uint32Array | null>(() => {
    if (!bondCols || !bondSort) return bondFilteredIdx;
    const { key, dir } = bondSort;
    const keyOf = (b: number): number =>
      key === "i"
        ? bondCols.i[b]
        : key === "j"
          ? bondCols.j[b]
          : key === "ord"
            ? (bondCols.order?.[b] ?? 1)
            : b;
    return sortIndices(
      bondFilteredIdx,
      bondCols.count,
      (a, b) => dir * (keyOf(a) - keyOf(b)) || a - b,
    );
  }, [bondCols, bondFilteredIdx, bondSort]);

  const bondDisplayCount = bondDisplayIdx?.length ?? bondCols?.count ?? 0;

  // No bonds → no Bonds tab at all; bounce back if it was active.
  const showBondsTab = bondDisplayCount > 0;
  useEffect(() => {
    if (!showBondsTab && tab === "bonds") setTab("atoms");
  }, [showBondsTab, tab]);

  const atomEmptyTitle = deferredFilterIds ? "No matching atoms" : "No atoms";

  const atomHeaderColumns: HeaderColumn[] = useMemo(
    () => [
      { key: INDEX_KEY, label: INDEX_KEY, title: "Row index" },
      ...columns.map((col) => ({
        key: col.name,
        label: col.name,
        title: `${col.name} (${col.dtype})`,
      })),
    ],
    [columns],
  );
  const bondHeaderColumns: HeaderColumn[] = useMemo(
    () => [
      { key: INDEX_KEY, label: INDEX_KEY, title: "Row index" },
      { key: "i", label: "i" },
      { key: "j", label: "j" },
      { key: "ord", label: "ord" },
    ],
    [],
  );

  const atomTableWidth = atomHeaderColumns.reduce(
    (sum, col) => sum + widthOf(atomWidths, col.key),
    0,
  );
  const bondTableWidth = bondHeaderColumns.reduce(
    (sum, col) => sum + widthOf(bondWidths, col.key),
    0,
  );

  /**
   * Row hit-test against the rows wrapper itself (its rect already moves
   * with scroll), so coarse hit targets and the virtualizer stay
   * consistent — and independent of the sticky header height.
   */
  const atomIndexFromPointer = (e: React.MouseEvent<HTMLElement>): number => {
    const wrap = atomRowsWrapRef.current;
    if (!wrap) return -1;
    const contentY = e.clientY - wrap.getBoundingClientRect().top;
    const visualIndex = rowIndexFromContentY(
      contentY,
      rowHeight,
      atomDisplayCount,
    );
    if (visualIndex < 0) return -1;
    return atomRowIndexAt(visualIndex);
  };

  // ── Virtual windows (only these rows are ever materialized) ─────

  const totalHeight = atomDisplayCount * rowHeight;
  const visibleCount = containerRef.current
    ? Math.ceil(containerRef.current.clientHeight / rowHeight)
    : 30;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIdx = Math.min(
    atomDisplayCount,
    startIdx + visibleCount + OVERSCAN * 2,
  );
  const offsetY = startIdx * rowHeight;

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataRev invalidates the WASM-side window cache
  const visibleAtomRows = useMemo<AtomRow[]>(() => {
    if (!app || endIdx <= startIdx) return [];
    const block = app.system.frame?.getBlock("atoms");
    if (!block) return [];
    const indices: number[] = [];
    for (let v = startIdx; v < endIdx; v++) indices.push(atomRowIndexAt(v));
    return extractAtomRowsAt(block, columns, indices);
  }, [app, columns, startIdx, endIdx, atomRowIndexAt, dataRev]);

  const bondTotalHeight = bondDisplayCount * rowHeight;
  const bondVisibleCount = bondContainerRef.current
    ? Math.ceil(bondContainerRef.current.clientHeight / rowHeight)
    : 30;
  const bondStartIdx = Math.max(
    0,
    Math.floor(bondScrollTop / rowHeight) - OVERSCAN,
  );
  const bondEndIdx = Math.min(
    bondDisplayCount,
    bondStartIdx + bondVisibleCount + OVERSCAN * 2,
  );
  const bondOffsetY = bondStartIdx * rowHeight;
  const visibleBondIndices = useMemo<number[]>(() => {
    const out: number[] = [];
    for (let v = bondStartIdx; v < bondEndIdx; v++) {
      out.push(bondDisplayIdx?.[v] ?? v);
    }
    return out;
  }, [bondStartIdx, bondEndIdx, bondDisplayIdx]);

  const spinner = (
    <div className="flex items-center justify-center py-6">
      <Loader2
        aria-label="Loading table"
        className="h-4 w-4 animate-spin text-muted-foreground"
      />
    </div>
  );

  const headerCells = (
    cols: HeaderColumn[],
    widths: Record<string, number>,
    sort: SortSpec | null,
    setSort: React.Dispatch<React.SetStateAction<SortSpec | null>>,
    setWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>,
  ) =>
    cols.map((col) => (
      <HeaderCell
        key={col.key}
        column={col}
        width={widthOf(widths, col.key)}
        sort={sort}
        onSort={() => setSort((prev) => toggleSort(prev, col.key))}
        onResize={(w) => setWidths((prev) => ({ ...prev, [col.key]: w }))}
      />
    ));

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="h-full flex flex-col gap-0"
    >
      <TabsList
        variant="line"
        className={`w-full shrink-0 gap-0 rounded-none border-b border-border/70 p-0 ${compact ? "h-5" : "h-6"}`}
      >
        <TabsTrigger
          value="atoms"
          className={`rounded-none text-micro after:bottom-0 ${compact ? "h-5" : "h-6"}`}
        >
          Atoms ({atomDisplayCount})
        </TabsTrigger>
        {showBondsTab && (
          <TabsTrigger
            value="bonds"
            className={`rounded-none text-micro after:bottom-0 ${compact ? "h-5" : "h-6"}`}
          >
            Bonds ({bondDisplayCount})
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="atoms" className="flex-1 min-h-0 mt-0">
        <div
          ref={containerRef}
          className="h-full overflow-auto"
          onScroll={handleScroll}
        >
          <div style={{ minWidth: atomTableWidth }}>
            <div className="sticky top-0 z-10 flex border-b bg-background text-micro font-semibold text-muted-foreground">
              {headerCells(
                atomHeaderColumns,
                atomWidths,
                atomSort,
                setAtomSort,
                setAtomWidths,
              )}
            </div>

            {loading && atomDisplayCount === 0 ? (
              spinner
            ) : atomDisplayCount === 0 ? (
              <EmptyState
                title={atomEmptyTitle}
                density="inline"
                className="px-2 py-3"
              />
            ) : (
              <div
                ref={atomRowsWrapRef}
                style={{ height: totalHeight, position: "relative" }}
              >
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
                      className={`flex w-full cursor-pointer appearance-none border-b border-border/50 bg-transparent text-left font-mono text-micro hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        focusedAtom === row.index
                          ? "bg-accent/20 text-foreground"
                          : deferredSelectedIds.has(row.index)
                            ? "bg-accent/15 text-foreground"
                            : ""
                      }`}
                      style={{ height: rowHeight }}
                      onClick={(e) => {
                        const fromGeom = atomIndexFromPointer(e);
                        handleAtomRowClick(
                          fromGeom >= 0 ? fromGeom : row.index,
                        );
                      }}
                    >
                      <span
                        className={`flex shrink-0 items-center justify-end px-1 text-muted-foreground ${
                          atomSort?.key === INDEX_KEY ? "bg-accent/5" : ""
                        }`}
                        style={{ width: widthOf(atomWidths, INDEX_KEY) }}
                      >
                        {row.index}
                      </span>
                      {columns.map((col) => (
                        <span
                          key={col.name}
                          className={`flex shrink-0 items-center truncate px-1 ${
                            atomSort?.key === col.name ? "bg-accent/5" : ""
                          }`}
                          style={{ width: widthOf(atomWidths, col.name) }}
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

      {showBondsTab && bondCols && (
        <TabsContent value="bonds" className="flex-1 min-h-0 mt-0">
          <div
            ref={bondContainerRef}
            className="h-full overflow-auto"
            onScroll={handleBondScroll}
          >
            <div style={{ minWidth: bondTableWidth }}>
              <div className="sticky top-0 z-10 flex border-b bg-background text-micro font-semibold text-muted-foreground">
                {headerCells(
                  bondHeaderColumns,
                  bondWidths,
                  bondSort,
                  setBondSort,
                  setBondWidths,
                )}
              </div>

              <div style={{ height: bondTotalHeight, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    top: bondOffsetY,
                    left: 0,
                    right: 0,
                  }}
                >
                  {visibleBondIndices.map((b) => (
                    <div
                      key={b}
                      className="flex text-micro font-mono border-b border-muted/5"
                      style={{ height: rowHeight }}
                    >
                      {(
                        [
                          [INDEX_KEY, b],
                          ["i", bondCols.i[b]],
                          ["j", bondCols.j[b]],
                          ["ord", bondCols.order?.[b] ?? 1],
                        ] as const
                      ).map(([key, value]) => (
                        <div
                          key={key}
                          className={`flex shrink-0 items-center truncate px-1 ${
                            key === INDEX_KEY
                              ? "justify-end text-muted-foreground"
                              : ""
                          } ${bondSort?.key === key ? "bg-accent/5" : ""}`}
                          style={{ width: widthOf(bondWidths, key) }}
                        >
                          {value}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
};
