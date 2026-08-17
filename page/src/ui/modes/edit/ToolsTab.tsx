import { ModeType, type Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { registerEditElementPicker } from "./element-picker";

registerEditElementPicker();

interface ToolsTabProps {
  app: Molvis | null;
}

interface EditModeState {
  type: ModeType.Edit;
  element: string;
  bondOrder: number;
}

function isEditModeState(mode: unknown): mode is EditModeState {
  if (!mode || typeof mode !== "object") return false;
  const candidate = mode as Partial<EditModeState>;
  return (
    candidate.type === ModeType.Edit &&
    typeof candidate.element === "string" &&
    typeof candidate.bondOrder === "number"
  );
}

const BOND_ORDERS: Array<{ value: 1 | 2 | 3; label: string }> = [
  { value: 1, label: "Single bond" },
  { value: 2, label: "Double bond" },
  { value: 3, label: "Triple bond" },
];

function BondOrderGlyph({ order }: { order: 1 | 2 | 3 }) {
  const lines = order === 1 ? [12] : order === 2 ? [9, 15] : [7.5, 12, 16.5];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      className="size-4"
    >
      {lines.map((y) => (
        <line key={y} x1="4" y1={y} x2="20" y2={y} />
      ))}
    </svg>
  );
}

/**
 * Freehand draw tools: element picker + a **connected** bond-order segment.
 */
export const ToolsTab: React.FC<ToolsTabProps> = ({ app }) => {
  const [activeElement, setActiveElement] = useState<string>("C");
  const [activeBondOrder, setActiveBondOrder] = useState<number>(1);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);

  useEffect(() => {
    if (!app) return;

    const updateState = () => {
      const mode = app.mode;
      if (isEditModeState(mode)) {
        setIsEditMode(true);
        setActiveElement(mode.element);
        setActiveBondOrder(mode.bondOrder);
      } else {
        setIsEditMode(false);
      }
    };

    updateState();

    const onModeChange = () => updateState();

    if (app.events && typeof app.events.on === "function") {
      app.events.on("mode-change", onModeChange);
    }

    return () => {
      if (app.events && typeof app.events.off === "function") {
        app.events.off("mode-change", onModeChange);
      }
    };
  }, [app]);

  const updateEditMode = (updates: {
    element?: string;
    bondOrder?: number;
  }) => {
    if (!app) return;

    const mode = app.mode;
    if (isEditModeState(mode)) {
      if (updates.element) {
        mode.element = updates.element;
        setActiveElement(updates.element);
      }
      if (updates.bondOrder) {
        mode.bondOrder = updates.bondOrder;
        setActiveBondOrder(updates.bondOrder);
      }
    }
  };

  if (!app || !isEditMode) return null;

  return (
    <div
      className="flex w-full items-center gap-2 pointer-events-auto"
      role="toolbar"
      aria-label="Draw tools"
    >
      <div className="flex h-control-compact shrink-0 items-center">
        <molvis-element-picker
          compact
          value={activeElement}
          onInput={(event) =>
            updateEditMode({ element: event.currentTarget.value })
          }
        />
      </div>

      {/* Segmented control: three bond orders share one border. */}
      <fieldset className="m-0 ml-auto flex h-control-compact shrink-0 items-stretch overflow-hidden rounded-control border border-border/70 p-0">
        <legend className="sr-only">Bond order</legend>
        {BOND_ORDERS.map(({ value, label }, index) => {
          const active = activeBondOrder === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              title={label}
              aria-label={label}
              onClick={() => updateEditMode({ bondOrder: value })}
              className={cn(
                "flex w-8 items-center justify-center transition-colors duration-(--motion-fast) ease-standard",
                index > 0 && "border-l border-border/70",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-interactive hover:text-foreground",
              )}
            >
              <BondOrderGlyph order={value} />
            </button>
          );
        })}
      </fieldset>
    </div>
  );
};
