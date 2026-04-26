import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type DataSourceModifier as CoreDataSourceModifier,
  Frame,
  type Molvis,
  Trajectory,
} from "@molvis/core";
import { getAllAcceptExtensions } from "@molvis/core/io";
import { FileUp, Trash2 } from "lucide-react";
import type React from "react";

interface DataSourceModifierProps {
  modifier: CoreDataSourceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DataSourceModifier: React.FC<DataSourceModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const pickFormat = useFormatPicker();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;
    try {
      const result = await loadFileSmart(app, file, pickFormat);
      if (result === "started") onUpdate();
    } finally {
      e.target.value = "";
    }
  };

  const filename = modifier.filename === "" ? "-" : modifier.filename;
  const frame = app?.system.frame;
  const atomCount = frame?.getBlock("atoms")?.nrows() ?? 0;
  const bondCount = frame?.getBlock("bonds")?.nrows() ?? 0;
  const hasBox = frame?.simbox !== undefined;

  const handleToggle = (
    prop: "showAtoms" | "showBonds" | "showBox",
    checked: boolean,
  ) => {
    modifier[prop] = checked;
    onUpdate();
    app?.applyPipeline({ fullRebuild: true });
  };

  const handleClear = async () => {
    if (!app) return;
    modifier.sourceType = "empty";
    modifier.filename = "";
    await app.setTrajectory(new Trajectory([new Frame()]));
    await app.applyPipeline({ fullRebuild: true });
    onUpdate();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={handleFileUpload}
            accept={getAllAcceptExtensions()}
            title="Load file"
            aria-label="Load file"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full px-2"
            title="Load file"
            aria-label="Load file"
          >
            <FileUp className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          title="Clear scene"
          aria-label="Clear scene"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground truncate px-1">
        <span className="font-mono text-foreground">{filename}</span>
      </div>

      <div className="border rounded-md overflow-hidden bg-background">
        <table className="w-full text-[10px]">
          <tbody className="divide-y">
            <tr className="hover:bg-muted/50 transition-colors">
              <td className="px-1.5 py-1 w-6">
                <Checkbox
                  checked={modifier.showAtoms}
                  onCheckedChange={(checked) =>
                    handleToggle("showAtoms", checked === true)
                  }
                  className="h-3 w-3"
                />
              </td>
              <td className="px-1 py-1 font-medium">Atoms</td>
              <td className="px-1.5 py-1 text-right font-mono text-muted-foreground tabular-nums">
                {atomCount}
              </td>
            </tr>
            <tr className="hover:bg-muted/50 transition-colors">
              <td className="px-1.5 py-1 w-6">
                <Checkbox
                  checked={modifier.showBonds}
                  onCheckedChange={(checked) =>
                    handleToggle("showBonds", checked === true)
                  }
                  className="h-3 w-3"
                />
              </td>
              <td className="px-1 py-1 font-medium">Bonds</td>
              <td className="px-1.5 py-1 text-right font-mono text-muted-foreground tabular-nums">
                {bondCount}
              </td>
            </tr>
            <tr className="hover:bg-muted/50 transition-colors">
              <td className="px-1.5 py-1 w-6">
                <Checkbox
                  checked={modifier.showBox}
                  onCheckedChange={(checked) =>
                    handleToggle("showBox", checked === true)
                  }
                  className="h-3 w-3"
                />
              </td>
              <td className="px-1 py-1 font-medium">Box</td>
              <td className="px-1.5 py-1 text-right font-mono text-muted-foreground tabular-nums">
                {hasBox ? 1 : 0}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
