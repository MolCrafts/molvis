// Base interface for all GUI components
export interface GuiComponent {
  show(): void;
  hide(): void;
  dispose(): void;
}

// Interface for HTML-based components (mode/view indicators)
export interface HtmlGuiComponent extends GuiComponent {
  element: HTMLElement;
}

// Interface for tweakpane-based components (frame indicator)
export interface TweakpaneGuiComponent extends GuiComponent {
  pane: import("tweakpane").Pane;
}
