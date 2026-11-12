import { ArrowExpandRegular as Expand } from "@fluentui/react-icons";
import { IconAction } from "@molcrafts/ui";

interface ChartPopoutActionProps {
  onOpen: () => void;
}

/** Reveals the larger scientific-chart workspace from an inline chart. */
export function ChartPopoutAction({ onOpen }: ChartPopoutActionProps) {
  return (
    <IconAction
      type="button"
      icon={<Expand />}
      label="Pop out chart"
      tooltipSide="left"
      className="chart-popout-action pointer-events-none absolute right-1 top-1 z-10 border-0 bg-background p-0 opacity-0 shadow-none transition-opacity duration-(--motion-fast) ease-standard group-hover/chart:pointer-events-auto group-hover/chart:opacity-100 group-focus-within/chart:pointer-events-auto group-focus-within/chart:opacity-100 hover:bg-interactive focus-visible:pointer-events-auto focus-visible:opacity-100"
      onClick={onOpen}
    />
  );
}
