export interface AtomStyle {
  color: string; // Hex
  radius: number;
  // StandardMaterial properties
  specularColor?: string;
  emissiveColor?: string;
  alpha?: number;
}

export interface BondStyle {
  color: string;
  radius: number;
  specularColor?: string;
  alpha?: number;
}

export interface Theme {
  name: string;

  // Core resolvers
  getAtomStyle(element: string): AtomStyle;
  getTypeStyle(type: string): AtomStyle;
  getBondStyle(order: number, type?: string): BondStyle;

  // Global properties (palette / overlay — not viewport clearColor).
  // ``backgroundColor`` may feed material contrast; hosts own the canvas bg.
  backgroundColor: string;
  selectionColor: string;
  boxColor: string;

  // Generic material settings (e.g. "matte", "glossy") to apply if specific overrides aren't present
  defaultSpecular: string;
}
