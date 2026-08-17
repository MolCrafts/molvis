import type { MolvisElementPickerElement } from "@molcrafts/molvis-core/element-picker";
import type React from "react";

type MolvisElementPickerProps = React.DetailedHTMLProps<
  React.HTMLAttributes<MolvisElementPickerElement>,
  MolvisElementPickerElement
> & {
  compact?: boolean;
  disabled?: boolean;
  value?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "molvis-element-picker": MolvisElementPickerProps;
    }
  }
}
