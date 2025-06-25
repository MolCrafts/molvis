// Main GUI manager
export { GuiManager } from "./base";
export type { GuiOptions } from "./base";

// Component interfaces
export type { GuiComponent, HtmlGuiComponent, TweakpaneGuiComponent } from "./types";

// Individual components
export { ModeIndicator } from "./components/mode-indicator";
export { ViewIndicator } from "./components/view-indicator";
export { InfoPanel } from "./components/info-panel";
export { FrameIndicator } from "./components/frame-indicator";

// Styles
export { GUI_STYLES, applyStyles } from "./styles";