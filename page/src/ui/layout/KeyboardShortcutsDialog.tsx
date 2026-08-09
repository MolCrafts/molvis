import type React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  keys: string;
  description: string;
}

const SECTIONS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Modes",
    shortcuts: [
      { keys: "1", description: "View mode (orbit/pan/zoom)" },
      { keys: "2", description: "Select mode (click atoms/bonds)" },
      { keys: "3", description: "Edit mode (add/delete atoms)" },
      { keys: "4", description: "Manipulate mode (transform)" },
      { keys: "5", description: "Measure mode (distance/angle)" },
    ],
  },
  {
    title: "File",
    shortcuts: [
      {
        keys: "Ctrl+S",
        description: "Save canvas edits into the structure (any mode)",
      },
    ],
  },
  {
    title: "Edit",
    shortcuts: [
      { keys: "Ctrl+Z", description: "Undo" },
      { keys: "Ctrl+Shift+Z", description: "Redo" },
      { keys: "Delete", description: "Delete selected" },
      { keys: "Escape", description: "Cancel / deselect" },
    ],
  },
  {
    title: "Camera",
    shortcuts: [
      { keys: "Left click + drag", description: "Orbit" },
      { keys: "Right click + drag", description: "Pan" },
      { keys: "Scroll wheel", description: "Zoom" },
    ],
  },
  {
    title: "Selection",
    shortcuts: [
      { keys: "Click", description: "Select atom" },
      { keys: "Shift+Click", description: "Add to selection" },
      { keys: "Ctrl+A", description: "Select all" },
    ],
  },
  {
    title: "Plugins",
    shortcuts: [
      {
        keys: "Ctrl/⌘+Shift+P",
        description: "Command palette (plugin commands)",
      },
    ],
  },
  {
    title: "Other",
    shortcuts: [{ keys: "?", description: "Show this help" }],
  },
];

export const KeyboardShortcutsDialog: React.FC<
  KeyboardShortcutsDialogProps
> = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-dialog-scroll max-w-dialog-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {section.title}
              </h4>
              <div className="space-y-1">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-xs text-foreground">
                      {shortcut.description}
                    </span>
                    <kbd className="text-micro font-mono bg-muted px-2 py-1 rounded-control border text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
